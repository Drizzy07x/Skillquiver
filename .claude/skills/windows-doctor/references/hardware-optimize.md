# Optimize by detected hardware

Detect first (read-only) — recommendations follow the machine, not a generic list:

```powershell
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors
[int]((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)          # RAM GB
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus
(Get-CimInstance Win32_SystemEnclosure).ChassisTypes    # 9,10,14,31 = laptop; 3,4,6,7 = desktop
Get-CimInstance Win32_Battery                            # non-empty ⇒ laptop
powercfg /getactivescheme
```

| Hardware evidence | Adjustment |
|---|---|
| Desktop + dedicated GPU | `powercfg /setactive SCHEME_MIN` (High performance); Game Mode on |
| Laptop | Balanced; skip High performance — heat and battery cost for marginal gain |
| GPU supports hardware scheduling | HAGS: `HwSchMode=2` under `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers` — restore point + reboot |
| RAM < 8 GB | Startup cleanup (`references/boot.md`); visual effects → performance: `VisualFXSetting=2` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects` + re-logon (GUI: `SystemPropertiesPerformance.exe`, needs a human); pagefile stays system-managed ON |
| SSD | Verify TRIM: `fsutil behavior query DisableDeleteNotify` (0 = enabled); never manual defrag |
| HDD | SysMain off only with disk-100 evidence (`references/disk-100.md`); scheduled optimization stays on |
| Old GPU driver + gaming complaint | Vendor driver update → `references/drivers.md` |

An adjustment with no matching hardware line above is cargo cult — skip it. Viral tweaks (pagefile off, service "debloat", registry FPS hacks, third-party optimizers) → refuse per core gates.

Verify: re-measure the complaint (fps, responsiveness, battery) or at minimum confirm the setting stuck (`powercfg /getactivescheme`, `fsutil` query).
