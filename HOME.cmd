@echo off
setlocal
cd /d "%~dp0"
call "%~dp0START-WORKBENCH-HOME.cmd"
exit /b %ERRORLEVEL%
