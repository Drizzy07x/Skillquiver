# Slow boot

Measure before touching anything. Boot-duration events need an **elevated** session to read:

```powershell
# Id 100 = boot duration; 101-110 = which component degraded it. Named XML fields = locale-independent.
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Diagnostics-Performance/Operational'; Id=100} -MaxEvents 5 |
  ForEach-Object { $x=[xml]$_.ToXml(); "{0}  {1} ms" -f $_.TimeCreated, ($x.Event.EventData.Data | Where-Object Name -eq 'BootTime').'#text' }
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Diagnostics-Performance/Operational'; Id=@(101..110)} -MaxEvents 10 |
  Format-List TimeCreated, Message   # names the offending app/driver/service
```

Startup inventory (read-only):

```powershell
Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User
Get-ScheduledTask | Where-Object State -eq 'Ready' |
  Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon|Boot' } | Select-Object TaskName, TaskPath
```

Act on evidence — restore point + confirm before each:

- Startup app named by events or obviously heavy → record its `Command` line first, then remove its Run-key value (`Remove-ItemProperty`) or `Disable-ScheduledTask`. The recorded line is the rollback.
- Degradation events naming a driver → `references/drivers.md`.
- HDD system disk → Fast Startup helps; leave it on. Disabling hibernation (`powercfg /hibernate off`, frees hiberfil.sys) also kills Fast Startup — only for dual-boot/update problems, say so.
- Machine that does NOT boot at all = WinRE/`bootrec` territory — out of scope for a live session; hand the user the WinRE steps instead of experimenting.

Verify: reboot (confirm) → compare the new Id 100 duration against the measured baseline.
