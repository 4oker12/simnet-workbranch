@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Status-Workbench.ps1"
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
