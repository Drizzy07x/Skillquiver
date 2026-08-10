# Disk full

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

Verify: re-measure free space (`Get-PSDrive C`); success = the threshold that triggered this playbook is cleared.
