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

:: Check Git - using where command which is safer
echo [1/5] Checking Git...
where git >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Git not found!
    echo.
    echo Do you want to install Git?
    echo.
    set /p INSTALL_GIT="Enter Y to install, or N to cancel: "
    
    :: Remove any spaces from input
    set INSTALL_GIT=%INSTALL_GIT: =%
    
    if /i "%INSTALL_GIT%"=="Y" goto install_git
    if /i "%INSTALL_GIT%"=="y" goto install_git
    
    echo Installation cancelled. Git is required.
    pause
    exit /b 1
    
    :install_git
    echo.
    echo Downloading Git installer...
    echo Please wait...
    
    :: Download Git installer using PowerShell
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe' -OutFile '%TEMP%\Git-Installer.exe'"
    
    if not exist "%TEMP%\Git-Installer.exe" (
        echo [ERROR] Failed to download Git installer!
        echo.
        echo Please download Git manually from:
        echo https://git-scm.com/download/win
        echo.
        pause
        exit /b 1
    )
    
    echo Installing Git...
    echo Please follow the installation wizard.
    start /wait "%TEMP%\Git-Installer.exe"
    
    :: Clean up
    del "%TEMP%\Git-Installer.exe" 2>nul
    
    :: Verify installation using where command
    where git >nul 2>&1
    if %errorLevel% neq 0 (
        echo [ERROR] Git installation failed or not in PATH!
        echo Please restart this script.
        pause
        exit /b 1
    )
    echo [OK] Git installed successfully
) else (
    echo [OK] Git already installed
)

:: Check Node.js - using where command
echo.
echo [2/5] Checking Node.js...
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Node.js not found!
    echo.
    echo Do you want to install Node.js?
    echo.
    set /p INSTALL_NODE="Enter Y to install, or N to cancel: "
    
    :: Remove any spaces from input
    set INSTALL_NODE=%INSTALL_NODE: =%
    
    if /i "%INSTALL_NODE%"=="Y" goto install_node
    if /i "%INSTALL_NODE%"=="y" goto install_node
    
    echo Installation cancelled. Node.js is required.
    pause
    exit /b 1
    
    :install_node
    echo.
    echo Downloading Node.js installer...
    echo Please wait...
    
    :: Download Node.js installer
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile '%TEMP%\NodeJS-Installer.msi'"
    
    if not exist "%TEMP%\NodeJS-Installer.msi" (
        echo [ERROR] Failed to download Node.js installer!
        echo.
        echo Please download Node.js manually from:
        echo https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
    
    echo Installing Node.js...
    start /wait msiexec /i "%TEMP%\NodeJS-Installer.msi" /quiet /norestart
    
    :: Clean up
    del "%TEMP%\NodeJS-Installer.msi" 2>nul
    
    :: Verify installation
    where node >nul 2>&1
    if %errorLevel% neq 0 (
        echo [ERROR] Node.js installation failed!
        echo Please restart this script.
        pause
        exit /b 1
    )
    echo [OK] Node.js installed successfully
) else (
    echo [OK] Node.js already installed
)

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
