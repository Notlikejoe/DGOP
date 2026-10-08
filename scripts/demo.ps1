param(
  [ValidateSet('prepare','preflight','setup','start','check','verify','stop','recover','backup','restore','soak','credentials')]
  [string]$Action = 'check',
  [string]$Profile = (Join-Path $PSScriptRoot '..\..\demo\.env.demo')
)
$ErrorActionPreference = 'Stop'
$candidateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$profilePath = [IO.Path]::GetFullPath($Profile)
$runtimePath = $env:DGOP_NODE_EXE
if (-not $runtimePath) {
  $runtimePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) { throw 'Configure DGOP_NODE_EXE with the pinned Node 24.19 executable.' }
$runtimeVersion = & $runtimePath --version
if ($LASTEXITCODE -ne 0 -or $runtimeVersion -notmatch '^v24\.19\.') { throw 'Use the pinned Node 24.19 runtime.' }
Push-Location -LiteralPath $candidateRoot
try {
  if ($Action -eq 'credentials') {
    if (-not (Test-Path -LiteralPath $profilePath)) { throw 'The selected demo profile is missing.' }
    $env:DGOP_ENV_FILE = $profilePath
    & $runtimePath (Join-Path $PSScriptRoot 'demo-credentials.mjs')
  } else {
    & $runtimePath (Join-Path $PSScriptRoot 'demo.mjs') $Action --profile $profilePath
  }
  if ($LASTEXITCODE -ne 0) { throw 'The demonstration command failed. Review its diagnostic before presenting.' }
} finally { Pop-Location }
