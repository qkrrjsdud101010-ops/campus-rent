@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\server.ps1" -Task run %*
exit /b %errorlevel%
