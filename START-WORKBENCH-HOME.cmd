@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Start-WorkbenchHome.ps1"
exit /b %ERRORLEVEL%
