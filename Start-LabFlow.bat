@echo off
cd /d %~dp0
echo Starting LabFlow...
echo Working directory: %CD%
echo.
echo Starting Vite development server...
echo Please wait...
echo.
start cmd /k npx vite --config vite.config.browser.ts --host 0.0.0.0
timeout /t 8 /nobreak
echo Opening browser...
start http://localhost:5173/
echo.
echo LabFlow started!
echo If browser doesn't open automatically, visit: http://localhost:5173/
echo.
echo Press any key to exit...
pause
