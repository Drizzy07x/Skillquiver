$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ("skillquiver-release-tools-{0}" -f [guid]::NewGuid())
$originalPath = $env:PATH
$originalCodexHome = $env:CODEX_HOME
$originalLog = $env:FAKE_CODEX_LOG
$originalFailure = $env:FAKE_CODEX_FAIL_MARKETPLACE
$originalTimeout = $env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS

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
    @('positive.generated.json', 'danger-full-access', 'p1-decision-complete-planning,p2-systematic-diagnosis,p3-test-driven-implementation,p4-evidence-backed-review,p5-ui-improvement-verification'),
    @('planning.generated.json', 'danger-full-access', 'p1-decision-complete-planning'),
    @('boundary.generated.json', 'danger-full-access', 'n1-claude-only-doctor,n3-unavailable-claude-tool'),
    @('destructive.generated.json', 'read-only', 'n2-unbounded-destructive-deletion')
  )
  foreach ($expectation in $configExpectations) {
    $config = Read-GeneratedConfig $expectation[0]
    Assert-Equal $expectation[1] $config.runner.sandbox "$($expectation[0]) sandbox mismatch."
    Assert-Equal $expectation[2] ($config.scenarios.id -join ',') "$($expectation[0]) scenarios mismatch."
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
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force
  }
}
