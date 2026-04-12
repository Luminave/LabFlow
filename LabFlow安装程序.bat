@echo off
chcp 65001 >nul
title LabFlow 安装程序
color 0A

echo ========================================
echo        LabFlow 自动安装程序
echo ========================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo 请以管理员身份运行此脚本！
    echo 右键点击此文件，选择"以管理员身份运行"
    pause
    exit /b 1
)

:: 检查Git
echo [1/5] 检查Git...
git --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 未检测到Git！
    echo.
    echo 请先安装Git：
    echo https://git-scm.com/download/win
    echo.
    echo 安装完成后重新运行此脚本
    pause
    exit /b 1
)
echo [✓] Git已安装

:: 检查Node.js
echo.
echo [2/5] 检查Node.js...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 未检测到Node.js！
    echo.
    echo 请先安装Node.js（推荐v18或更高版本）：
    echo https://nodejs.org/
    echo.
    echo 安装完成后重新运行此脚本
    pause
    exit /b 1
)
echo [✓] Node.js已安装

:: 选择安装位置
echo.
echo [3/5] 选择安装位置
echo.
echo 默认安装位置: %USERPROFILE%\Desktop\LabFlow
echo.
set /p INSTALL_PATH="请输入安装位置（直接回车使用默认位置）: "

if "%INSTALL_PATH%"=="" (
    set INSTALL_PATH=%USERPROFILE%\Desktop\LabFlow
)

echo.
echo 安装位置: %INSTALL_PATH%
echo.

:: 检查目录是否存在
if exist "%INSTALL_PATH%" (
    echo [警告] 目录已存在！
    set /p OVERWRITE="是否覆盖？(Y/N): "
    if /i not "%OVERWRITE%"=="Y" (
        echo 安装已取消
        pause
        exit /b 0
    )
    echo 正在删除旧目录...
    rmdir /s /q "%INSTALL_PATH%"
)

:: 克隆项目
echo.
echo [4/5] 下载LabFlow项目...
echo 正在从GitHub克隆项目，请稍候...
git clone https://github.com/Luminave/LabFlow.git "%INSTALL_PATH%"
if %errorLevel% neq 0 (
    echo [错误] 克隆项目失败！
    echo 请检查网络连接或GitHub访问权限
    pause
    exit /b 1
)
echo [✓] 项目下载完成

:: 安装依赖
echo.
echo [5/5] 安装依赖...
echo 这可能需要几分钟时间，请耐心等待...
cd /d "%INSTALL_PATH%"
call npm install
if %errorLevel% neq 0 (
    echo [错误] 安装依赖失败！
    echo 请手动运行: cd "%INSTALL_PATH%" && npm install
    pause
    exit /b 1
)
echo [✓] 依赖安装完成

:: 创建桌面快捷方式
echo.
echo 正在创建桌面快捷方式...

:: 创建VBS脚本来生成快捷方式
echo Set oWS = WScript.CreateObject("WScript.Shell") > CreateShortcut.vbs
echo sLinkFile = "%USERPROFILE%\Desktop\启动LabFlow.lnk" >> CreateShortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> CreateShortcut.vbs
echo oLink.TargetPath = "%INSTALL_PATH%\启动LabFlow.bat" >> CreateShortcut.vbs
echo oLink.WorkingDirectory = "%INSTALL_PATH%" >> CreateShortcut.vbs
echo oLink.Description = "启动LabFlow实验室管理系统" >> CreateShortcut.vbs
echo oLink.Save >> CreateShortcut.vbs

cscript //nologo CreateShortcut.vbs
del CreateShortcut.vbs

echo [✓] 桌面快捷方式已创建

:: 安装完成
echo.
echo ========================================
echo        安装完成！
echo ========================================
echo.
echo LabFlow已成功安装到: %INSTALL_PATH%
echo.
echo 启动方式：
echo   1. 双击桌面上的"启动LabFlow"快捷方式
echo   2. 或者进入安装目录，双击"启动LabFlow.bat"
echo.
echo 访问地址: http://localhost:5173/
echo.
echo 按任意键退出...
pause >nul
