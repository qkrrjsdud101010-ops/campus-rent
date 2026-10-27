@echo off
setlocal
set "CAMPUS_PREVIEW_ROOT=%~dp0"
where javac >nul 2>nul
if errorlevel 1 (
  echo JDK 8 or newer must be on PATH.
  exit /b 1
)
if not exist "%CAMPUS_PREVIEW_ROOT%.work\preview" mkdir "%CAMPUS_PREVIEW_ROOT%.work\preview"
javac -encoding UTF-8 -d "%CAMPUS_PREVIEW_ROOT%.work\preview" "%CAMPUS_PREVIEW_ROOT%tools\PreviewServer.java"
if errorlevel 1 exit /b 1
java -cp "%CAMPUS_PREVIEW_ROOT%.work\preview" PreviewServer 8080 "%CAMPUS_PREVIEW_ROOT%."
