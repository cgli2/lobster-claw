@echo off
cd /d F:\src\ai\lobster-claw

if exist dist (
    rmdir /s /q dist 2>nul
    timeout /t 2 /nobreak >nul
    if exist dist (
        echo ERROR: Cannot delete dist directory
        exit /b 1
    )
)

npm run build
