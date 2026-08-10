---
name: windows-doctor
description: Use when a Windows machine misbehaves or needs tuning - slow performance, high CPU/RAM/disk usage, disk stuck at 100%, BSOD or spontaneous reboots, slow boot, slow or no internet, system file corruption, Windows Update errors (0x800f081f and similar), app crashes, disk almost full, missing or broken drivers, service failures, toggling Windows Defender or adding exclusions, or requests to optimize, clean, or repair Windows.
---

# Windows Doctor

## Overview

Diagnose with read-only commands, act on evidence, verify after. Never repair blind. Playbooks live in `references/` — triage first, then read ONLY the file the symptom routes to.

## Preflight

Check elevation before planning anything — admin-only commands (sfc, DISM, chkdsk repairs, Checkpoint-Computer) fail with access denied from a normal session:

```powershell
[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

- Not elevated → routes, in order: Windows `sudo` if enabled (`sudo config` tells you), else UAC: `Start-Process pwsh -Wait -Verb RunAs -ArgumentList '-Command', "<cmd> *> $env:TEMP\wd-out.txt"` — elevated output is invisible to the calling session, so redirect to a file and read it after. Double quotes matter: the CALLER's TEMP path gets baked in, so it still works when elevation uses a different admin account (whose own TEMP the caller can't read). `-Wait` is mandatory: without it you read the file before the elevated session wrote it. Batch several admin commands into one invocation = one UAC prompt. UAC needs a human at the machine — fully unattended session: stop and report, don't retry.
- `Checkpoint-Computer` / `Get-ComputerRestorePoint` are Windows PowerShell cmdlets — from pwsh 7, wrap: `powershell.exe -Command "..."`.
- On non-English Windows, `Get-Counter` counter names are localized and fail — the triage battery below uses CIM classes, which are locale-independent.

## Safety gates

- Read-only triage before any state change.
- Restore point before persistent system changes (services, scheduled tasks, registry, drivers, startup apps). Not needed for trivially reversible ones (power plan, flushdns).
- Confirm with user before: killing processes, touching user files, rebooting, turning off Defender real-time protection.
- User files: list first, confirm, Recycle Bin only — never permanent delete. Restore points do NOT protect user files.
- Defender: exclusions, real-time toggle, or full permanent disable are all allowed (see `references/defender.md`) — escalate in that order, confirm before each, VERIFY actual state after with `Get-MpComputerStatus`. A full kill leaves the machine with no AV: say so plainly and remind to re-enable when the work is done.
- Never: disable pagefile, blanket-disable services (documented exceptions: SysMain on HDD `references/disk-100.md`, and Defender when explicitly requested `references/defender.md`), install third-party "optimizers", driver-updaters, or "Defender remover" tools. Refuse even if asked; one-line explanation.

## Triage battery (read-only, ~30s)

```powershell
# CPU right now, per process (NOT Get-Process | Sort CPU — that's cumulative since process start)
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name!='_Total' AND Name!='Idle'" |
  Sort-Object PercentProcessorTime -Descending |
  Select-Object -First 10 Name, PercentProcessorTime, @{n='MemMB';e={[int]($_.WorkingSetPrivate/1MB)}}
[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)          # free RAM, MB
Get-PSDrive C | Select-Object @{n='FreeGB';e={[int]($_.Free/1GB)}}
Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name!='_Total'" |
  Select-Object Name, PercentDiskTime, CurrentDiskQueueLength   # AvgDisksec* here is integer seconds — useless, don't add it
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus
Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 15 |
  Format-Table TimeCreated, Id, ProviderName
```

App crashes: `LogName='Application'; Id=1000` — `Properties[0]`=app, `Properties[3]`=faulting module. Same system DLL across many apps ⇒ suspect corruption.

## Routing: symptom → playbook

Read the matching file and follow it; don't load the rest.

| Symptom / finding | Read |
|---|---|
| Update errors, corruption suspected, same DLL in many crashes | `references/corruption-update.md` |
| <10% disk free | `references/disk-full.md` |
| Blue screen, spontaneous reboots | `references/bsod.md` |
| Slow or no internet, DNS failures | `references/network.md` |
| Disk at 100% in Task Manager, system stalls | `references/disk-100.md` |
| Slow boot | `references/boot.md` |
| Defender on/off, false positives, AV exclusions | `references/defender.md` |
| "Optimize my PC" | `references/hardware-optimize.md` |
| Device without driver, device errors, driver install/rollback | `references/drivers.md` |
| Service fails to start or keeps crashing (SCM events 7000/7001/7031 in triage output) | `references/services.md` |

### Slow PC (route by triage evidence)

| Finding | Action |
|---|---|
| Process eating CPU/RAM | Confirm → `Stop-Process`; startup app → `references/boot.md` |
| <10% disk free | `references/disk-full.md` |
| Disk queue high / disk at 100% | `references/disk-100.md` |
| `HealthStatus` ≠ Healthy | STOP — backup first, no repairs |
| TiWorker / MsMpEng busy | Wait or reschedule; never disable Update |
| Nothing obvious | Reboot (confirm) — clears leaks and stuck updates |

## Restore point (before persistent changes)

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
| Task Manager disk 100% | Busy-time, not saturation — check queue length before "fixing" it |
| `Set-MpPreference` off "succeeded" | Tamper Protection reverts it silently — `Get-MpComputerStatus` is the only truth |

## Verify

Every repair ends by re-running the check that detected the problem. No re-test = not fixed.
