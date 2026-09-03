@echo off
setlocal
cd /d "%~dp0"

echo [SIMNET Workbench] Checking repository...
where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or not available in PATH.
  pause
  exit /b 1
)

for /f "delims=" %%i in ('git status --porcelain') do (
  echo ERROR: Local changes detected. Update cancelled so nothing is overwritten.
  echo.
  git status --short
  echo.
  pause
  exit /b 2
)

echo [SIMNET Workbench] Pulling main with fast-forward only...
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo ERROR: Update failed. Working files were not force-reset.
  pause
  exit /b 3
)

echo.
echo [SIMNET Workbench] Repository is up to date.
echo In Chrome click Reload for SIMNET Workbench on the extensions page.
start "" chrome://extensions/

pause
endlocal
