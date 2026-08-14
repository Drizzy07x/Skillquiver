param(
  [string]$ArtifactRoot = '.plugin-eval\codex-package'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$resolvedArtifactRoot = [IO.Path]::GetFullPath((Join-Path $root $ArtifactRoot))
if ([IO.Path]::IsPathRooted($ArtifactRoot)) {
  $resolvedArtifactRoot = [IO.Path]::GetFullPath($ArtifactRoot)
}
$defaultArtifactRoot = [IO.Path]::GetFullPath(
  (Join-Path $root '.plugin-eval\codex-package')
)
$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$pathComparison = if ($IsWindows) {
  [StringComparison]::OrdinalIgnoreCase
}
else {
  [StringComparison]::Ordinal
}

function Test-IsInside {
  param([string]$Parent, [string]$Candidate)

  $separator = [IO.Path]::DirectorySeparatorChar
  $normalizedParent = $Parent.TrimEnd($separator) + $separator
  return $Candidate.StartsWith($normalizedParent, $pathComparison)
}

$usesDefaultRoot = $resolvedArtifactRoot.Equals($defaultArtifactRoot, $pathComparison) -or
  (Test-IsInside $defaultArtifactRoot $resolvedArtifactRoot)
$usesTemp = Test-IsInside $systemTemp $resolvedArtifactRoot
if (-not $usesDefaultRoot -and -not $usesTemp) {
  throw 'Codex package output must be inside the artifact root or system temp.'
}

$packagePath = Join-Path $resolvedArtifactRoot 'skillquiver'
$archivePath = Join-Path $resolvedArtifactRoot 'skillquiver-2.1.0.zip'
$builder = Join-Path $PSScriptRoot 'build-codex-package.cjs'

New-Item -ItemType Directory -Force $resolvedArtifactRoot | Out-Null
node $builder $packagePath | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

Add-Type -AssemblyName System.IO.Compression
$archiveStream = [IO.File]::Open(
  $archivePath,
  [IO.FileMode]::CreateNew,
  [IO.FileAccess]::ReadWrite,
  [IO.FileShare]::None
)
$archive = [IO.Compression.ZipArchive]::new(
  $archiveStream,
  [IO.Compression.ZipArchiveMode]::Create,
  $false
)
$fixedTimestamp = [DateTimeOffset]::new(
  1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero
)

try {
  $files = Get-ChildItem -LiteralPath $packagePath -Recurse -File |
    ForEach-Object {
      [pscustomobject]@{
        File = $_
        RelativePath = [IO.Path]::GetRelativePath($packagePath, $_.FullName).Replace('\', '/')
      }
    } |
    Sort-Object RelativePath

  foreach ($file in $files) {
    $entry = $archive.CreateEntry(
      $file.RelativePath,
      [IO.Compression.CompressionLevel]::Optimal
    )
    $entry.LastWriteTime = $fixedTimestamp
    $entryStream = $entry.Open()
    $sourceStream = $file.File.OpenRead()
    try {
      $sourceStream.CopyTo($entryStream)
    }
    finally {
      $sourceStream.Dispose()
      $entryStream.Dispose()
    }
  }
}
finally {
  $archive.Dispose()
}

$skillCount = @(Get-ChildItem -LiteralPath (Join-Path $packagePath 'skills') -Directory).Count
$entryCount = $files.Count
$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash

[pscustomobject]@{
  PackagePath = $packagePath
  ArchivePath = $archivePath
  SkillCount = $skillCount
  EntryCount = $entryCount
  Sha256 = $sha256
}
