# Service fails to start or keeps crashing

Triage's System-log battery surfaces these as SCM events: 7000/7001 (failed to start, dependency failed), 7031/7034 (crashed/terminated unexpectedly), 7009 (start timeout).

Identify and inspect first (read-only):

```powershell
# Name the failing service from the event
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'; Id=7000,7001,7009,7031,7034; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 15 |
  ForEach-Object { $x=[xml]$_.ToXml(); "{0}  Id={1}  {2}" -f $_.TimeCreated, $_.Id, ($x.Event.EventData.Data | Select-Object -First 1 -ExpandProperty '#text') }
Get-Service <name> | Select-Object Status, StartType, DependentServices, ServicesDependedOn
sc.exe qc <name>          # binary path, account, dependencies
sc.exe qfailure <name>    # configured recovery actions
```

Act on evidence — restore point + confirm before each change:

- **Dependency stopped** (7001) → start the dependency chain bottom-up: `Start-Service <dependency>` then the failing service. If a dependency's StartType is Disabled, that's usually the real defect — restore its documented default, don't guess.
- **Crashing service binary** (7031/7034 repeating) → check the binary exists at the `sc.exe qc` path; missing/corrupt system service binary → `references/corruption-update.md` (DISM/SFC). Third-party service crashing → reinstall/update that application; don't patch around it.
- **Start timeout** (7009) on HDD or during boot storms → often load-order noise; verify the service starts fine manually (`Start-Service`) before changing anything.
- **StartType was changed** (service Disabled but should run) → restore the default StartType with `Set-Service -StartupType`, record the previous value as rollback.

Never blanket-disable a failing service to silence the events — that hides the symptom. The documented disable exceptions remain SysMain (`references/disk-100.md`) and Defender (`references/defender.md`).

Verify: `Get-Service <name>` shows Running (or its default state), and no new 70xx events for the service after a reboot (confirm reboot with the user).
