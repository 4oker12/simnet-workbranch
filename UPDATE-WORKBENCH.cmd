@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-workbench.ps1"
if errorlevel 1 (
  echo.
  echo Update stopped. Read the error above.
  pause
  exit /b 1
)

echo.
echo Open UserSide or Billing and click the green Reload EXT button.
pause
