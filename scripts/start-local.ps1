$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath 'dist\index.html')) { throw 'Run npm run build first.' }
$listeners = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listeners) { throw 'Port 3001 is already in use. Inspect and stop the existing server first.' }
New-Item -ItemType Directory -Path 'data' -Force | Out-Null
$serverEntry = Join-Path $projectRoot 'dist-server\index.js'
$serverProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"' + $serverEntry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data\server.log') -RedirectStandardError (Join-Path $projectRoot 'data\server-error.log') -PassThru
$serverProcess.Id | Set-Content -LiteralPath 'data\server.pid'
$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  if ($serverProcess.HasExited) {
    $errorLog = Get-Content -LiteralPath (Join-Path $projectRoot 'data\server-error.log') -Raw -ErrorAction SilentlyContinue
    throw "Pathwise server exited during startup. $errorLog"
  }
  try {
    $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 1
    if ($health.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 250
}
if (-not $ready) {
  Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
  throw 'Pathwise server did not become healthy within 7.5 seconds. See data\server.log and data\server-error.log.'
}
Write-Output "Pathwise started with process $($serverProcess.Id). Open http://127.0.0.1:3001."
