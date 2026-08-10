# BSOD / spontaneous reboots

Read the crash record first — never guess from the symptom.

```powershell
# Bugcheck history: code + parameters + dump path (Properties[0] = the bugcheck string)
Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001; ProviderName='Microsoft-Windows-WER-SystemErrorReporting'} -MaxEvents 5 |
  ForEach-Object { "$($_.TimeCreated)  $($_.Properties[0].Value)" }
# Kernel-Power 41 fires on EVERY unclean shutdown, including after a BSOD — 41 alone proves nothing
Get-WinEvent -FilterHashtable @{LogName='System'; Id=41; ProviderName='Microsoft-Windows-Kernel-Power'} -MaxEvents 5 | Format-Table TimeCreated
Get-ChildItem C:\Windows\Minidump -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
```

No 1001 events + no minidumps + Kernel-Power 41 present ⇒ power/hardware cut, not a Windows crash — check PSU, cables, overheating before any software repair.

## Common codes → typical cause

| Code | Typical cause |
|---|---|
| IRQL_NOT_LESS_OR_EQUAL (0x0A), SYSTEM_SERVICE_EXCEPTION (0x3B), KERNEL_SECURITY_CHECK_FAILURE (0x139) | Driver; sometimes RAM |
| PAGE_FAULT_IN_NONPAGED_AREA (0x50), MEMORY_MANAGEMENT (0x1A) | RAM or driver — run memory test |
| WHEA_UNCORRECTABLE_ERROR (0x124) | Hardware: overclock/XMP, temperature, PSU |
| DPC_WATCHDOG_VIOLATION (0x133) | Storage driver/firmware (NVMe/SATA) |
| VIDEO_TDR_FAILURE (0x116) | GPU driver — clean reinstall from vendor |
| CRITICAL_PROCESS_DIED (0xEF) | System corruption → `references/corruption-update.md` |

## Act on evidence

- A named `.sys` driver in the event, or the same driver across crashes → update or roll back THAT driver (restore point first; mechanics in `references/drivers.md`).
- Memory-pattern codes, or nothing conclusive → `MdSched.exe` (Windows Memory Diagnostic) — pops a GUI dialog and reboots the machine: needs a human present, confirm first. Results after reboot:

```powershell
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-MemoryDiagnostics-Results'} -MaxEvents 1 | Format-List TimeCreated, Message
```

- 0x124 / Kernel-Power 41 → ask about overclock/XMP/undervolt; return to defaults and check temperatures before software repairs.
- Storage codes (0x133) → disk health from the triage battery + storage driver/firmware update.
- WinDbg (`!analyze -v` on the newest minidump) only if it is already installed; don't pull in tooling unless the above is inconclusive and the user agrees.

Verify: the workload that crashed before runs clean; no new Id 1001 events after.
