# Disk at 100%

Task Manager's 100% is busy-time, not saturation. Measure the queue first:

```powershell
Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name!='_Total'" |
  Select-Object Name, PercentDiskTime, CurrentDiskQueueLength
# Who is doing the IO
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name!='_Total' AND Name!='Idle'" |
  Sort-Object IODataOperationsPersec -Descending |
  Select-Object -First 10 Name, IODataOperationsPersec
```

Interpretation:

- Sustained queue ≤2 per disk → disk is fine; the slowness is elsewhere (back to triage). Sample a few times — a single read proves nothing.
- Sustained queue >2 → act on the top IO process below.
- The CIM `AvgDisksec*` properties are integer seconds — always 0 below 1s latency, never use them. Real latency (`Get-Counter '\PhysicalDisk(*)\Avg. Disk sec/Transfer'`, float; >0.02s sustained = struggling disk) only works on English Windows — counter names are localized; queue length is the locale-safe signal.
- Health first: `Get-PhysicalDisk | Get-StorageReliabilityCounter` — HealthStatus ≠ Healthy or climbing read errors ⇒ STOP, backup, no repairs.

| Culprit | Action |
|---|---|
| SysMain on **HDD** | Legit to disable — restore point first: `Stop-Service SysMain; Set-Service SysMain -StartupType Disabled`. On SSD leave it alone |
| SearchIndexer | First-time indexing → let it finish. Recurring → reduce scope (Settings → Searching Windows) or rebuild index; do NOT disable the service |
| TiWorker / wuauserv | Update servicing — wait or adjust active hours; never disable |
| MsMpEng | Scan in progress — wait or schedule scans; hot dev folders → exclusions via `references/defender.md` |
| OneDrive / backup / sync | Pause sync to confirm attribution, then fix its schedule or scope |
| Ordinary app doing heavy IO | Confirm with user → close it or `Stop-Process` |

Verify: re-run the queue measurement — success = queue back ≤2 and the stalls gone.
