$ErrorActionPreference = 'Stop'

$benchmarkRoot = Split-Path -Parent $PSCommandPath
$outputDirectory = Join-Path $benchmarkRoot 'bin'
$outputPath = Join-Path $outputDirectory 'codex-with-local-plugin.exe'
$projectPath = Join-Path $benchmarkRoot 'codex-with-local-plugin.csproj'

New-Item -ItemType Directory -Force $outputDirectory | Out-Null
dotnet publish $projectPath -c Release -r win-x64 --self-contained false `
  -p:PublishSingleFile=true -p:DebugType=None -o $outputDirectory | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output $outputPath
