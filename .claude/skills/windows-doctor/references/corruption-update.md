# System corruption / Windows Update errors

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
