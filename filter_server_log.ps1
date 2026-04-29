# Live filter for Marinara server logs.
# Double-click filter_server_log.bat to run this script.
#
# Easy edits:
#   $Pattern = "\[agent"                         # default: all [agent* lines
#   $Pattern = "\[agent|\[agents|\[agent-tools"  # common agent diagnostics
#   $Pattern = "cadence|Custom Summarisation"    # custom cadence debugging
#   $LogFile = "logs\server-debug.log"           # default logged server output

$Pattern = "\[agent"
$LogFile = "logs\server-debug.log"

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

if (-not (Test-Path -LiteralPath $LogFile)) {
  Write-Host "Log file not found: $LogFile" -ForegroundColor Yellow
  Write-Host "Start the logged server first with start_dev_server_logged.bat." -ForegroundColor Yellow
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "Filtering $LogFile" -ForegroundColor Cyan
Write-Host "Pattern: $Pattern" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

Get-Content -LiteralPath $LogFile -Wait -Tail 200 | Select-String -Pattern $Pattern
