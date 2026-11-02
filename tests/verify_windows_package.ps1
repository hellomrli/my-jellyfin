param(
    [string]$BuildDirectory = "build",
    [string]$OutputDirectory = "build/package-checks"
)

$ErrorActionPreference = "Stop"
$build = (Resolve-Path $BuildDirectory).Path
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$output = (Resolve-Path $OutputDirectory).Path
$version = (Get-Content "$PSScriptRoot/../VERSION" -Raw).Trim()
$installer = Join-Path $build "JellyfinDesktop-$version-x64.exe"
$zip = Join-Path $build "JellyfinDesktop-$version-x64.zip"
$portable = Join-Path $output "Portable with spaces"
$installed = Join-Path $output "Installed with spaces"
$fontManifestPath = Join-Path $PSScriptRoot "../dev/fonts.json"
$fontManifest = Get-Content $fontManifestPath -Raw | ConvertFrom-Json

function Assert-Package([string]$directory) {
    foreach ($file in @(
        "Jellyfin Desktop.exe", "QtWebEngineProcess.exe", "Qt6Core.dll",
        "Qt6WebEngineCore.dll", "Qt6WebEngineQuick.dll", "Qt6Quick.dll",
        "libmpv-2.dll", "libmpv-fallback.dll", "opengl32sw.dll",
        "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll",
        "plugins/platforms/qwindows.dll", "qml/QtWebEngine/qmldir",
        "qml/QtQuick/qmldir", "resources/icudtl.dat",
        "resources/qtwebengine_resources.pak", "qt.conf", "LICENSE"
    )) {
        if (-not (Test-Path -PathType Leaf (Join-Path $directory $file))) {
            throw "Missing packaged dependency: $file in $directory"
        }
    }
    $config = Get-Content (Join-Path $directory "qt.conf") -Raw
    if ($config -notmatch '(?m)^Prefix\s*=\s*\.\s*$' -or
        $config -notmatch '(?m)^Plugins\s*=\s*plugins\s*$') {
        throw "qt.conf must point to package-local dependencies"
    }
    $packagedManifest = Join-Path $directory "licenses/fonts/manifest.json"
    if ((Get-FileHash $packagedManifest).Hash -ne (Get-FileHash $fontManifestPath).Hash) {
        throw "Packaged font manifest differs from the source manifest"
    }
    foreach ($entry in $fontManifest.files) {
        $folder = if ($entry.kind -eq "font") { "fonts" } else { "licenses/fonts" }
        $filename = Join-Path $directory "$folder/$($entry.name)"
        if ((Get-FileHash $filename).Hash -ne $entry.sha256) {
            throw "Missing or corrupt packaged font/license: $filename"
        }
    }
}

function Invoke-Smoke([string]$directory, [string]$name) {
    & node "$PSScriptRoot/smoke_packaged_player.cjs" `
        (Join-Path $directory "Jellyfin Desktop.exe") (Join-Path $output $name)
    if ($LASTEXITCODE -ne 0) { throw "Packaged playback failed: $name" }
}

if (-not (Test-Path $installer) -or -not (Test-Path $zip)) {
    throw "Both the installer and portable ZIP must exist for $version"
}
Expand-Archive -Path $zip -DestinationPath $portable
Assert-Package $portable
if (-not (Test-Path -PathType Leaf (Join-Path $portable "portable"))) {
    throw "Portable ZIP is missing its profile marker"
}
$before = @(Get-FileHash (Join-Path $portable "libmpv*.dll") | Sort-Object Path)
$hiddenQt = "$env:QT_ROOT_DIR-package-test"
if ($env:QT_ROOT_DIR) { Move-Item $env:QT_ROOT_DIR $hiddenQt }
try {
    Remove-Item Env:JELLYFIN_MPV_FORCE_FALLBACK -ErrorAction SilentlyContinue
    Invoke-Smoke $portable "portable-primary"
    $env:JELLYFIN_MPV_FORCE_FALLBACK = "1"
    Invoke-Smoke $portable "portable-fallback"
    Remove-Item Env:JELLYFIN_MPV_FORCE_FALLBACK
    $after = @(Get-FileHash (Join-Path $portable "libmpv*.dll") | Sort-Object Path)
    if (($before.Hash -join ',') -ne ($after.Hash -join ',')) {
        throw "MPV fallback must not replace or modify installed DLLs"
    }
    $setup = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList @(
        "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER",
        "/DIR=`"$installed`"", "/LOG=`"$output/install.log`""
    )
    if ($setup.ExitCode -ne 0) { throw "Installer exited with $($setup.ExitCode)" }
    Assert-Package $installed
    if (Test-Path (Join-Path $installed "portable")) {
        throw "Installed edition must not use portable profile storage"
    }
    Invoke-Smoke $installed "installed-primary"
} finally {
    Remove-Item Env:JELLYFIN_MPV_FORCE_FALLBACK -ErrorAction SilentlyContinue
    if ($env:QT_ROOT_DIR -and (Test-Path $hiddenQt)) { Move-Item $hiddenQt $env:QT_ROOT_DIR }
    $uninstaller = Join-Path $installed "unins000.exe"
    if (Test-Path $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -Wait -PassThru -ArgumentList @(
            "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$output/uninstall.log`""
        )
        if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)" }
    }
}
$installedExecutable = Join-Path $installed "Jellyfin Desktop.exe"
for ($attempt = 0; $attempt -lt 25 -and (
    (Test-Path $installedExecutable) -or (Test-Path (Join-Path $installed "fonts")) -or
    (Test-Path (Join-Path $installed "licenses/fonts"))
); $attempt++) {
    Start-Sleep -Milliseconds 200
}
if (Test-Path $installedExecutable) {
    throw "Silent uninstall did not remove the application"
}
foreach ($folder in @("fonts", "licenses/fonts")) {
    if (Test-Path (Join-Path $installed $folder)) {
        throw "Silent uninstall did not remove packaged fonts/licenses: $folder"
    }
}
Get-FileHash $installer, $zip | Format-Table -AutoSize
Write-Host "Installer, portable playback, bundled fonts, and non-destructive MPV fallback verified."
