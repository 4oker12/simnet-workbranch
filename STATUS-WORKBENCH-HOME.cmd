@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Status-WorkbenchHome.ps1"
exit /b %ERRORLEVEL%
