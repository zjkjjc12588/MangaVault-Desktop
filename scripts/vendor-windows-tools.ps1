[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$vendorRoot = Join-Path $repoRoot 'src-tauri\vendor\windows\tools'
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('mangavault-tools-' + [Guid]::NewGuid().ToString('N'))

$artifacts = @(
  @{
    Name = '7zr.exe'
    Url = 'https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe'
    Sha256 = '56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72'
  },
  @{
    Name = '7z2602-x64.exe'
    Url = 'https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.exe'
    Sha256 = '6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0'
  },
  @{
    Name = 'Release-26.02.0-0.zip'
    Url = 'https://github.com/oschwartz10612/poppler-windows/releases/download/v26.02.0-0/Release-26.02.0-0.zip'
    Sha256 = '993e4a94376ed712fafc7058d724ea0b943d118bbd2305cd9ed55174eb85cda5'
  }
)

function Get-VerifiedArtifact([hashtable] $artifact) {
  $destination = Join-Path $scratch $artifact.Name
  Invoke-WebRequest -Uri $artifact.Url -OutFile $destination
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
  if ($actual -ne $artifact.Sha256) {
    throw "SHA-256 verification failed for $($artifact.Name). Expected $($artifact.Sha256), got $actual."
  }
  return $destination
}

try {
  New-Item -ItemType Directory -Force -Path $scratch, $vendorRoot | Out-Null
  $sevenExtractor = Get-VerifiedArtifact $artifacts[0]
  $sevenInstaller = Get-VerifiedArtifact $artifacts[1]
  $popplerArchive = Get-VerifiedArtifact $artifacts[2]

  $sevenExtractRoot = Join-Path $scratch '7zip'
  # The official installer is a self-extracting 7z archive. Extracting it this
  # way keeps the build non-elevated and avoids modifying the developer machine.
  & $sevenExtractor x "-o$sevenExtractRoot" -y -- $sevenInstaller
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to extract the verified 7-Zip package (exit code $LASTEXITCODE)."
  }
  $sevenExecutable = Get-ChildItem -LiteralPath $sevenExtractRoot -Filter '7z.exe' -File -Recurse |
    Select-Object -First 1
  if ($null -eq $sevenExecutable) {
    throw 'The verified 7-Zip package did not contain the console executable.'
  }
  $sevenDestination = Join-Path $vendorRoot '7zip'
  New-Item -ItemType Directory -Force -Path $sevenDestination | Out-Null
  foreach ($name in '7z.exe', '7z.dll', 'License.txt') {
    Copy-Item -LiteralPath (Join-Path $sevenExecutable.DirectoryName $name) -Destination $sevenDestination -Force
  }

  $popplerExtractRoot = Join-Path $scratch 'poppler'
  Expand-Archive -LiteralPath $popplerArchive -DestinationPath $popplerExtractRoot
  $library = Get-ChildItem -LiteralPath $popplerExtractRoot -Directory -Recurse |
    Where-Object { Test-Path (Join-Path $_.FullName 'Library\bin\pdftoppm.exe') } |
    Select-Object -First 1
  if ($null -eq $library) {
    throw 'The verified Poppler archive did not contain Library\\bin\\pdftoppm.exe.'
  }
  $popplerDestination = Join-Path $vendorRoot 'poppler'
  New-Item -ItemType Directory -Force -Path $popplerDestination | Out-Null
  Copy-Item -LiteralPath (Join-Path $library.FullName 'Library\bin') -Destination $popplerDestination -Recurse -Force
  if (Test-Path (Join-Path $library.FullName 'Library\share')) {
    Copy-Item -LiteralPath (Join-Path $library.FullName 'Library\share') -Destination $popplerDestination -Recurse -Force
  }

  $requiredFiles = @(
    (Join-Path $sevenDestination '7z.exe'),
    (Join-Path $sevenDestination '7z.dll'),
    (Join-Path $popplerDestination 'bin\pdftoppm.exe')
  )
  $missing = $requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
  if ($missing) {
    throw "Bundled reader tools are incomplete: $($missing -join ', ')"
  }
  Write-Host "Prepared verified Windows reader tools in $vendorRoot"
}
finally {
  if (Test-Path -LiteralPath $scratch) {
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
}
