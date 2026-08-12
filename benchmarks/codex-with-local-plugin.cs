using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

internal static class Program
{
    private static string FindCodex()
    {
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(directory)) continue;
            var candidate = Path.Combine(directory.Trim('"'), "codex.exe");
            if (File.Exists(candidate)) return candidate;
        }

        throw new FileNotFoundException("codex.exe was not found on PATH.");
    }

    private static ProcessStartInfo StartInfo(string codex, IEnumerable<string> arguments)
    {
        var info = new ProcessStartInfo(codex) { UseShellExecute = false };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        return info;
    }

    private static int RunSetup(string codex, params string[] arguments)
    {
        var info = StartInfo(codex, arguments);
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        using var process = Process.Start(info);
        if (process == null) return 1;
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            Console.Error.WriteLine(stderr.Length > 0 ? stderr : stdout);
        }
        return process.ExitCode;
    }

    private static int RunCodex(string codex, string[] arguments)
    {
        using var process = Process.Start(StartInfo(codex, arguments));
        if (process == null) return 1;
        var timeoutText = Environment.GetEnvironmentVariable("SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS");
        if (int.TryParse(timeoutText, out var timeoutSeconds) && timeoutSeconds > 0)
        {
            if (!process.WaitForExit(timeoutSeconds * 1000))
            {
                process.Kill(true);
                process.WaitForExit();
                Console.Error.WriteLine($"Codex benchmark timed out after {timeoutSeconds} seconds.");
                return 124;
            }
        }
        else
        {
            process.WaitForExit();
        }
        return process.ExitCode;
    }

    public static int Main(string[] arguments)
    {
        try
        {
            var codex = FindCodex();
            if (arguments.Length > 0 && arguments[0] == "exec")
            {
                var workspaceIndex = Array.IndexOf(arguments, "--cd");
                if (workspaceIndex < 0 || workspaceIndex + 1 >= arguments.Length)
                {
                    Console.Error.WriteLine("Benchmark wrapper could not resolve the Codex workspace.");
                    return 2;
                }

                var workspace = arguments[workspaceIndex + 1];
                var marketplaceExit = RunSetup(codex, "plugin", "marketplace", "add", workspace, "--json");
                if (marketplaceExit != 0) return marketplaceExit;

                var installExit = RunSetup(codex, "plugin", "add", "skillquiver@plugin-eval-benchmark", "--json");
                if (installExit != 0) return installExit;
            }

            return RunCodex(codex, arguments);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
