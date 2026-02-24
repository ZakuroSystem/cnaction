@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
    where python >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Python not found.
        exit /b 1
    )
    set "PY=python"
) else (
    set "PY=py -3"
)

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Creating venv...
    %PY% -m venv .venv || exit /b 1
)

if not exist requirements.txt (
    echo [ERROR] requirements.txt missing.
    exit /b 1
)

echo [INFO] Installing dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt

echo [INFO] Starting server...
".venv\Scripts\python.exe" app.py

endlocal
