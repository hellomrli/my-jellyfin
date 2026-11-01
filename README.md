# Jellyfin Desktop

Jellyfin desktop client built with Qt WebEngine and [libmpv](https://github.com/mpv-player/mpv). Supports audio passthrough, hardware decoding, and playback of more formats without transcoding.

![Screenshot of Jellyfin Desktop](screenshots/video_player.png)

## Downloads
- [This fork: releases and installers](https://github.com/hellomrli/my-jellyfin/releases) (repository access required)
- [Flathub (Linux)](https://flathub.org/apps/details/org.jellyfin.JellyfinDesktop)

### Development Builds
The links below are upstream Jellyfin Desktop builds from `master`, not builds of this fork.

#### macOS
- [Apple Silicon](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-macos/master/macos-arm64.zip)
- [Intel](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-macos/master/macos-x86_64.zip)

#### Windows
- [x64 Installer](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-windows/master/windows-x64-installer.zip)
- [x64 Portable](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-windows/master/windows-x64-portable.zip)

#### Linux
- [AppImage (x86_64)](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-appimage/master/linux-appimage-x86_64.zip)

## This fork

本地修改版（详见 [`VERSION`](VERSION)），Windows 构建步骤与踩坑记录见 [BUILD-Windows.md](BUILD-Windows.md)。

本次重点修复播放链路：转码音轨映射、SyncPlay 进度单位、零音量与整数音量上报、缓冲事件、字幕延迟保留、
MPV 初始化时序、重复监听和内置 MpvQt 参数内存泄漏，以及 WebEngine 透明层和全屏状态同步。
Windows 默认构建升级至 **Qt 6.12.0**；配套 **Qt WebEngine 6.140.0-rc 仍为候选版**，
可显式回退至 6.11.3 / 6.9.3。依赖来源和验证边界见 [dev/README.md](dev/README.md#qt-toolchain)，
播放验收清单见 [CONTRIBUTING.md](CONTRIBUTING.md#playback-acceptance-checklist)。

`2.0.4-Lain-rc1` 按预发布版交付。Windows 安装版和便携版均携带运行库，非 AVX2 回退不再改写安装目录；
CI 检查打包后的实际播放、静默安装/卸载及回退 DLL。**本次仅编译和发布 Windows x64 客户端**，
macOS/Linux 构建保留为手动任务，不随提交自动运行。
发行构建关闭指向上游的更新检查，请从本仓库 Releases 获取更新。

## Building
See [dev/](dev/) for platform-specific build instructions.

## File Locations
Data is stored per-profile in a `profiles/<profile-id>/` subdirectory. The main configuration file is `jellyfin-desktop.conf`.
Use **Manual MPV Configuration** in the client settings for additional MPV options,
one `key=value` per line. This fork does not currently load a profile-local `mpv.conf` automatically.

**Windows:**
- Config: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\`
- Cache: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\`
- Logs: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\`

**Linux:**
- Config: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/`
- Cache: `~/.cache/jellyfin-desktop/profiles/<profile-id>/`
- Logs: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/logs/`

**Linux (Flatpak):**
- Config: `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/`
- Cache: `~/.var/app/org.jellyfin.JellyfinDesktop/cache/jellyfin-desktop/profiles/<profile-id>/`
- Logs: `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/logs/`

**macOS:**
- Config: `~/Library/Application Support/Jellyfin Desktop/profiles/<profile-id>/`
- Cache: `~/Library/Caches/Jellyfin Desktop/profiles/<profile-id>/`
- Logs: `~/Library/Logs/Jellyfin Desktop/<profile-id>/`
