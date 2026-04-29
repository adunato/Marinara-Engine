@echo off
setlocal

:: Dev server launcher with log capture.
:: Override these before running if needed:
::   set LOG_LEVEL=info
::   set SERVER_LOG_FILE=logs\server-debug.log

if not defined LOG_LEVEL set LOG_LEVEL=debug
if not defined SERVER_LOG_FILE set SERVER_LOG_FILE=logs\server-debug.log

if not exist logs mkdir logs

echo.
echo  ==========================================
echo    Starting Marinara dev server with logging
echo    LOG_LEVEL=%LOG_LEVEL%
echo    Log file: %SERVER_LOG_FILE%
echo  ==========================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; pnpm dev:server 2>&1 | Tee-Object -FilePath $env:SERVER_LOG_FILE -Append"
set EXIT_CODE=%ERRORLEVEL%

echo.
echo  Server exited with code %EXIT_CODE%.
echo  Log file: %SERVER_LOG_FILE%
echo.
pause
exit /b %EXIT_CODE%
