@echo off
chcp 65001 >nul
title 乡音心伴 - 本地演示模式（SQLite）
cd /d "%~dp0"

set "PY="
rem 逐个探测候选 Python，只挑「能 import flask」的那个
for %%P in (
  "python"
  "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
  "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
  "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
  "%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
) do (
  if not defined PY (
    %%P -c "import flask" >nul 2>nul
    if not errorlevel 1 set "PY=%%~P"
  )
)
if not defined PY (
  py -3 -c "import flask" >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)

if not defined PY (
  echo ============================================
  echo   没找到可用的 Python 环境
  echo ============================================
  echo.
  echo  请先安装 Python 3.10 以上，然后执行：
  echo      python -m pip install -r requirements.txt
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   乡音心伴  ——  本地演示模式（SQLite，无需联网）
echo   Python ：%PY%
echo   访问地址：http://localhost:5000
echo   关闭服务：直接关掉本窗口
echo ============================================
echo.
set DB_MODE=sqlite
"%PY%" app.py
echo.
echo 服务已退出。若提示缺少模块，请执行：
echo    "%PY%" -m pip install -r requirements.txt
pause
