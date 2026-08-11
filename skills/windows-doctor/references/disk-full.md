# Disk full

Measure → clean regenerable → re-measure → only then user files (list + confirm + Recycle Bin).

```powershell
# Preview stale temp files first. Show the paths and total size, then obtain
# explicit confirmation for this exact set before deleting anything.
$tempRoots = $env:TEMP, 'C:\Windows\Temp'
$tempCutoff = (Get-Date).AddDays(-7)
$tempCandidates = Get-ChildItem -LiteralPath $tempRoots -File -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object LastWriteTime -lt $tempCutoff
$tempCandidates | Select-Object FullName, Length, LastWriteTime
($tempCandidates | Measure-Object Length -Sum).Sum / 1GB

# Run only after confirmation. Files still in use fail closed and remain.
$tempCandidates | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
}

Stop-Service wuauserv,bits -Force
try {
  Get-ChildItem -LiteralPath 'C:\Windows\SoftwareDistribution\Download' -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
} finally {
  Start-Service wuauserv,bits
}
Dism /Online /Cleanup-Image /StartComponentCleanup   # WinSxS, admin
```

Recycle Bin delete for user files:

```powershell
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path,'OnlyErrorDialogs','SendToRecycleBin')
```

Verify: re-measure free space (`Get-PSDrive C`); success = the threshold that triggered this playbook is cleared.
