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

正式版发布名称与 Git 标签为 [`v2.0.4-Lain自用版`](https://github.com/hellomrli/my-jellyfin/releases/tag/v2.0.4-Lain%E8%87%AA%E7%94%A8%E7%89%88)，
程序内部版本号及安装包文件名使用 `2.0.4-Lain`，避免中文进入 Windows 构建脚本和 HTTP 版本标识。
应用按正式版发布不改变配套 WebEngine 仍为 RC 的事实，Qt/MPV 版本与已测试的预发布版保持一致。
Windows 安装版和便携版均携带运行库，非 AVX2 回退不再改写安装目录；
CI 检查打包后的实际播放、静默安装/卸载及回退 DLL。**本次仅编译和发布 Windows x64 客户端**，
macOS/Linux 构建保留为手动任务，不随提交自动运行。
发行构建关闭指向上游的更新检查，请从本仓库 Releases 获取更新。

### 字体

Windows 安装版和便携版均内置 **Noto Sans CJK SC（黑体风格）**、**Noto Serif CJK SC（宋体风格）**，
各含常规和粗体，供原生播放器的字幕使用。字体放在程序旁的 `fonts/`，不安装到 Windows 系统中。
普通 SRT 等无指定字体的字幕默认使用 Noto Sans；字幕设置中的 `Serif` 使用 Noto Serif，也可直接选择这两个字体名称。
保留 ASS 的字体/粗细样式及视频内嵌字体，手动 MPV 配置仍可覆盖默认选项。

连接页和原生界面继续使用系统字体；Jellyfin 主界面还可使用服务器提供的网页字体，不强行改成字幕字体。
新增字体来自 [Noto CJK](https://github.com/notofonts/noto-cjk)，以 SIL OFL 1.1 许可原样附带，
校验清单及许可证位于 `licenses/fonts/`。不附带无再分发授权的微软雅黑、宋体、Arial 等微软字体。

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
