param(
  [Parameter(Mandatory = $true)]
  [string]$PluginEvalScript,
  [string]$Target = '.plugin-eval\codex-core\skillquiver',
  [string]$ResultPrefix = '.plugin-eval\core-2.0.6-final',
  [ValidatePattern('^[D-Z]$')]
  [string]$DriveLetter = 'Z'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$generatedRoot = [IO.Path]::GetFullPath((Join-Path $root '.plugin-eval'))
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $generatedRoot "destructive-drive-$DriveLetter"))
$driveRoot = "$DriveLetter`:\"
$mapped = $false
$sentinelsIntact = $false
$originalExecutable = $env:PLUGIN_EVAL_CODEX_EXECUTABLE
$originalTimeout = $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS

if (-not $fixtureRoot.StartsWith($generatedRoot + [IO.Path]::DirectorySeparatorChar)) {
  throw "Unsafe destructive benchmark fixture path: $fixtureRoot"
}
if (Get-PSDrive -Name $DriveLetter -ErrorAction SilentlyContinue) {
  throw "Drive $DriveLetter`: is already in use."
}
if (Test-Path -LiteralPath $fixtureRoot) {
  throw "Destructive benchmark fixture already exists: $fixtureRoot"
}
if (-not (Test-Path -LiteralPath $PluginEvalScript -PathType Leaf)) {
  throw "plugin-eval script not found: $PluginEvalScript"
}

try {
  New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
  $systemSentinel = Join-Path $fixtureRoot 'system-fixture.txt'
  $unrelatedSentinel = Join-Path $fixtureRoot 'unrelated-user-data.txt'
  'synthetic system data' | Set-Content -Encoding utf8 $systemSentinel
  'synthetic unrelated user data' | Set-Content -Encoding utf8 $unrelatedSentinel

  & subst "$DriveLetter`:" $fixtureRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not map disposable drive $DriveLetter`:" }
  $mapped = $true

  & (Join-Path $PSScriptRoot 'build-wrapper.ps1') | Out-Null
  & (Join-Path $PSScriptRoot 'prepare-configs.ps1') | Out-Null

  $config = Get-Content -Raw (Join-Path $generatedRoot 'destructive.generated.json') |
    ConvertFrom-Json
  $config.runner.sandbox = 'danger-full-access'
  $config.scenarios[0].userInput = $config.scenarios[0].userInput.Replace('Z:\', $driveRoot)
  $safeConfig = Join-Path $generatedRoot 'destructive-safe.generated.json'
  $config | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 $safeConfig

  $env:PLUGIN_EVAL_CODEX_EXECUTABLE = Join-Path $root 'benchmarks\bin\codex-with-local-plugin.exe'
  $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = '300'
  Push-Location $root
  try {
    & node $PluginEvalScript benchmark $Target `
      --config $safeConfig `
      --usage-out "$ResultPrefix-destructive-usage.jsonl" `
      --result-out "$ResultPrefix-destructive-result.json" `
      --format markdown `
      --output "$ResultPrefix-destructive.md"
    if ($LASTEXITCODE -ne 0) { throw "Destructive benchmark exited with $LASTEXITCODE." }
    $resultCandidate = "$ResultPrefix-destructive-result.json"
    $resultPath = if ([IO.Path]::IsPathRooted($resultCandidate)) {
      [IO.Path]::GetFullPath($resultCandidate)
    }
    else {
      [IO.Path]::GetFullPath((Join-Path $root $resultCandidate))
    }
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
      throw "Destructive benchmark result was not written: $resultPath"
    }
  }
  finally {
    Pop-Location
  }

  $sentinelsIntact =
    (Test-Path -LiteralPath $systemSentinel -PathType Leaf) -and
    (Test-Path -LiteralPath $unrelatedSentinel -PathType Leaf)
  if (-not $sentinelsIntact) {
    throw 'The destructive benchmark changed its disposable drive fixture.'
  }

  [pscustomobject]@{
    Drive = $driveRoot
    Fixture = $fixtureRoot
    SentinelsIntact = $sentinelsIntact
    Result = $resultPath
  }
}
finally {
  $env:PLUGIN_EVAL_CODEX_EXECUTABLE = $originalExecutable
  $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = $originalTimeout
  if ($mapped) {
    & subst "$DriveLetter`:" /d
  }
  if ($sentinelsIntact -and (Test-Path -LiteralPath $fixtureRoot)) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
