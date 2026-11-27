# 上游同步记录

## 2026-11-27：2.0.6-Lain

核对范围：[6482a5f…7093013](https://github.com/jellyfin/jellyfin-desktop/compare/6482a5f...7093013)，终点为上游 `v2.1.0-pre2`。

| 上游 PR | 本分支处理 |
| --- | --- |
| [#1297](https://github.com/jellyfin/jellyfin-desktop/pull/1297) | 为同一请求的 HEAD、GET 和重试间隔共用 60 秒总时限；保留请求 ID、取消、IPv6 和编码路径。用本地化原因代替包含 URL 的网络错误文本。 |
| [#1348](https://github.com/jellyfin/jellyfin-desktop/pull/1348) | 更新 Windows 的两个 libmpv 构建，避免长视频在多次成功重连后误报 EOF。 |
| [#1316](https://github.com/jellyfin/jellyfin-desktop/pull/1316) | 随音轨编解码器和声道数切换 AC3 滤镜，不重编码可直通音轨或双声道。 |
| [#1332](https://github.com/jellyfin/jellyfin-desktop/pull/1332)、[#1333](https://github.com/jellyfin/jellyfin-desktop/pull/1333)、[#1314](https://github.com/jellyfin/jellyfin-desktop/pull/1314) | 初始化时从原生端读取设置与设备列表；只修正旧式 Tool 弹窗；预告片元数据不可用不影响事件绑定。 |
| [#1273](https://github.com/jellyfin/jellyfin-desktop/pull/1273)、[#1322](https://github.com/jellyfin/jellyfin-desktop/pull/1322) | 已有等待事件去重及 Chromium 参数保留。继续关闭指向上游的更新检查，不随上游修改版本号或引入 Linux 元数据、编译告警清理。 |

另参考当时未合并的 [#1323](https://github.com/jellyfin/jellyfin-desktop/pull/1323) 和 [#1358](https://github.com/jellyfin/jellyfin-desktop/pull/1358)：恢复过的窗口尺寸不再被删；视频每次进入 `waiting` 后仅发送一次配对的 `canplay`。Windows 安装包及便携包额外检查 `ControlsDelegates` 的插件和关键 QML 文件（[#1321](https://github.com/jellyfin/jellyfin-desktop/pull/1321)）。

Windows 基线/主 DLL 的打包播放及安装卸载由该版本的 Actions 验收；本地文件冒烟不等同于在真实服务器上断网重连、硬解或功放直通测试。正式产物以[发布页](https://github.com/hellomrli/my-jellyfin/releases)为准。

## 2026-11-14：2.0.5-Lain

上游仓库：[jellyfin/jellyfin-desktop](https://github.com/jellyfin/jellyfin-desktop)。
本轮核对范围为 [`6ba5b98..6482a5f`](https://github.com/jellyfin/jellyfin-desktop/compare/6ba5b9814f2d655b12b4e26b659817d7546c2cde...6482a5f36dbac74cec03caddde41adf60056ae78)，
同步终点为 `6482a5f36dbac74cec03caddde41adf60056ae78`（2026-11-14 合入，日期按北京时间）。

本仓库最初以源码快照导入，与上游没有共同提交历史，因此按补丁适配。
下面列出范围内的功能提交；合并提交不重复列入。

| 上游提交 | 内容 | 本分支处理 |
| --- | --- | --- |
| [`e520e12`](https://github.com/jellyfin/jellyfin-desktop/commit/e520e122f5f6ae6915f6ea2e70a9d42af777df4a) | 渲染进程切换后恢复透明背景 | 已有等效实现，保留 |
| [`1a1a586`](https://github.com/jellyfin/jellyfin-desktop/commit/1a1a586565cc74cf3edcca2cbf7899efd1cec125) | 音量取整和范围限制 | 已有实现，并保留零音量及非法输入处理 |
| [`6ab4a8b`](https://github.com/jellyfin/jellyfin-desktop/commit/6ab4a8bba50999f968dd1100b85421976eac1bcb) | 上游版本号改为 2.1.0-pre1 | 沿用本分支版本序列，本轮版本为 2.0.5-Lain |
| [`6438a78`](https://github.com/jellyfin/jellyfin-desktop/commit/6438a7823306f28aa87e02fefc94315e775f5322) | 进度通知节流，缓存原生进度和时长 | 已适配；两个 getter 均返回毫秒，切换/结束文件时清空缓存 |
| [`970bc42`](https://github.com/jellyfin/jellyfin-desktop/commit/970bc4254bb31957b2ab9801ff662dda883b2fe9) | Esc 退出视频全屏，去除强制保持视频输出 | 已适配；通过带通知的 QML 属性同步视频状态，暂停时仍可退出 |
| [`c7472b7`](https://github.com/jellyfin/jellyfin-desktop/commit/c7472b7ea8e30e20727bb64918bb9340e0537206) | 修正 Windows 任务栏计算的类型冲突 | 已适配；使用同类型浮点比例并限制在 0–100，避免整数乘法溢出 |
| [`5a37e30`](https://github.com/jellyfin/jellyfin-desktop/commit/5a37e30b3bcda62e5bd891d88acf2afba30af548) | 时长不可用时归零 | 已适配；非有限值和超出整数范围的值也归零 |
| [`5b05c66`](https://github.com/jellyfin/jellyfin-desktop/commit/5b05c6612803a3b662d16f99fc5e7f5789bdb7a2) | 修正调试层丢帧统计 | 改用 frame-drop-count / decoder-frame-drop-count |
| [`981e4b8`](https://github.com/jellyfin/jellyfin-desktop/commit/981e4b8399fc4633aabea14b4640adfbdac3b0f0) | 移除废弃缓存属性 | 移除 cache-used |
| [`cec283c`](https://github.com/jellyfin/jellyfin-desktop/commit/cec283c06a3f0af4f8c3ef7c45ae69a81b3b85a9) | 自动修复类型错误的音频设备配置 | 修复为 auto 并保存；保留有效但暂时断开的设备选择 |
| [`7c2a4c0`](https://github.com/jellyfin/jellyfin-desktop/commit/7c2a4c0bf5320ecf0561ddf0a241a9794c7064ca) | 修复日志初始化/轮转死锁和重入 | 已适配；使用递归锁、重入保护和 UUID 临时文件名，创建缺失目录，轮转前检查路径；日志不可写时报告错误并继续启动 |

进度通知的间隔按媒体时间计算，1 倍速连续播放时约每秒 10 次；SyncPlay 的原生读取不受通知间隔限制。
文件结束时只清理原生缓存，不向网页发送虚假的零进度事件，以免覆盖最终播放位置。
音频配置通过排队的通知应用，避免修复过程嵌套写入设置后，网页端又收到原始错误值。

另修正 Qt 的 CMake 特性检测未恢复 `CMAKE_REQUIRED_*` 变量的问题，
避免未启用可选 SDL 时把 Qt 的 C++ 链接要求带入后续 X11 的 C 检测。

实际键盘验证还发现：`QWindow::show()` 会把正在全屏或最大化的窗口恢复为普通窗口。
已将原生窗口激活改为设置可见性，QML 托盘恢复复用同一方法，保留窗口状态；最小化窗口仍先解除最小化。
新增回归测试已先在修复前复现全屏/最大化丢失，以及日志目录缺失时退出和清理后轮转卡死的问题。
日志重入时的备用终端输出仍会遮蔽鉴权信息。

Qt Core/MPV 固定版本、内置 Noto 字体、Windows 打包方式和自动构建平台范围沿用本分支配置。
另核对了同一下载渠道内最新的 WebEngine 包，并修正安装器和文档中过时的 RC 描述。
本次对应 `2.0.5-Lain`；[Windows CI 构建成功](https://github.com/hellomrli/my-jellyfin/actions/runs/43555782883)，未创建独立发布标签或 Release。

## 本地验证（2026-11-14）

本地环境为 Linux，使用隔离的 Qt Core/WebEngine 6.10.2、libmpv 0.41.0 和 CMake 3.31。
Windows 构建默认 Qt Core 6.12.0，截至本次核对仍是最新公开正式版；配套 WebEngine 为 6.140.0，
官方包于 2026-11-11 更新并去掉 RC 标记，安装器构建版本为 `6.12.0-0-202611110526`。
MPV 固定版本见 `dev/mpv-version.txt`；已发布的 `2.0.4-Lain` 使用发布时的 WebEngine RC 包。

- 完整编译通过；未启用可选 SDL，X11 检测正常。
- CTest 的 10 个套件全部通过，包含 9 个原生套件和 35 项 JavaScript 播放回归测试。
- Qt/字体安装器的 16 项 Python 测试全部通过。
- Windows Qt 安装器实时下载清单核对通过：13 个包，WebEngine 及 WebView 插件均选中 11 月 11 日构建，
  安装目标仍为 `6.12.0/msvc2022_64`，未选中旧的 7 月构建；结果保存在 `build/qt-audit-20261114/windows-dry-run.log`。
- 实际 Qt/WebEngine/MPV 播放通过：直接播放选择第二音轨，单音轨转码样本选择第一音轨；
  暂停/恢复、毫秒进度和时长、零音量、字幕延迟、异常音频配置保存/网页同步，以及停止后的缓存清理均通过。
  本地结果保存在 `build/upstream-sync/smoke-20261114-final/result.json`。
- Xvfb 下的 7 项真实按键/重复加载检查全部通过：浏览、播放、暂停、停止、纯音频、
  相同时长的连续加载，以及从纯音频切回视频；结果保存在 `build/upstream-sync/ui-verification/result.json`。

上述检查在本地 Linux 环境完成。Windows/MSVC 编译、回归测试和安装包验收由
[build-windows 工作流](https://github.com/hellomrli/my-jellyfin/actions/workflows/build-windows.yml) 执行，
各版本的最终构建及验证记录见发布页。
转码样本为预生成的单音轨文件，服务器转码、硬解和音频直通仍按 [播放验收清单](CONTRIBUTING.md#playback-acceptance-checklist) 在真机核对。

## 后续核对

```sh
git fetch --no-tags upstream master
git log --first-parent --oneline 70930139f7ef0c59b6ac98e8d0be436953c79083..upstream/master
git diff 70930139f7ef0c59b6ac98e8d0be436953c79083 upstream/master
```

新克隆如未配置上游，先运行
`git remote add upstream https://github.com/jellyfin/jellyfin-desktop.git`。
