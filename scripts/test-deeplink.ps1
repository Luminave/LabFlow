<#
.SYNOPSIS
  一条命令测 labflow:// 深链接：检查应用是否在跑 -> 发链接 -> 打印结果。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/test-deeplink.ps1 -Project 'AD-5.2'
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/test-deeplink.ps1 -Project '261118-实际实验' -Id '8b566421-600e-47e4-9947-19995cea3eec'
.EXAMPLE
  # 想同时看主进程日志：先把 npm run electron:dev 的输出重定向到文件，再传 -LogPath
  powershell -ExecutionPolicy Bypass -File scripts/test-deeplink.ps1 -Project 'AD-5.2' -LogPath D:\tmp\dev.log
.NOTES
  一定要用 Start-Process 发链接，不要用 cmd /c start：
  cmd 的 start 会把 = 后面的部分吃掉（实测应用只收到 labflow://open/?project）。
#>
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Id = '',
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'

# 本机 shell 可能带 ELECTRON_RUN_AS_NODE=1：不清掉的话，起出来的 electron 会当纯 Node 跑然后崩
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Get-LabFlowWindow {
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like '*LabFlow*' } |
    Select-Object -First 1
}

$url = 'labflow://open?project=' + [uri]::EscapeDataString($Project)
if ($Id) { $url += '&id=' + [uri]::EscapeDataString($Id) }

Write-Host "链接: $url" -ForegroundColor Cyan

$before = Get-LabFlowWindow
if (-not $before) {
  Write-Host '应用没在跑。先在项目目录跑 npm run electron:dev，再执行本脚本。' -ForegroundColor Yellow
  exit 1
}
Write-Host "应用在跑: PID $($before.Id)" -ForegroundColor DarkGray

$lines = 0
if ($LogPath -and (Test-Path $LogPath)) { $lines = (Get-Content $LogPath | Measure-Object -Line).Lines }

Start-Process $url
Start-Sleep -Seconds 3

$after = Get-LabFlowWindow
if ($after) {
  Write-Host "窗口还在: PID $($after.Id)  标题: $($after.MainWindowTitle)" -ForegroundColor Green
} else {
  Write-Host '窗口不见了，可能被关掉了' -ForegroundColor Red
}

if ($LogPath -and (Test-Path $LogPath)) {
  Write-Host '--- 本次新增日志 ---' -ForegroundColor DarkGray
  Get-Content $LogPath | Select-Object -Skip $lines | Where-Object { $_ -match 'DeepLink|Failed to load|Database' }
}
