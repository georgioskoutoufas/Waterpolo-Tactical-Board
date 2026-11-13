@echo off
cd /d "%~dp0"
echo ===================================================
echo   Uploading WaterPolo Tactical Board to GitHub
echo ===================================================
echo.
git push -u origin main
echo.
if %errorlevel% equ 0 (
    echo SUCCESS: Files pushed to GitHub!
) else (
    echo Push encountered an issue. See message above.
)
echo.
pause
