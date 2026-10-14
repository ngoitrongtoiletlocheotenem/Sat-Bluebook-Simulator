$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot 'data\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { throw 'No saved local server process exists.' }
$serverPid = [int](Get-Content -LiteralPath $pidFile)
$serverEntry = Join-Path $projectRoot 'dist-server\index.js'
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
if (-not $serverProcess) { Write-Output 'The saved server has already stopped.'; exit 0 }
if ($serverProcess.ExecutablePath -notmatch '\\node.exe$' -or $serverProcess.CommandLine -notmatch [regex]::Escape($serverEntry)) { throw 'The process identity no longer matches the Pathwise server.' }
Stop-Process -Id $serverPid
Remove-Item -LiteralPath $pidFile
Write-Output 'Pathwise local server stopped.'
