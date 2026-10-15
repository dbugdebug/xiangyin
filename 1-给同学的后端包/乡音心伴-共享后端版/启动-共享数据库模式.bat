@echo off
chcp 65001 >nul
title 乡音心伴 - 共享数据库模式（Supabase 云库）
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
  echo      python -m pip install -r requirements-postgres.txt
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   乡音心伴  ——  共享数据库模式（Supabase 云库）
echo   Python ：%PY%
echo   访问地址：http://localhost:5000
echo   关闭服务：直接关掉本窗口
echo ============================================
echo.

rem 检查 psycopg2（连云库必需）
"%PY%" -c "import psycopg2" >nul 2>nul
if errorlevel 1 (
  echo [提示] 未检测到 psycopg2，服务会自动降级为本地库（数据不进云库）。
  echo        要连 Supabase，请先执行：
  echo            "%PY%" -m pip install -r requirements-postgres.txt
  echo.
  pause
)

"%PY%" app.py
pause
