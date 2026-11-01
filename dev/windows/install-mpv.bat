@echo off
REM Called by setup.bat with the archive architecture and destination name.
setlocal EnableDelayedExpansion
call "%~dp0common.bat"
if "%~1"=="" exit /b 1
if "%~2"=="" exit /b 1

set "DEST=!DEPS_DIR!\%~2"
set "INSTALLED_VERSION="
if exist "!DEST!\version.txt" set /p INSTALLED_VERSION=<"!DEST!\version.txt"
if "!INSTALLED_VERSION!"=="!MPV_VERSION!" if exist "!DEST!\libmpv-2.dll" (
    if "%~2"=="mpv" if not exist "!DEST!\include\mpv\client.h" goto :install
    echo libmpv !MPV_VERSION! already installed in !DEST!
    exit /b 0
)

:install
if not exist "!SEVENZIP!" (
    echo ERROR: 7-Zip not found. Install 7-Zip and re-run setup.bat.
    exit /b 1
)
set "TEMP_DIR=!DEPS_DIR!\mpv-download-%~1"
if exist "!TEMP_DIR!" rmdir /s /q "!TEMP_DIR!"
mkdir "!TEMP_DIR!"
curl --fail --location --retry 3 "https://sourceforge.net/projects/mpv-player-windows/files/libmpv/mpv-dev-%~1-!MPV_VERSION!.7z/download" -o "!TEMP_DIR!\mpv.7z"
if errorlevel 1 exit /b 1
"!SEVENZIP!" x "!TEMP_DIR!\mpv.7z" -o"!TEMP_DIR!\contents" -y >nul
if errorlevel 1 exit /b 1

set "MPV_SRC=!TEMP_DIR!\contents"
if not exist "!MPV_SRC!\libmpv-2.dll" (
    for /d %%D in ("!TEMP_DIR!\contents\*") do (
        if exist "%%~fD\libmpv-2.dll" set "MPV_SRC=%%~fD"
    )
)
if not exist "!MPV_SRC!\libmpv-2.dll" exit /b 1
if "%~2"=="mpv" if not exist "!MPV_SRC!\include\mpv\client.h" exit /b 1

REM Validate the download before replacing the existing kit. Keep headers and DLL in sync.
if not exist "!DEST!" mkdir "!DEST!"
copy /y "!MPV_SRC!\libmpv-2.dll" "!DEST!\" >nul
if errorlevel 1 exit /b 1
if "%~2"=="mpv" (
    xcopy /e /i /y "!MPV_SRC!\include" "!DEST!\include\" >nul
    if errorlevel 1 exit /b 1
    REM The next setup step regenerates the import library for this DLL.
    if exist "!DEST!\libmpv-2.dll.lib" del "!DEST!\libmpv-2.dll.lib"
)
>"!DEST!\version.txt" echo !MPV_VERSION!
rmdir /s /q "!TEMP_DIR!"
exit /b 0
