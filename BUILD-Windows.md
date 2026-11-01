# Windows 本地构建说明

本仓库是 jellyfin-desktop 的本地修改版，版本号见 [`VERSION`](VERSION)（当前 `2.0.3-Lain`）。

下面的流程是 2026-10-18 在本机实际跑通、并产出 `JellyfinDesktop-2.0.3-Lain-x64.exe` 的那一套，
和上游 `.github/workflows/build-windows.yml` 基本一致，差别只在 Qt 版本和依赖获取方式。

## 1. 环境

| 组件 | 版本 / 来源 | 说明 |
|---|---|---|
| MSVC | VS 2022 Build Tools（`Microsoft.VisualStudio.Workload.VCTools`，含 Windows SDK） | VS 2019 Build Tools 同样能编，二选一 |
| CMake / Ninja | 任意较新版本 | 只需在 PATH 里 |
| Qt | `6.11.3` `msvc2022_64`，需 `qtwebengine qtwebchannel qtpositioning` | 用 [aqt](https://github.com/miurahr/aqtinstall) 装，默认落在 `C:\Qt` |
| libmpv 开发包 | mpv-dev `x86_64-v3`（另备 `x86_64` 版 DLL 作回退） | sourceforge：`mpv-player-windows/files/libmpv/` |
| Inno Setup | 6.x | 只有打安装包才需要，`ISCC.exe` 要在 PATH |
| 7-Zip + gendef | gendef 来自 mingw-w64 binutils | 用来从 `libmpv-2.dll` 生成 import lib |

## 2. 准备 libmpv

解压 mpv-dev 的 7z，得到 `include/` 和 `libmpv-2.dll`，然后由 DLL 生成 MSVC 可用的 import lib：

```bat
gendef libmpv-2.dll
lib /def:libmpv-2.def /out:libmpv-2.lib /MACHINE:X64
```

摆放成：

```
mpv/include/...        ← mpv-dev 的 include
mpv/libmpv-2.lib       ← 上一步生成
mpv/libmpv-2.dll       ← 运行时随包分发
```

## 3. 配置

先在 “x64 Native Tools Command Prompt”（或先 `call vcvars64.bat`）里进入 MSVC 环境，然后：

```bat
cmake -G Ninja -S . -B build ^
  -DCMAKE_BUILD_TYPE=RelWithDebInfo ^
  -DQTROOT=C:/Qt/6.11.3/msvc2022_64 ^
  -DMPV_INCLUDE_DIR=<abs>/mpv/include ^
  -DMPV_LIBRARY=<abs>/mpv/libmpv-2.lib ^
  -DUSE_STATIC_MPVQT=ON
```

`QTROOT` 里的路径用正斜杠。配置成功时 CMake 会打印
`Windows installer target configured: windows_package`、`Windows portable ZIP target configured: windows_zip`、
`Windows combined target configured: windows_all`。

## 4. 编译与打包

```bat
ninja -C build
ninja -C build windows_all
```

产物在 `build/` 下：

- `JellyfinDesktop-2.0.3-Lain-x64.exe` —— Inno Setup 安装包
- `JellyfinDesktop-2.0.3-Lain-x64.zip` —— 便携版
- `build/output/` —— 可直接运行的目录（`Jellyfin Desktop.exe` + Qt/libmpv 等 DLL）

## 5. 已知坑

- **Qt 版本**：本机试过 6.10.3 / 6.11.3 / 6.12.0，最终用 **6.11.3**；6.12.0 当时 WebEngine 相关组件装不完整，
  配置过不去。上游 CI 反过来固定 **6.9.3**，原因是 6.10+ 有内存泄漏问题（QTBUG-141377）。
- **`ninja: error: loading 'build.ninja'`**：说明 CMake 配置没成功、或 `ninja` 没在 `build` 目录里跑。
  上游用 `cd build && ninja`，本仓库用 `-B build` + `ninja -C build`，两者不要混用。
- **`external/mpvqt` 不再走 submodule**：本仓库把它按普通文件提交了，克隆后不需要
  `git submodule update --init`；上游 `.gitmodules` 已移除。
- **VC 运行库**：安装包已 app-local 打包 `vcruntime140*.dll` 等，目标机不需要另外装 VC++ 运行库。
- **ARM64**：上游 CI 里 ARM64 构建是注释掉的（需要 Qt WebEngine 的 ARM64 构建），本仓库只有 x64。
