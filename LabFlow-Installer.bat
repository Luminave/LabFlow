@echo off
chcp 65001 >nul
title LabFlow Installer
color 0A

echo ========================================
echo        LabFlow Auto Installer
echo ========================================
echo.

:: Check administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Please run this script as administrator!
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

:: Check Git
echo [1/5] Checking Git...
git --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Git not found!
    echo.
    echo Please install Git first:
    echo https://git-scm.com/download/win
    echo.
    echo Then run this script again
    pause
    exit /b 1
)
echo [OK] Git installed

:: Check Node.js
echo.
echo [2/5] Checking Node.js...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo.
    echo Please install Node.js first (v18 or higher):
    echo https://nodejs.org/
    echo.
    echo Then run this script again
    pause
    exit /b 1
)
echo [OK] Node.js installed

:: Select installation location
echo.
echo [3/5] Select installation location
echo.
echo Default location: %USERPROFILE%\Desktop\LabFlow
echo.
set /p INSTALL_PATH="Enter installation path (press Enter for default): "

if "%INSTALL_PATH%"=="" (
    set INSTALL_PATH=%USERPROFILE%\Desktop\LabFlow
)

echo.
echo Installation path: %INSTALL_PATH%
echo.

:: Check if directory exists
if exist "%INSTALL_PATH%" (
    echo [WARNING] Directory already exists!
    set /p OVERWRITE="Overwrite? (Y/N): "
    if /i not "%OVERWRITE%"=="Y" (
        echo Installation cancelled
        pause
        exit /b 0
    )
    echo Removing old directory...
    rmdir /s /q "%INSTALL_PATH%"
)

:: Clone project
echo.
echo [4/5] Downloading LabFlow project...
echo Cloning from GitHub, please wait...
git clone https://github.com/Luminave/LabFlow.git "%INSTALL_PATH%"
if %errorLevel% neq 0 (
    echo [ERROR] Failed to clone project!
    echo Please check network connection or GitHub access
    pause
    exit /b 1
)
echo [OK] Project downloaded

:: Install dependencies
echo.
echo [5/5] Installing dependencies...
echo This may take a few minutes, please wait...
cd /d "%INSTALL_PATH%"
call npm install
if %errorLevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    echo Please manually run: cd "%INSTALL_PATH%" && npm install
    pause
    exit /b 1
)
echo [OK] Dependencies installed

:: Create desktop shortcut
echo.
echo Creating desktop shortcut...

:: Create VBS script to generate shortcut
echo Set oWS = WScript.CreateObject("WScript.Shell") > CreateShortcut.vbs
echo sLinkFile = "%USERPROFILE%\Desktop\Start-LabFlow.lnk" >> CreateShortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> CreateShortcut.vbs
echo oLink.TargetPath = "%INSTALL_PATH%\Start-LabFlow.bat" >> CreateShortcut.vbs
echo oLink.WorkingDirectory = "%INSTALL_PATH%" >> CreateShortcut.vbs
echo oLink.Description = "Start LabFlow Lab Management System" >> CreateShortcut.vbs
echo oLink.Save >> CreateShortcut.vbs

cscript //nologo CreateShortcut.vbs
del CreateShortcut.vbs

echo [OK] Desktop shortcut created

:: Installation complete
echo.
echo ========================================
echo        Installation Complete!
echo ========================================
echo.
echo LabFlow installed to: %INSTALL_PATH%
echo.
echo Start methods:
echo   1. Double-click "Start-LabFlow" shortcut on desktop
echo   2. Or go to installation folder and double-click "Start-LabFlow.bat"
echo.
echo Access URL: http://localhost:5173/
echo.
echo Press any key to exit...
pause >nul
