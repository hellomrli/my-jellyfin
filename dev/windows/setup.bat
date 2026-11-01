@echo off
REM Jellyfin Desktop - Windows dependency installer
REM Run once to install all build dependencies

setlocal EnableDelayedExpansion
call "%~dp0common.bat"

set "SEVENZIP=C:\Program Files\7-Zip\7z.exe"
if not exist "!SEVENZIP!" (
    for /f "delims=" %%i in ('where 7z.exe 2^>nul') do (
        set "SEVENZIP=%%i"
        goto :found7zip
    )
)
:found7zip

if not exist "!DEPS_DIR!" mkdir "!DEPS_DIR!"

echo [1/14] Installing CMake...
winget install --id Kitware.CMake --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: CMake may already be installed

echo [2/14] Installing Ninja...
winget install --id Ninja-build.Ninja --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: Ninja may already be installed

echo [3/14] Installing 7-Zip...
winget install --id 7zip.7zip --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: 7-Zip may already be installed

echo [4/14] Installing Python for the Qt installer...
winget install --id Python.Python.3.13 --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: Python may already be installed

echo [5/14] Installing Visual Studio 2022 Build Tools...
winget install --id Microsoft.VisualStudio.2022.BuildTools ^
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" ^
  --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: VS Build Tools may already be installed

echo [6/14] Installing MinGW (for gendef)...
winget install --id mingw.mingw-w64-ucrt --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 (
    echo Warning: mingw.mingw-w64-ucrt not available, trying msys2.msys2...
    winget install --id MSYS2.MSYS2 --accept-package-agreements --accept-source-agreements --silent
    if errorlevel 1 echo Warning: MinGW/MSYS2 install skipped. gendef fallback may run during build.
)

echo [7/14] Installing Inno Setup...
winget install --id JRSoftware.InnoSetup --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 echo Warning: Inno Setup may already be installed

echo [8/14] Installing Qt !QT_VERSION!...
set "PYTHON_LAUNCHER=py"
if exist "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" set "PYTHON_LAUNCHER=%LOCALAPPDATA%\Programs\Python\Launcher\py.exe"
if not exist "!DEPS_DIR!\python\Scripts\python.exe" (
    "!PYTHON_LAUNCHER!" -3.13 -m venv "!DEPS_DIR!\python"
    if errorlevel 1 (
        echo ERROR: Python 3.13 is unavailable. Restart the terminal after installation and re-run setup.
        exit /b 1
    )
)
set "QT_PYTHON=!DEPS_DIR!\python\Scripts\python.exe"
"!QT_PYTHON!" -m pip install -r "!SCRIPT_DIR!..\requirements-build.txt"
if errorlevel 1 exit /b 1
REM Reinstalling also repairs partially installed or obsolete WebEngine packages.
"!QT_PYTHON!" "!SCRIPT_DIR!..\install-qt.py" windows desktop !QT_VERSION! win64_msvc2022_64 -m qtwebengine qtwebchannel qtpositioning qtserialport -O "!DEPS_DIR!\qt"
if errorlevel 1 exit /b 1

echo [9/14] Downloading libmpv AVX2...
call "!SCRIPT_DIR!install-mpv.bat" x86_64-v3 mpv
if errorlevel 1 exit /b 1

echo [10/14] Downloading libmpv fallback (non-AVX2)...
call "!SCRIPT_DIR!install-mpv.bat" x86_64 mpv-fallback
if errorlevel 1 exit /b 1

