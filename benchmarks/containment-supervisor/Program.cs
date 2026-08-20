using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// Trusted process containment for the instruction forward harness on Windows.
//
// Polling a process table cannot prove containment: a descendant that spawns and detaches
// between two samples escapes observation entirely. This supervisor instead creates the
// adapter suspended, assigns it to a job object before it executes a single instruction,
// and resumes it. Every descendant then belongs to the job by construction, the job's own
// process-id list is the authoritative membership record, and TerminateJobObject stops the
// whole tree atomically regardless of parentage or detachment.
internal static class Program
{
    private const int MaxObservedProcesses = 64;
    private const int PollIntervalMilliseconds = 25;
    private const int StopWaitMilliseconds = 5000;

    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectBasicProcessIdList = 3;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint ProcessQueryLimitedInformation = 0x00001000;
    private const uint Synchronize = 0x00100000;
    private const uint Th32SnapProcess = 0x00000002;
    private const uint WaitTimeout = 0x00000102;
    private const uint Infinite = 0xFFFFFFFF;

    private sealed class Observed
    {
        public int Pid;
        public int ParentPid;
        public string StartToken;
        public string ImagePath;
    }

    // Windows attaches a console host to every console process, so the job contains processes
    // the adapter never created and cannot enumerate. Attribution is decided by full image
    // path, not by name, so an adapter cannot evade it by naming a descendant conhost.exe.
    private static string SystemConsoleHost()
    {
        var systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
        return string.IsNullOrEmpty(systemRoot) ? null
            : Path.Combine(systemRoot, "System32", "conhost.exe");
    }

    private static int Main()
    {
        try
        {
            var requestText = Console.OpenStandardInput().ReadToEndText();
            using var request = JsonDocument.Parse(requestText);
            return Run(request.RootElement);
        }
        catch (Exception error)
        {
            Console.Error.Write(error.ToString());
            return 1;
        }
    }

    private static string ReadToEndText(this Stream stream)
    {
        using var reader = new StreamReader(stream, new UTF8Encoding(false));
        return reader.ReadToEnd();
    }

