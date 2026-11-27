# Jellyfin Desktop

Jellyfin desktop client built with Qt WebEngine and [libmpv](https://github.com/mpv-player/mpv). Supports audio passthrough, hardware decoding, and playback of more formats without transcoding.

![Screenshot of Jellyfin Desktop](screenshots/video_player.png)

## Downloads
- [This fork: Windows releases and installers](https://github.com/hellomrli/my-jellyfin/releases/latest)
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

当前源码版本为 `2.0.6-Lain`（详见 [`VERSION`](VERSION)）。
Windows 构建步骤与踩坑记录见 [BUILD-Windows.md](BUILD-Windows.md)。

已核对上游至 [`7093013`](https://github.com/jellyfin/jellyfin-desktop/commit/70930139f7ef0c59b6ac98e8d0be436953c79083)（`v2.1.0-pre2`），按需移植而非整分支合并。
Windows libmpv 升级到 `20261108-git-55d3feb45c`，修复弱网反复断线后意外跳集；S/PDIF 仅对不能直通的多声道音频加 AC3 编码滤镜。
保留自定义窗口尺寸，视频退出缓冲时通知网页隐藏转圈；另修正新版 Qt 弹窗、预告片元数据和加载过期音频设备列表的问题。
前一轮已包含：
播放进度通知按 100 毫秒媒体时间间隔发送，SyncPlay 仍可读取最近的原生进度；支持 Esc 退出正在播放或暂停的视频全屏，
修正 Windows 任务栏进度与调试信息，并自动将类型错误的音频设备配置修复为 `auto`。
切换或结束文件时清空原生进度/时长缓存，重新激活窗口时保留全屏或最大化状态；
修复日志初始化和轮转可能引发的启动卡死，日志不可写时仍可启动。逐项同步记录见 [UPSTREAM.md](UPSTREAM.md)。

保留转码音轨映射、SyncPlay 进度单位、零音量与整数音量上报、缓冲事件、字幕延迟保留、
MPV 初始化时序、重复监听和内置 MpvQt 参数内存泄漏修复，以及 WebEngine 透明层和全屏状态同步。
Windows 默认构建使用截至 2026-11-14 最新公开正式版 **Qt 6.12.0**；
配套 **Qt WebEngine 6.140.0** 的官方包已于 2026-11-11 更新并去掉 RC 标记。
可显式回退至 6.11.3 / 6.9.3。依赖来源和验证记录见 [dev/README.md](dev/README.md#qt-toolchain)，
播放验收清单见 [CONTRIBUTING.md](CONTRIBUTING.md#playback-acceptance-checklist)。

本轮发布名称与 Git 标签采用 `v2.0.6-Lain自用版`，下载及验证结果见
[本仓库 Releases](https://github.com/hellomrli/my-jellyfin/releases)。
程序内部版本号及安装包文件名使用 `2.0.6-Lain`。`2.0.5-Lain` 只有源码和 CI 构建，没有单独发布标签或 Release。
已发布的 `2.0.4-Lain` 使用发布时标记为 RC 的 WebEngine 包；上述新组件用于本轮构建。
Windows 安装版和便携版均携带运行库，非 AVX2 回退不再改写安装目录；
CI 检查打包后的实际播放、静默安装/卸载及回退 DLL。**自动构建和发行包面向 Windows x64 客户端**，
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

### 连接与隐私

修复连接过程中切换请求可能导致的崩溃，以及请求超时后停止重试的问题。
Esc 可取消等待原生接口就绪的连接；立即重连时，旧结果不会覆盖新连接或触发跳转。
IPv6 地址保留方括号，反向代理路径保留 URL 编码；输入地址会去掉首尾空格，并正确识别大小写的 HTTP/HTTPS 协议。
连接页在启动时立即显示，连接期间提供取消按钮并保留 Esc 取消；取消后焦点回到地址栏，可立即重连。
非法地址和应用尚未就绪时显示可见提示，编辑地址会清除旧错误；支持简繁中文提示及 Windows 的中文脚本语言标记。
小窗口下表单和提示不会横向溢出，键盘操作有明确的焦点提示。
每次连接最多重试 60 秒，超时后回到表单并显示原因。地址不能内嵌用户名或密码；输入地址的查询参数和片段不用于探测或保存。
已有配置中的此类查询和片段会在读取时移除，带凭据的已保存地址会清空，需要重新输入。以前生成的日志不会被改写。
自动测试和实际程序验收方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

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