echo [11/14] Downloading VCRedist and WiX tools...
if not exist "!DEPS_DIR!\vc_redist.x64.exe" (
    echo Downloading vc_redist.x64.exe...
    curl --fail --location --retry 3 -o "!DEPS_DIR!\vc_redist.x64.exe" https://aka.ms/vs/17/release/vc_redist.x64.exe
    if errorlevel 1 exit /b 1
)
if not exist "!DEPS_DIR!\wix" (
    echo Downloading WiX tools...
    curl --fail --location --retry 3 -o "!DEPS_DIR!\wix.zip" https://github.com/wixtoolset/wix3/releases/download/wix3111rtm/wix311-binaries.zip
    if errorlevel 1 exit /b 1
    mkdir "!DEPS_DIR!\wix"
    "!SEVENZIP!" x -y "!DEPS_DIR!\wix.zip" -o"!DEPS_DIR!\wix"
    if errorlevel 1 exit /b 1
    del "!DEPS_DIR!\wix.zip"
)

echo [12/14] Extracting VC runtime DLLs...
if not exist "!DEPS_DIR!\vcruntime" (
    echo Extracting VCRedist with dark.exe...
    mkdir "!DEPS_DIR!\vcruntime"
    "!DEPS_DIR!\wix\dark.exe" -nologo "!DEPS_DIR!\vc_redist.x64.exe" -x "!DEPS_DIR!\vcredist_tmp"
    echo Extracting runtime CABs...
    expand.exe -F:* "!DEPS_DIR!\vcredist_tmp\AttachedContainer\packages\vcRuntimeMinimum_amd64\cab1.cab" "!DEPS_DIR!\vcruntime"
    expand.exe -F:* "!DEPS_DIR!\vcredist_tmp\AttachedContainer\packages\vcRuntimeAdditional_amd64\cab1.cab" "!DEPS_DIR!\vcruntime"
    REM Rename files from *_amd64 to *.dll
    for %%f in ("!DEPS_DIR!\vcruntime\*_amd64") do (
        set "name=%%~nf"
        ren "%%f" "!name:_amd64=!.dll"
    )
    rd /s /q "!DEPS_DIR!\vcredist_tmp"
    echo VC runtime DLLs extracted to !DEPS_DIR!\vcruntime
)

echo [13/14] Generating mpv import library...
if exist "!DEPS_DIR!\mpv\libmpv-2.dll" (
    if not exist "!DEPS_DIR!\mpv\libmpv-2.dll.lib" (
        REM Find Visual Studio
        set "VCVARS="
        for %%v in (
            "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
            "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
            "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
            "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
        ) do (
            if exist %%v set "VCVARS=%%~v"
        )
        if defined VCVARS (
            echo Using Visual Studio: !VCVARS!
            call "!VCVARS!" >nul 2>&1
            echo Generating import library...
            echo LIBRARY libmpv-2.dll > "!DEPS_DIR!\mpv\mpv.def"
            echo EXPORTS >> "!DEPS_DIR!\mpv\mpv.def"
            for /f "tokens=4" %%a in ('dumpbin /exports "!DEPS_DIR!\mpv\libmpv-2.dll" ^| findstr /c:" mpv_"') do (
                >>"!DEPS_DIR!\mpv\mpv.def" echo %%a
            )
            findstr /x /c:"mpv_create" "!DEPS_DIR!\mpv\mpv.def" >nul
            if errorlevel 1 exit /b 1
            lib /def:"!DEPS_DIR!\mpv\mpv.def" /out:"!DEPS_DIR!\mpv\libmpv-2.dll.lib" /MACHINE:X64
            if errorlevel 1 exit /b 1
            echo Import library created: !DEPS_DIR!\mpv\libmpv-2.dll.lib
        ) else (
            echo WARNING: Visual Studio not found. Import library will be generated during build.
        )
    ) else (
        echo mpv import library already exists, skipping
    )
)

echo [14/14] Generating CMakePresets.json...
powershell -Command "(Get-Content '!SCRIPT_DIR!..\CMakePresets.json.in' -Raw) -replace '@QT_VERSION@','!QT_VERSION!' -replace '@BREW_PREFIX@','' | Set-Content '!PROJECT_ROOT!\CMakePresets.json' -NoNewline"

echo.
echo Setup complete. Restart terminal to refresh PATH, then run build.bat
endlocal
