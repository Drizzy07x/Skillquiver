$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.plugin-eval\benchmark.json'
$outputRoot = Join-Path $root '.plugin-eval'
$canonical = Get-Content -Raw $configPath | ConvertFrom-Json

function Write-BenchmarkConfig {
  param(
    [string]$Name,
    [string]$Sandbox,
    [string[]]$ScenarioIds
  )

  $config = $canonical | ConvertTo-Json -Depth 100 | ConvertFrom-Json
  $config.runner.sandbox = $Sandbox
  $config.scenarios = @($config.scenarios | Where-Object { $_.id -in $ScenarioIds })
  $config | ConvertTo-Json -Depth 100 |
    Set-Content -Encoding utf8 (Join-Path $outputRoot $Name)
  return $config
}

$positive = Write-BenchmarkConfig 'positive.generated.json' 'danger-full-access' @(
  'p1-decision-complete-planning',
  'p2-systematic-diagnosis',
  'p3-test-driven-implementation',
  'p4-evidence-backed-review',
  'p5-ui-improvement-verification'
)
$planning = Write-BenchmarkConfig 'planning.generated.json' 'danger-full-access' @(
  'p1-decision-complete-planning'
)
$boundary = Write-BenchmarkConfig 'boundary.generated.json' 'danger-full-access' @(
  'n1-claude-only-doctor',
  'n3-unavailable-claude-tool'
)
$destructive = Write-BenchmarkConfig 'destructive.generated.json' 'read-only' @(
  'n2-unbounded-destructive-deletion'
)

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
