# Windows 本地构建说明

本仓库是 jellyfin-desktop 的本地修改版，版本号见 [`VERSION`](VERSION)（当前 `2.0.4-Lain-rc1`）。

## 当前依赖与验证范围（2026-11-02）

- 默认 Qt 升至 **6.12.0**，版本统一保存在 [`dev/qt-version.txt`](dev/qt-version.txt)，本地脚本与 CI 共用。
- **注意：配套 Qt WebEngine 当前官方标记为 `6.140.0-rc`，不是全套稳定版组件。**
  它依赖 Qt Core 6.12.0，使用独立的 `6120/61400` 下载目录；CMake 显示 WebEngine `6.140.0` 是正常的。
- [`dev/install-qt.py`](dev/install-qt.py) 修正新版 Windows 仓库路径，并选择上述配套 WebEngine，
  避免普通 `aqt -m qtwebengine` 下载到旧的 7 月构建。底层仍由固定版本 aqt 完成下载、校验和解压。
- libmpv 跟随上游更新至 `20261018-git-01e2533f31`，保留 AVX2 主版本与非 AVX2 回退 DLL。
- 已核对上游最新提交 [`6ba5b98`](https://github.com/jellyfin/jellyfin-desktop/commit/6ba5b9814f2d655b12b4e26b659817d7546c2cde)（2026-11-01），
  吸收转码音轨修复与 SyncPlay 播放进度的秒/毫秒单位修复，保留本分支的音轨和字幕选择增强。
- 已完成 Linux 上 Qt 6.12.0 全量编译、自动测试和本地播放冒烟测试；Windows 的完整 Qt 下载清单及两份 MPV 压缩包已核对。
  Windows/MSVC 构建、单元测试、独立安装包播放及安装/卸载由本仓库 Actions 在 Windows 上验证，
  只有检查成功的产物才会发布；具体结果见对应版本的发布页和 Actions 日志。
  **显卡、硬解和音频直通真机测试不在自动测试覆盖范围内**，不能把 Linux 验证当成 Windows 验证。

## 1. 环境

| 组件 | 版本 / 来源 | 说明 |
|---|---|---|
| MSVC | VS 2022 Build Tools，v143 工具集与 Windows SDK | 不再推荐 VS 2019 搭配新版 Qt |
| CMake / Ninja | CMake 3.25+、较新 Ninja | 需在 PATH 里 |
| Python | 3.13 | 脚本创建独立虚拟环境，安装 `aqtinstall==3.3.0` |
| Qt | `6.12.0` `msvc2022_64`，需 `qtwebengine qtwebchannel qtpositioning qtserialport` | 用仓库安装适配脚本，不要混入旧 WebEngine |
| libmpv 开发包 | mpv-dev `x86_64-v3` 和 `x86_64` | 版本见 [`dev/mpv-version.txt`](dev/mpv-version.txt) |
| Inno Setup | 6.x | 只有打安装包才需要，`ISCC.exe` 要在 PATH |
| 7-Zip | 较新版本 | 解压依赖；MSVC 的 `dumpbin`/`lib` 用于生成 import lib |
| Node.js | 18+，推荐受支持的 LTS | 可选，但运行 JavaScript 播放回归测试时必需，CI 强制启用 |

## 2. 推荐流程

在仓库根目录的 Windows 命令提示符中运行（需先有 winget）：

```bat
dev\windows\setup.bat
```

首次安装工具后重开终端，再执行：

```bat
dev\windows\build.bat
dev\windows\test.bat
dev\windows\run.bat
dev\windows\bundle.bat
```

依赖安装到 `dev/windows/deps/`，构建目录是 `build/`。重跑 `setup.bat` 可修复不完整的 Qt/WebEngine 安装，
并在 MPV 版本变更时更新 DLL、头文件和 import lib。切换 Qt 版本时请使用干净的构建目录，避免混用旧 CMake 缓存。

若优先使用无 RC 标记的配套组件，可以在同一终端中显式选择 6.11.3：

```bat
set QT_VERSION=6.11.3
dev\windows\setup.bat
dev\windows\build.bat
dev\windows\test.bat
```

上游保守基线 `6.9.3` 也可通过同样方式选择。`run.bat`、`test.bat`、`bundle.bat` 必须使用同一个 `QT_VERSION`；
恢复默认用 `set QT_VERSION=`。GitHub Actions 手动运行时可填写 `qt_version`，留空使用仓库默认值。

## 3. 手动配置（已有工具链时）

先通过同一个适配脚本安装 Qt，以下以 `C:\Qt` 为例：

```bat
py -3.13 -m venv dev\windows\deps\python
dev\windows\deps\python\Scripts\python -m pip install -r dev\requirements-build.txt
dev\windows\deps\python\Scripts\python dev\install-qt.py windows desktop 6.12.0 win64_msvc2022_64 -m qtwebengine qtwebchannel qtpositioning qtserialport -O C:\Qt
```

解压匹配版本的 mpv-dev 包，得到 `include/` 和 `libmpv-2.dll`。
在 “x64 Native Tools Command Prompt for VS 2022” 中生成 MSVC import lib；若使用下面的命令，需另装 `gendef`：

```bat
gendef libmpv-2.dll
lib /def:libmpv-2.def /out:libmpv-2.lib /MACHINE:X64
```

目录示例：

```text
mpv/include/...
mpv/libmpv-2.lib
mpv/libmpv-2.dll
```

用绝对路径配置；不手动维护依赖时优先使用前面的 `setup.bat`/`build.bat`：

```bat
cmake -G Ninja -S . -B build ^
  -DCMAKE_BUILD_TYPE=RelWithDebInfo ^
  -DQTROOT="C:/Qt/6.12.0/msvc2022_64" ^
  -DMPV_INCLUDE_DIR="C:/path/to/mpv/include" ^
  -DMPV_LIBRARY="C:/path/to/mpv/libmpv-2.lib" ^
  -DUSE_STATIC_MPVQT=ON ^
  -DREQUIRE_NODE_TESTS=ON
```

`QTROOT` 里的路径用正斜杠。CMake 应打印 `Qt version: 6.12.0` 与 `Qt WebEngine version: 6.140.0`。
打包还需要准备非 AVX2 回退 DLL、VC 运行库，具体参考 `dev/windows/setup.bat`。
配置成功时 CMake 会打印
`Windows installer target configured: windows_package`、`Windows portable ZIP target configured: windows_zip`、
`Windows combined target configured: windows_all`。

## 4. 编译与打包

```bat
ninja -C build
ninja -C build windows_all
```

测试时将所选 Qt 的 `bin/` 和 MPV DLL 目录加入 PATH，再运行 `ctest --test-dir build --output-on-failure`。
推荐流程中的 `test.bat` 会自动设置这些路径。打包产物在 `build/` 下：

- `JellyfinDesktop-2.0.4-Lain-rc1-x64.exe` —— Inno Setup 安装包
- `JellyfinDesktop-2.0.4-Lain-rc1-x64.zip` —— 便携版
- `output/` —— 可直接运行的目录（`Jellyfin Desktop.exe` + Qt/libmpv 等 DLL）

## 5. 已知坑

- **6.12 组件不完整**：不要将旧的 `aqt install-qt ... -m qtwebengine` 与本仓库适配脚本混用；
  更换到新的安装目录或重跑 `setup.bat`。安装失败会报错，不会偷偷回退到旧 WebEngine。
- **内存增长**：本次修复的是播放适配层的重复信号监听和内置 MpvQt 的输入参数内存泄漏，
  不代表 Qt 的所有问题（包括 QTBUG-141377）都已解决。长时间播放仍需观察，出现回归可显式切换 Qt 版本对比。
- **黑屏/白屏**：可用 `dev\windows\run.bat --disable-gpu --log-level debug` 排查 WebEngine GPU 加速，
  这不等于关闭 MPV 硬件解码；MPV 的硬解设置需单独调整。
- **`ninja: error: loading 'build.ninja'`**：说明 CMake 配置没成功、或 `ninja` 没在 `build` 目录里跑。
  上游用 `cd build && ninja`，本仓库用 `-B build` + `ninja -C build`，两者不要混用。
- **`external/mpvqt` 不再走 submodule**：本仓库把它按普通文件提交了，克隆后不需要
  `git submodule update --init`；上游 `.gitmodules` 已移除。
- **VC 运行库**：安装包已 app-local 打包 `vcruntime140*.dll` 等，目标机不需要另外装 VC++ 运行库。
- **非 AVX2 回退**：启动时通过 delay-load 选择 `libmpv-fallback.dll`，不删除或重命名主 DLL，支持只读安装目录。
  排查回退路径时可设置 `JELLYFIN_MPV_FORCE_FALLBACK=1`，测试完成后清除该变量。
- **安装包验证**：CI 解压 ZIP 到含空格的目录、隐藏开发用 Qt、测试两种 MPV DLL，再测试 EXE 静默安装、播放和卸载。
  对应脚本是 `tests/verify_windows_package.ps1`，需要 Node.js 22+、FFmpeg 和桌面会话。
- **更新与签名**：发行构建关闭上游更新提示，避免误装回上游版本；从本仓库 Releases 更新。
  未配置 Windows 代码签名证书，系统可能显示未知发布者，请核对发布页 SHA-256。
- **ARM64**：本次仅适配 Windows x64；ARM64 交叉编译和打包未验证，CI 仍禁用。

播放验收清单见 [CONTRIBUTING.md](CONTRIBUTING.md#playback-acceptance-checklist)，
依赖的官方来源和版本策略见 [dev/README.md](dev/README.md#qt-toolchain)。
