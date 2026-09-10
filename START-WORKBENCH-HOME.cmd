@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Start-WorkbenchHome.ps1"
if errorlevel 1 exit /b %ERRORLEVEL%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Recover-WorkbenchHomeSip.ps1"
exit /b %ERRORLEVEL%