    private static int Run(JsonElement request)
    {
        var executable = request.GetProperty("executable").GetString();
        var arguments = new List<string>();
        foreach (var argument in request.GetProperty("args").EnumerateArray())
        {
            arguments.Add(argument.GetString());
        }

        var options = request.GetProperty("options");
        var workingDirectory = options.GetProperty("cwd").GetString();
        var timeout = options.GetProperty("timeout").GetInt32();
        var maxBuffer = options.GetProperty("maxBuffer").GetInt32();
        var input = Convert.FromBase64String(request.GetProperty("inputBase64").GetString());

        var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in options.GetProperty("env").EnumerateObject())
        {
            environment[entry.Name] = entry.Value.GetString() ?? string.Empty;
        }

        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Failure("CreateJobObject");
        try
        {
            KillDescendantsWhenJobCloses(job);
            return Launch(job, executable, arguments, workingDirectory, environment, input,
                timeout, maxBuffer);
        }
        finally
        {
            // Closing the last job handle terminates anything still assigned, so a crashed
            // or killed supervisor still cannot leak a descendant onto the host.
            CloseHandle(job);
        }
    }

    private static void KillDescendantsWhenJobCloses(IntPtr job)
    {
        var limits = new JobObjectExtendedLimitInformationStruct();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        var size = Marshal.SizeOf<JobObjectExtendedLimitInformationStruct>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer,
                (uint)size))
            {
                throw new Win32Failure("SetInformationJobObject");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static int Launch(IntPtr job, string executable, List<string> arguments,
        string workingDirectory, SortedDictionary<string, string> environment, byte[] input,
        int timeout, int maxBuffer)
    {
        var inheritable = new SecurityAttributes
        {
            nLength = Marshal.SizeOf<SecurityAttributes>(),
            lpSecurityDescriptor = IntPtr.Zero,
            bInheritHandle = 1,
        };

        CreateRedirectionPipe(ref inheritable, false, out var stdinRead, out var stdinWrite);
        CreateRedirectionPipe(ref inheritable, true, out var stdoutRead, out var stdoutWrite);
        CreateRedirectionPipe(ref inheritable, true, out var stderrRead, out var stderrWrite);

        var startup = new StartupInfo
        {
            cb = Marshal.SizeOf<StartupInfo>(),
            dwFlags = StartfUseStdHandles,
            hStdInput = stdinRead,
            hStdOutput = stdoutWrite,
            hStdError = stderrWrite,
        };

        var commandLine = new StringBuilder(BuildCommandLine(executable, arguments));
        var environmentBlock = BuildEnvironmentBlock(environment);
        var created = CreateProcess(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true,
            CreateSuspended | CreateUnicodeEnvironment | CreateNoWindow, environmentBlock,
            workingDirectory, ref startup, out var information);
        Marshal.FreeHGlobal(environmentBlock);
        CloseHandle(stdinRead);
        CloseHandle(stdoutWrite);
        CloseHandle(stderrWrite);
        if (!created)
        {
            CloseHandle(stdinWrite);
            CloseHandle(stdoutRead);
            CloseHandle(stderrRead);
            throw new Win32Failure("CreateProcess");
        }

        try
        {
            // The adapter is still suspended, so no descendant can exist outside the job.
            if (!AssignProcessToJobObject(job, information.hProcess))
            {
                throw new Win32Failure("AssignProcessToJobObject");
            }
            if (ResumeThread(information.hThread) == uint.MaxValue)
            {
                throw new Win32Failure("ResumeThread");
            }

            var observed = new Dictionary<int, Observed>();
            var stdout = new MemoryStream();
            var stderr = new MemoryStream();
            var overflow = 0;
            var pumps = new[]
            {
                PumpStream(stdoutRead, stdout, maxBuffer, () => Interlocked.Exchange(ref overflow, 1)),
                PumpStream(stderrRead, stderr, maxBuffer, () => Interlocked.Exchange(ref overflow, 1)),
            };
            WriteStandardInput(stdinWrite, input);

            var timedOut = !WaitForAdapter(job, information.hProcess, timeout, observed);
            ObserveJob(job, observed);
            var treeStopped = StopJob(job, observed);
            foreach (var pump in pumps) pump.Join(StopWaitMilliseconds);

            uint exitCode = 0;
            GetExitCodeProcess(information.hProcess, out exitCode);
            var outputExceeded = Interlocked.CompareExchange(ref overflow, 0, 0) == 1;
            WriteResponse(information.dwProcessId, observed, treeStopped, timedOut,
                outputExceeded, (int)exitCode, stdout, stderr);
            return 0;
        }
        finally
        {
            CloseHandle(information.hThread);
            CloseHandle(information.hProcess);
        }
    }

    private static void CreateRedirectionPipe(ref SecurityAttributes inheritable, bool readEndIsOurs,
        out IntPtr read, out IntPtr write)
    {
        if (!CreatePipe(out read, out write, ref inheritable, 0)) throw new Win32Failure("CreatePipe");
        // Only the end handed to the adapter may be inherited; ours must not leak into the job.
        var ours = readEndIsOurs ? read : write;
        if (!SetHandleInformation(ours, HandleFlagInherit, 0))
        {
            throw new Win32Failure("SetHandleInformation");
        }
    }

    private static void WriteStandardInput(IntPtr handle, byte[] input)
    {
        using var stream = new FileStream(new SafeFileHandle(handle, true), FileAccess.Write);
        stream.Write(input, 0, input.Length);
        stream.Flush();
    }

    private static Thread PumpStream(IntPtr handle, MemoryStream sink, int maxBuffer,
        Action onOverflow)
    {
        var thread = new Thread(() =>
        {
            using var stream = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read);
            var buffer = new byte[8192];
            while (true)
            {
                int read;
                try { read = stream.Read(buffer, 0, buffer.Length); }
                catch (IOException) { return; }
                if (read <= 0) return;
                lock (sink)
                {
                    if (sink.Length + read <= maxBuffer) sink.Write(buffer, 0, read);
                    else onOverflow();
                }
            }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    private static bool WaitForAdapter(IntPtr job, IntPtr process, int timeout,
        Dictionary<int, Observed> observed)
    {
        var deadline = Environment.TickCount64 + timeout;
        while (true)
        {
            ObserveJob(job, observed);
            var remaining = deadline - Environment.TickCount64;
            if (remaining <= 0) return false;
            var slice = (uint)Math.Min(PollIntervalMilliseconds, remaining);
            if (WaitForSingleObject(process, slice) != WaitTimeout) return true;
        }
    }

    // The job's process-id list is the containment record. Parent ids are read from a
    // toolhelp snapshot only to render the tree; job membership, not parentage, is what
    // proves a process was contained.
    private static void ObserveJob(IntPtr job, Dictionary<int, Observed> observed)
    {
        var live = QueryJobProcessIds(job);
        var unknown = new List<int>();
        foreach (var pid in live)
        {
            if (!observed.ContainsKey(pid)) unknown.Add(pid);
        }
        if (unknown.Count == 0) return;

        var parents = SnapshotParents();
        foreach (var pid in unknown)
        {
            var startToken = ReadStartToken(pid);
            if (startToken == null) continue;
            observed[pid] = new Observed
            {
                Pid = pid,
                ParentPid = parents.TryGetValue(pid, out var parent) ? parent : 0,
                StartToken = startToken,
                ImagePath = ReadImagePath(pid),
            };
        }
    }

    private static List<int> QueryJobProcessIds(IntPtr job)
    {
        var capacity = 64;
        while (true)
        {
            var size = (sizeof(uint) * 2) + (IntPtr.Size * capacity);
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!QueryInformationJobObject(job, JobObjectBasicProcessIdList, buffer,
                    (uint)size, IntPtr.Zero))
                {
                    if (Marshal.GetLastWin32Error() == 234 && capacity < 4096)
                    {
                        capacity *= 4;
                        continue;
                    }
                    throw new Win32Failure("QueryInformationJobObject");
                }
                var assigned = (int)(uint)Marshal.ReadInt32(buffer, 0);
                var returned = (int)(uint)Marshal.ReadInt32(buffer, sizeof(uint));
                if (assigned > returned && capacity < 4096)
                {
                    capacity *= 4;
                    continue;
                }
                var identifiers = new List<int>(returned);
                for (var index = 0; index < returned; index += 1)
                {
                    var offset = (sizeof(uint) * 2) + (IntPtr.Size * index);
                    identifiers.Add((int)Marshal.ReadIntPtr(buffer, offset));
                }
                return identifiers;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }

    private static Dictionary<int, int> SnapshotParents()
    {
        var parents = new Dictionary<int, int>();
        var snapshot = CreateToolhelp32Snapshot(Th32SnapProcess, 0);
        if (snapshot == new IntPtr(-1)) return parents;
        try
        {
            var entry = new ProcessEntry32 { dwSize = (uint)Marshal.SizeOf<ProcessEntry32>() };
            if (!Process32First(snapshot, ref entry)) return parents;
            do
            {
                parents[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
            }
            while (Process32Next(snapshot, ref entry));
            return parents;
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }

    private static string ReadStartToken(int pid)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, (uint)pid);
        if (handle == IntPtr.Zero) return null;
        try
        {
            if (!GetProcessTimes(handle, out var creation, out _, out _, out _)) return null;
            return DateTime.FromFileTimeUtc(creation).ToString("o", CultureInfo.InvariantCulture);
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static string ReadImagePath(int pid)
    {
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, (uint)pid);
        if (handle == IntPtr.Zero) return null;
        try
        {
            var buffer = new StringBuilder(1024);
            var size = buffer.Capacity;
            return QueryFullProcessImageName(handle, 0, buffer, ref size)
                ? buffer.ToString() : null;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static bool StopJob(IntPtr job, Dictionary<int, Observed> observed)
    {
        if (!TerminateJobObject(job, 1)) throw new Win32Failure("TerminateJobObject");
        var deadline = Environment.TickCount64 + StopWaitMilliseconds;
        while (Environment.TickCount64 < deadline)
        {
            var alive = false;
            foreach (var entry in observed.Values)
            {
                if (IsStillRunning(entry)) { alive = true; break; }
            }
            if (!alive) return true;
            Thread.Sleep(PollIntervalMilliseconds);
        }
        return false;
    }

    private static bool IsStillRunning(Observed entry)
    {
        // A terminated process stays openable until its last handle closes, so existence
        // proves nothing. The process object is waited on instead, and a recycled process id
        // is rejected by comparing creation times.
        var handle = OpenProcess(ProcessQueryLimitedInformation | Synchronize, false,
            (uint)entry.Pid);
        if (handle == IntPtr.Zero) return false;
        try
        {
            if (!GetProcessTimes(handle, out var creation, out _, out _, out _)) return false;
            var startToken = DateTime.FromFileTimeUtc(creation)
                .ToString("o", CultureInfo.InvariantCulture);
            if (startToken != entry.StartToken) return false;
            return WaitForSingleObject(handle, 0) == WaitTimeout;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static void WriteResponse(int adapterPid, Dictionary<int, Observed> observed,
        bool treeStopped, bool timedOut, bool outputExceeded, int exitCode, MemoryStream stdout,
        MemoryStream stderr)
    {
        if (!observed.ContainsKey(adapterPid))
        {
            throw new InvalidOperationException("The job never reported its adapter root.");
        }
        if (observed.Count > MaxObservedProcesses)
        {
            throw new InvalidOperationException(
                "The job held more processes than the containment receipt can carry.");
        }

        var identifiers = new List<int>(observed.Keys);
        identifiers.Sort();
        var consoleHost = SystemConsoleHost();
        var attributed = new List<int>();
        var processes = new List<object>(identifiers.Count);
        foreach (var pid in identifiers)
        {
            var entry = observed[pid];
            if (pid == adapterPid || consoleHost == null || entry.ImagePath == null ||
                !string.Equals(entry.ImagePath, consoleHost, StringComparison.OrdinalIgnoreCase))
            {
                attributed.Add(pid);
            }
            // Job membership already proves descent from the adapter. When an intermediate
            // parent exited before it could be sampled, the receipt roots the survivor at the
            // adapter rather than pointing at a process no observation ever covered.
            var parentPid = pid == adapterPid ? entry.ParentPid
                : observed.ContainsKey(entry.ParentPid) ? entry.ParentPid : adapterPid;
            processes.Add(new
            {
                pid,
                parentPid,
                startToken = entry.StartToken,
            });
        }

        var response = new
        {
            result = new
            {
                status = timedOut || outputExceeded ? (int?)null : exitCode,
                signal = (string)null,
                errorCode = timedOut ? "ETIMEDOUT" : outputExceeded ? "ENOBUFS" : null,
                stdoutBase64 = Convert.ToBase64String(stdout.ToArray()),
                stderrBase64 = Convert.ToBase64String(stderr.ToArray()),
            },
            containment = new
            {
                schemaVersion = 1,
                observationSource = "trusted-synthetic-runtime-v1",
                adapterPid,
                observedProcesses = processes,
                attributedPids = attributed,
                treeStopped,
            },
        };
        Console.Out.Write(JsonSerializer.Serialize(response));
        Console.Out.Flush();
    }

    private static string BuildCommandLine(string executable, List<string> arguments)
    {
        var builder = new StringBuilder();
        AppendArgument(builder, executable);
        foreach (var argument in arguments)
        {
            builder.Append(' ');
            AppendArgument(builder, argument);
        }
        return builder.ToString();
    }

    private static void AppendArgument(StringBuilder builder, string argument)
    {
        builder.Append('"');
        for (var index = 0; index < argument.Length; index += 1)
        {
            var backslashes = 0;
            while (index < argument.Length && argument[index] == '\\')
            {
                backslashes += 1;
                index += 1;
            }
            if (index == argument.Length)
            {
                builder.Append('\\', backslashes * 2);
                break;
            }
            if (argument[index] == '"')
            {
                builder.Append('\\', (backslashes * 2) + 1);
            }
            else
            {
                builder.Append('\\', backslashes);
            }
            builder.Append(argument[index]);
        }
        builder.Append('"');
    }

    private static IntPtr BuildEnvironmentBlock(SortedDictionary<string, string> environment)
    {
        var builder = new StringBuilder();
        foreach (var entry in environment)
        {
            builder.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
        }
        builder.Append('\0');
        return Marshal.StringToHGlobalUni(builder.ToString());
    }

    private sealed class Win32Failure : Exception
    {
        public Win32Failure(string operation)
            : base(operation + " failed with error " + Marshal.GetLastWin32Error() + ".")
        {
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformationStruct
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass,
        IntPtr information, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int infoClass,
        IntPtr information, uint length, IntPtr returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint creationFlags, IntPtr environment, string currentDirectory,
        ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe,
        ref SecurityAttributes attributes, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit,
        out long kernel, out long user);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags,
        StringBuilder name, ref int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode,
        EntryPoint = "Process32FirstW")]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode,
        EntryPoint = "Process32NextW")]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);
}
