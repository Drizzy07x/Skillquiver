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

function Set-ZipUnixCreatorSystem {
  param([string]$Path)

  $bytes = [IO.File]::ReadAllBytes($Path)
  $minimumOffset = [Math]::Max(0, $bytes.Length - 65557)
  $endOffset = -1
  for ($offset = $bytes.Length - 22; $offset -ge $minimumOffset; $offset--) {
    if ($bytes[$offset] -eq 0x50 -and $bytes[$offset + 1] -eq 0x4B -and
        $bytes[$offset + 2] -eq 0x05 -and $bytes[$offset + 3] -eq 0x06) {
      $endOffset = $offset
      break
    }
  }
  if ($endOffset -lt 0) { throw 'ZIP end-of-central-directory record is missing.' }

  $entryCount = [BitConverter]::ToUInt16($bytes, $endOffset + 10)
  $offset = [int64][BitConverter]::ToUInt32($bytes, $endOffset + 16)
  for ($index = 0; $index -lt $entryCount; $index++) {
    if ($bytes[$offset] -ne 0x50 -or $bytes[$offset + 1] -ne 0x4B -or
        $bytes[$offset + 2] -ne 0x01 -or $bytes[$offset + 3] -ne 0x02) {
      throw 'ZIP central-directory entry is malformed.'
    }
    $bytes[$offset + 5] = 3
    $nameLength = [BitConverter]::ToUInt16($bytes, $offset + 28)
    $extraLength = [BitConverter]::ToUInt16($bytes, $offset + 30)
    $commentLength = [BitConverter]::ToUInt16($bytes, $offset + 32)
    $offset += 46 + $nameLength + $extraLength + $commentLength
  }
  [IO.File]::WriteAllBytes($Path, $bytes)
}

$usesDefaultRoot = $resolvedArtifactRoot.Equals($defaultArtifactRoot, $pathComparison) -or
  (Test-IsInside $defaultArtifactRoot $resolvedArtifactRoot)
$usesTemp = Test-IsInside $systemTemp $resolvedArtifactRoot
if (-not $usesDefaultRoot -and -not $usesTemp) {
  throw 'Codex package output must be inside the artifact root or system temp.'
}

$packagePath = Join-Path $resolvedArtifactRoot 'skillquiver'
$archivePath = Join-Path $resolvedArtifactRoot 'skillquiver-2.2.0.zip'
$builder = Join-Path $PSScriptRoot 'build-codex-package.cjs'

# The Node builder resolves existing ancestors physically and creates the
# package directory only after containment succeeds.
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
    $entry.ExternalAttributes = if ($file.RelativePath.EndsWith('.sh')) {
      [int]0x81ED0000
    }
    else {
      [int]0x81A40000
    }
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
Set-ZipUnixCreatorSystem $archivePath

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
