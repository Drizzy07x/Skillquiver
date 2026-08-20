$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ("skillquiver-release-tools-{0}" -f [guid]::NewGuid())
$originalPath = $env:PATH
$originalCodexHome = $env:CODEX_HOME
$originalLog = $env:FAKE_CODEX_LOG
$originalFailure = $env:FAKE_CODEX_FAIL_MARKETPLACE
$originalTimeout = $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS
$escapeLink = $null
$escapeTarget = $null

function Assert-Equal {
  param($Expected, $Actual, [string]$Message)
  if ($Expected -ne $Actual) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

function Read-GeneratedConfig {
  param([string]$Name)
  return Get-Content -Raw (Join-Path $root ".plugin-eval\$Name") | ConvertFrom-Json
}

New-Item -ItemType Directory -Force $work | Out-Null

try {
  & (Join-Path $root 'benchmarks\prepare-configs.ps1') | Out-Null

  $configExpectations = @(
    @('positive.generated.json', 'danger-full-access', 'p1-decision-complete-planning,p2-systematic-diagnosis,p3-test-driven-implementation,p4-evidence-backed-review'),
    @('planning.generated.json', 'danger-full-access', 'p1-decision-complete-planning'),
    @('doctor.generated.json', 'danger-full-access', 'p5-doctor-read-only-audit'),
    @('doctor-boundary.generated.json', 'danger-full-access', 'n1-doctor-bulk-cleanup'),
    @('boundary.generated.json', 'danger-full-access', 'n3-unavailable-claude-tool'),
    @('destructive.generated.json', 'read-only', 'n2-unbounded-destructive-deletion')
  )
  foreach ($expectation in $configExpectations) {
    $config = Read-GeneratedConfig $expectation[0]
    Assert-Equal $expectation[1] $config.runner.sandbox "$($expectation[0]) sandbox mismatch."
    Assert-Equal $expectation[2] ($config.scenarios.id -join ',') "$($expectation[0]) scenarios mismatch."
  }
  $doctorConfig = Read-GeneratedConfig 'doctor.generated.json'
  Assert-Equal 'benchmarks/workspace-doctor' $doctorConfig.workspace.sourcePath `
    'Doctor benchmark must use the duplicate-source workspace.'

  $packageArtifactRoot = Join-Path $work 'codex-package'
  $firstPackage = & (Join-Path $root 'benchmarks\build-codex-package.ps1') `
    -ArtifactRoot $packageArtifactRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $secondPackage = & (Join-Path $root 'benchmarks\build-codex-package.ps1') `
    -ArtifactRoot $packageArtifactRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Assert-Equal $firstPackage.Sha256 $secondPackage.Sha256 `
    'Consecutive package builds must have the same SHA-256.'
  Assert-Equal 24 $secondPackage.SkillCount 'The release archive must contain 24 skills.'
  if (-not (Test-Path -LiteralPath $secondPackage.ArchivePath)) {
    throw 'The release archive was not created.'
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($secondPackage.ArchivePath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object FullName)
    Assert-Equal (($entryNames | Sort-Object) -join "`n") ($entryNames -join "`n") `
      'Archive entries must be written in sorted order.'
    Assert-Equal 24 @($entryNames | Where-Object { $_ -match '^skills/[^/]+/SKILL\.md$' }).Count `
      'Archive skill entry count mismatch.'
    if ($entryNames | Where-Object { $_ -match '(^/|(^|/)\.\.(/|$)|\\)' }) {
      throw 'The release archive contains an unsafe path.'
    }
    $manifestEntry = $archive.GetEntry('.codex-plugin/plugin.json')
    if (-not $manifestEntry) { throw 'The release archive is missing plugin.json.' }
    $reader = [IO.StreamReader]::new($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json }
    finally { $reader.Dispose() }
    Assert-Equal 'skillquiver' $manifest.name 'Archive manifest name mismatch.'
    Assert-Equal '2.2.0' $manifest.version 'Archive manifest version mismatch.'
    $executableEntries = @(
      'skills/brainstorming/scripts/start-server.sh',
      'skills/brainstorming/scripts/stop-server.sh',
      'skills/diagnose-systematically/find-polluter.sh'
    )
    foreach ($entryName in $executableEntries) {
      $executableEntry = $archive.GetEntry($entryName)
      if (-not $executableEntry) { throw "The release archive is missing $entryName." }
      $unixPermissions = ($executableEntry.ExternalAttributes -shr 16) -band 0x1FF
      Assert-Equal 493 $unixPermissions "$entryName must retain mode 0755."
    }
  }
  finally {
    $archive.Dispose()
  }

  $archiveBytes = [IO.File]::ReadAllBytes($secondPackage.ArchivePath)
  $endOffset = -1
  for ($offset = $archiveBytes.Length - 22; $offset -ge 0; $offset--) {
    if ($archiveBytes[$offset] -eq 0x50 -and $archiveBytes[$offset + 1] -eq 0x4B -and
        $archiveBytes[$offset + 2] -eq 0x05 -and $archiveBytes[$offset + 3] -eq 0x06) {
      $endOffset = $offset
      break
    }
  }
  if ($endOffset -lt 0) { throw 'The release ZIP has no end-of-central-directory record.' }
  $centralEntryCount = [BitConverter]::ToUInt16($archiveBytes, $endOffset + 10)
  $offset = [int64][BitConverter]::ToUInt32($archiveBytes, $endOffset + 16)
  for ($index = 0; $index -lt $centralEntryCount; $index++) {
    if ($archiveBytes[$offset] -ne 0x50 -or $archiveBytes[$offset + 1] -ne 0x4B -or
        $archiveBytes[$offset + 2] -ne 0x01 -or $archiveBytes[$offset + 3] -ne 0x02) {
      throw 'The release ZIP central directory is malformed.'
    }
    Assert-Equal 3 $archiveBytes[$offset + 5] `
      'ZIP central-directory entries must declare a Unix creator system.'
    $nameLength = [BitConverter]::ToUInt16($archiveBytes, $offset + 28)
    $extraLength = [BitConverter]::ToUInt16($archiveBytes, $offset + 30)
    $commentLength = [BitConverter]::ToUInt16($archiveBytes, $offset + 32)
    $offset += 46 + $nameLength + $extraLength + $commentLength
  }
  Assert-Equal $secondPackage.EntryCount $centralEntryCount `
    'ZIP central-directory entry count mismatch.'

  $unsafeArtifactRoot = Join-Path (Split-Path -Parent $root) `
    ("skillquiver-outside-{0}" -f [guid]::NewGuid())
  try {
    & (Join-Path $root 'benchmarks\build-codex-package.ps1') `
      -ArtifactRoot $unsafeArtifactRoot | Out-Null
    throw 'The release builder accepted an unsafe artifact root.'
  }
  catch {
    if ($_.Exception.Message -notmatch 'artifact root or system temp') { throw }
  }
  if (Test-Path -LiteralPath $unsafeArtifactRoot) {
    throw 'The release builder created an unsafe artifact root before rejecting it.'
  }

  $escapeTarget = Join-Path $root ".plugin-eval\release-escape-target-$([guid]::NewGuid())"
  $escapeLink = Join-Path $root ".plugin-eval\codex-package\release-escape-link-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Force $escapeTarget | Out-Null
  New-Item -ItemType Junction -Path $escapeLink -Target $escapeTarget | Out-Null
  $escapedArtifactRoot = Join-Path $escapeLink 'created-outside-boundary'
  $escapeLog = Join-Path $work 'escape-builder.log'
  & pwsh -NoLogo -NoProfile -File (Join-Path $root 'benchmarks\build-codex-package.ps1') `
    -ArtifactRoot $escapedArtifactRoot *> $escapeLog
  if ($LASTEXITCODE -eq 0) {
    throw 'The release builder accepted an artifact root through an escaping junction.'
  }
  if (Test-Path -LiteralPath (Join-Path $escapeTarget 'created-outside-boundary')) {
    throw 'The release builder created a directory through an escaping junction.'
  }

  $fakePluginEval = Join-Path $work 'fake-plugin-eval.cjs'
  @'
const fs = require('node:fs');
const path = require('node:path');

for (const flag of ['--usage-out', '--result-out', '--output']) {
  const index = process.argv.indexOf(flag);
  if (index === -1) continue;
  const output = path.resolve(process.argv[index + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, flag === '--result-out' ? '{"scenarios":[]}' : 'fixture\n');
}
'@ | Set-Content -Encoding utf8 $fakePluginEval
  $testDrive = @('Y', 'X', 'W', 'V') | Where-Object {
    -not (Get-PSDrive -Name $_ -ErrorAction SilentlyContinue)
  } | Select-Object -First 1
  if (-not $testDrive) { throw 'No disposable drive letter is available for the safety harness test.' }
  $safePrefix = Join-Path $work 'safe-destructive'
  $safeResult = & (Join-Path $root 'benchmarks\run-safe-destructive.ps1') `
    -PluginEvalScript $fakePluginEval `
    -Target 'unused-target' `
    -ResultPrefix $safePrefix `
    -DriveLetter $testDrive
  Assert-Equal $true $safeResult.SentinelsIntact 'Disposable sentinels were not preserved.'
  if (Get-PSDrive -Name $testDrive -ErrorAction SilentlyContinue) {
    throw 'The disposable drive mapping was not removed.'
  }
  if (Test-Path -LiteralPath (Join-Path $root ".plugin-eval\destructive-drive-$testDrive")) {
    throw 'The intact disposable fixture was not removed.'
  }
  $safeConfig = Read-GeneratedConfig 'destructive-safe.generated.json'
  Assert-Equal 'danger-full-access' $safeConfig.runner.sandbox 'Safe destructive sandbox mismatch.'
  if ($safeConfig.scenarios[0].userInput -notmatch "${testDrive}:\\") {
    throw 'The safe destructive prompt did not use the disposable drive.'
  }

  $fakeCodexSource = @'
using System;
using System.IO;
using System.Threading;

internal static class FakeCodex
{
    public static int Main(string[] arguments)
    {
        var logPath = Environment.GetEnvironmentVariable("FAKE_CODEX_LOG");
        var record = string.Join("\u001f", arguments) + "\tHOME=" +
            Environment.GetEnvironmentVariable("HOME") + "\tUSERPROFILE=" +
            Environment.GetEnvironmentVariable("USERPROFILE") + Environment.NewLine;
        File.AppendAllText(logPath, record);

        if (arguments.Length > 0 && arguments[0] == "sleep")
        {
            Thread.Sleep(5000);
        }
        if (Environment.GetEnvironmentVariable("FAKE_CODEX_FAIL_MARKETPLACE") == "1" &&
            arguments.Length > 2 && arguments[0] == "plugin" && arguments[1] == "marketplace")
        {
            return 7;
        }
        return 0;
    }
}
'@
  $fakeProject = Join-Path $work 'fake-codex'
  $fakeOutput = Join-Path $fakeProject 'output'
  New-Item -ItemType Directory -Force $fakeProject | Out-Null
  $fakeCodexSource | Set-Content -Encoding utf8 (Join-Path $fakeProject 'Program.cs')
  @'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <AssemblyName>codex</AssemblyName>
  </PropertyGroup>
</Project>
'@ | Set-Content -Encoding utf8 (Join-Path $fakeProject 'fake-codex.csproj')
  dotnet publish (Join-Path $fakeProject 'fake-codex.csproj') -c Release `
    -r win-x64 --self-contained false -o $fakeOutput | Out-Null
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $fakeCodex = Join-Path $fakeOutput 'codex.exe'

  $wrapper = & (Join-Path $root 'benchmarks\build-wrapper.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $logPath = Join-Path $work 'codex.log'
  $isolatedHome = Join-Path $work 'home'
  $env:PATH = "$fakeOutput;$originalPath"
  $env:CODEX_HOME = Join-Path $isolatedHome '.codex'
  $env:FAKE_CODEX_LOG = $logPath

  & $wrapper --version | Out-Null
  Assert-Equal 0 $LASTEXITCODE 'PATH discovery or argument forwarding failed.'
  $versionRecord = Get-Content -Raw $logPath
  if ($versionRecord -notmatch '^--version') { throw 'The wrapper did not forward --version.' }
  if ($versionRecord -notmatch [regex]::Escape("HOME=$isolatedHome")) {
    throw 'The wrapper did not remap HOME from CODEX_HOME.'
  }
  if ($versionRecord -notmatch [regex]::Escape("USERPROFILE=$isolatedHome")) {
    throw 'The wrapper did not remap USERPROFILE from CODEX_HOME.'
  }

  $missingWorkspaceError = Join-Path $work 'missing-workspace.stderr'
  & $wrapper exec --json 'safe prompt' 2> $missingWorkspaceError | Out-Null
  Assert-Equal 2 $LASTEXITCODE 'Missing --cd should fail before setup.'
  if ((Get-Content -Raw $missingWorkspaceError) -notmatch 'could not resolve the Codex workspace') {
    throw 'Missing workspace error was not reported.'
  }

  Clear-Content $logPath
  $workspace = Join-Path $work 'workspace'
  New-Item -ItemType Directory -Force $workspace | Out-Null
  & $wrapper exec --cd $workspace --json 'safe prompt' | Out-Null
  Assert-Equal 0 $LASTEXITCODE 'Successful benchmark setup failed.'
  $records = @(Get-Content $logPath)
  Assert-Equal 3 $records.Count 'The wrapper should run two setup commands and the benchmark.'
  if ($records[0] -notmatch '^plugin.marketplace.add') { throw 'Marketplace setup was not first.' }
  if ($records[1] -notmatch '^plugin.add.skillquiver@plugin-eval-benchmark') {
    throw 'Plugin installation was not second.'
  }
  if ($records[2] -notmatch '^exec') { throw 'The benchmark command was not last.' }

  Clear-Content $logPath
  $env:FAKE_CODEX_FAIL_MARKETPLACE = '1'
  & $wrapper exec --cd $workspace --json 'safe prompt' | Out-Null
  Assert-Equal 7 $LASTEXITCODE 'Setup failures must stop the benchmark.'
  Assert-Equal 1 @(Get-Content $logPath).Count 'The wrapper continued after setup failure.'
  Remove-Item Env:FAKE_CODEX_FAIL_MARKETPLACE

  $timeoutError = Join-Path $work 'timeout.stderr'
  $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = '1'
  & $wrapper sleep 2> $timeoutError | Out-Null
  Assert-Equal 124 $LASTEXITCODE 'Timed out benchmarks must return 124.'
  if ((Get-Content -Raw $timeoutError) -notmatch 'timed out after 1 seconds') {
    throw 'Timeout error was not reported.'
  }

  Write-Output 'Windows release tool tests passed'
}
finally {
  $env:PATH = $originalPath
  $env:CODEX_HOME = $originalCodexHome
  $env:FAKE_CODEX_LOG = $originalLog
  $env:FAKE_CODEX_FAIL_MARKETPLACE = $originalFailure
  $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = $originalTimeout
  if ($escapeLink -and (Test-Path -LiteralPath $escapeLink)) {
    Remove-Item -LiteralPath $escapeLink -Force
  }
  if ($escapeTarget -and (Test-Path -LiteralPath $escapeTarget)) {
    Remove-Item -LiteralPath $escapeTarget -Recurse -Force
  }
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force
  }
}
