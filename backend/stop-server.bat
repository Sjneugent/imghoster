@echo off
REM Stop the ImgHoster Node.js server

set PORT=%PORT%
if "%PORT%"=="" set PORT=3000

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo Killing process %%a on port %PORT%
    taskkill /F /PID %%a >nul 2>&1
)

echo Server stopped
