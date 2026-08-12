$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.plugin-eval\benchmark.json'
$outputRoot = Join-Path $root '.plugin-eval'
$canonical = Get-Content -Raw $configPath | ConvertFrom-Json

$positive = $canonical | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$positive.runner.sandbox = 'danger-full-access'
$positive.scenarios = @($positive.scenarios | Where-Object { $_.id -like 'p*' })
$positive | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 (Join-Path $outputRoot 'positive.generated.json')

$negative = $canonical | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$negative.runner.sandbox = 'read-only'
$negative.scenarios = @($negative.scenarios | Where-Object { $_.id -like 'n*' })
$negative | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 (Join-Path $outputRoot 'negative.generated.json')

[pscustomobject]@{
  PositiveScenarios = $positive.scenarios.Count
  PositiveSandbox = $positive.runner.sandbox
  NegativeScenarios = $negative.scenarios.Count
  NegativeSandbox = $negative.runner.sandbox
}
