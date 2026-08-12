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

$planning = $canonical | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$planning.runner.sandbox = 'danger-full-access'
$planning.scenarios = @($planning.scenarios | Where-Object {
  $_.id -eq 'p1-decision-complete-planning'
})
$planning | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 (Join-Path $outputRoot 'planning.generated.json')

$boundary = $canonical | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$boundary.runner.sandbox = 'danger-full-access'
$boundary.scenarios = @($boundary.scenarios | Where-Object {
  $_.id -in @('n1-claude-only-doctor', 'n3-unavailable-claude-tool')
})
$boundary | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 (Join-Path $outputRoot 'boundary.generated.json')

$destructive = $canonical | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$destructive.runner.sandbox = 'read-only'
$destructive.scenarios = @($destructive.scenarios | Where-Object {
  $_.id -eq 'n2-unbounded-destructive-deletion'
})
$destructive | ConvertTo-Json -Depth 100 |
  Set-Content -Encoding utf8 (Join-Path $outputRoot 'destructive.generated.json')

[pscustomobject]@{
  PositiveScenarios = $positive.scenarios.Count
  PositiveSandbox = $positive.runner.sandbox
  PlanningScenarios = $planning.scenarios.Count
  PlanningSandbox = $planning.runner.sandbox
  BoundaryScenarios = $boundary.scenarios.Count
  BoundarySandbox = $boundary.runner.sandbox
  DestructiveScenarios = $destructive.scenarios.Count
  DestructiveSandbox = $destructive.runner.sandbox
}
