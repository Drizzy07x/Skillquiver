---
name: windows-doctor
description: Use when a Windows machine misbehaves or needs tuning - slow performance, high CPU/RAM/disk usage, system file corruption, Windows Update errors (0x800f081f and similar), app crashes, disk almost full, service failures, or requests to optimize, clean, or repair Windows.
---

# Windows Doctor

## Overview

Diagnose with read-only commands, act on evidence, verify after. Never repair blind.

## Preflight

Check elevation before planning anything — admin-only commands (sfc, DISM, chkdsk repairs, Checkpoint-Computer) fail with access denied from a normal session:

```powershell
[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

- Not elevated → routes, in order: Windows `sudo` if enabled (`sudo config` tells you), else UAC: `Start-Process pwsh -Wait -Verb RunAs -ArgumentList '-Command', '<cmd> *> $env:TEMP\wd-out.txt'` — elevated output is invisible to the calling session, so redirect to a file and read it after. `-Wait` is mandatory: without it you read the file before the elevated session wrote it. Batch several admin commands into one invocation = one UAC prompt. UAC needs a human at the machine — fully unattended session: stop and report, don't retry.
- `Checkpoint-Computer` / `Get-ComputerRestorePoint` are Windows PowerShell cmdlets — from pwsh 7, wrap: `powershell.exe -Command "..."`.
- On non-English Windows, `Get-Counter` counter names are localized and fail — the triage battery below uses CIM classes, which are locale-independent.

## Safety gates

- Read-only triage before any state change.
- Restore point before persistent system changes (services, scheduled tasks, registry, drivers). Not needed for trivially reversible ones (power plan, flushdns).
- Confirm with user before: killing processes, touching user files, rebooting.
- User files: list first, confirm, Recycle Bin only — never permanent delete. Restore points do NOT protect user files.
- Never: disable Defender, disable pagefile, blanket-disable services, install third-party "optimizers". Refuse even if asked; one-line explanation.

## Triage battery (read-only, ~30s)

```powershell
# CPU right now, per process (NOT Get-Process | Sort CPU — that's cumulative since process start)
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name!='_Total' AND Name!='Idle'" |
  Sort-Object PercentProcessorTime -Descending |
  Select-Object -First 10 Name, PercentProcessorTime, @{n='MemMB';e={[int]($_.WorkingSetPrivate/1MB)}}
[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)          # free RAM, MB
Get-PSDrive C | Select-Object @{n='FreeGB';e={[int]($_.Free/1GB)}}
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus
Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 15 |
  Format-Table TimeCreated, Id, ProviderName
```

App crashes: `LogName='Application'; Id=1000` — `Properties[0]`=app, `Properties[3]`=faulting module. Same system DLL across many apps ⇒ suspect corruption.

## Playbooks

### System corruption / Windows Update errors

Order matters — SFC repairs FROM the component store, so DISM first. All admin.

```powershell
chkdsk C: /scan                                  # read-only FS check; errors ⇒ backup first, stop
Dism /Online /Cleanup-Image /CheckHealth         # seconds
Dism /Online /Cleanup-Image /ScanHealth          # 10-20 min
Dism /Online /Cleanup-Image /RestoreHealth
# RestoreHealth itself fails with 0x800f081f (payload missing) → use install media of the SAME build:
# Dism /Online /Cleanup-Image /RestoreHealth /Source:WIM:<media>\sources\install.wim:1 /LimitAccess
sfc /scannow
Select-String -Path "$env:windir\Logs\CBS\CBS.log" -Pattern '\[SR\].*(corrupt|repair)' | Select-Object -Last 40
```

Update still broken → reset caches by **rename, never delete**:

```powershell
Stop-Service wuauserv,bits,cryptsvc,msiserver -Force
Rename-Item C:\Windows\SoftwareDistribution SoftwareDistribution.old
Rename-Item C:\Windows\System32\catroot2 catroot2.old
Start-Service cryptsvc,msiserver,bits,wuauserv
```

Reboot (confirm first) → re-run CheckHealth + retry the update = success criteria.

### Disk full

Measure → clean regenerable → re-measure → only then user files (list + confirm + Recycle Bin).

```powershell
Remove-Item "$env:TEMP\*","C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
Stop-Service wuauserv,bits -Force
Remove-Item C:\Windows\SoftwareDistribution\Download\* -Recurse -Force -ErrorAction SilentlyContinue
Start-Service wuauserv,bits
Dism /Online /Cleanup-Image /StartComponentCleanup   # WinSxS, admin
```

Recycle Bin delete for user files:

```powershell
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path,'OnlyErrorDialogs','SendToRecycleBin')
```

### Slow PC

Triage battery → act on the culprit only:

| Finding | Action |
|---|---|
| Process eating CPU/RAM | Confirm → `Stop-Process`; startup app → `Disable-ScheduledTask` / startup disable (restore point first) |
| <10% disk free | Disk-full playbook |
| `HealthStatus` ≠ Healthy | STOP — backup first, no repairs |
| TiWorker / MsMpEng busy | Wait or reschedule; never disable Update/Defender |
| Nothing obvious | Reboot (confirm) — clears leaks and stuck updates |

### "Optimize" requests

Evidence-based only: `powercfg /setactive SCHEME_MIN`, startup-app cleanup, GPU driver update, Game Mode on, HAGS (`HwSchMode=2`) only if the GPU supports it. Viral tweaks (pagefile off, Defender off, service "debloat", registry FPS hacks) → refuse per safety gates.

### Restore point (before persistent changes)

```powershell
powershell.exe -Command "Checkpoint-Computer -Description 'pre-repair' -RestorePointType MODIFY_SETTINGS"
powershell.exe -Command "Get-ComputerRestorePoint"   # VERIFY — creation is silently skipped if one exists <24h
```

## Gotchas

| Trap | Reality |
|---|---|
| `Get-Process \| Sort CPU` | Cumulative since process start, not current — use the battery's perf counters |
| Assuming admin | Check first — then sudo or UAC route |
| `cleanmgr` | Opens a GUI; blocks a headless session — use the disk-full playbook instead |
| `Checkpoint-Computer` "succeeded" | Silently skipped inside the 24h window — verify with `Get-ComputerRestorePoint` |
| Restore point = backup | It does NOT protect user files |
| sfc/DISM exit message | Verify CBS.log and re-test the original symptom |

## Verify

Every repair ends by re-running the check that detected the problem. No re-test = not fixed.
