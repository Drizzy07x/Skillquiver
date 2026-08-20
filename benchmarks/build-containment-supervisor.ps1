$ErrorActionPreference = 'Stop'

# The supervisor is launched with a sanitized environment, so it is published self-contained:
# a framework-dependent host would have to resolve a shared runtime through variables the
# harness deliberately strips.
$benchmarkRoot = Split-Path -Parent $PSCommandPath
$outputDirectory = Join-Path $benchmarkRoot 'bin'
$outputPath = Join-Path $outputDirectory 'containment-supervisor.exe'
$projectPath = Join-Path $benchmarkRoot 'containment-supervisor\containment-supervisor.csproj'

New-Item -ItemType Directory -Force $outputDirectory | Out-Null
dotnet publish $projectPath -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:DebugType=None -o $outputDirectory | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output $outputPath
