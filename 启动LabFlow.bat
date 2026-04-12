@echo off
cd /d C:\Users\Administrator\Desktop\LabFlow
echo 正在启动LabFlow...
echo 工作目录: %CD%
echo.
echo 正在启动Vite开发服务器...
echo 请稍候...
echo.
start cmd /k npx vite --config vite.config.browser.ts --host 0.0.0.0
timeout /t 8 /nobreak
echo 正在打开浏览器...
start http://localhost:5173/
echo.
echo LabFlow已启动！
echo 如果浏览器没有自动打开，请手动访问: http://localhost:5173/
echo.
echo 按任意键退出...
pause
