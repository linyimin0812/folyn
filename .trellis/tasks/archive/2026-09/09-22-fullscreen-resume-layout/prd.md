# 修复锁屏恢复后全屏窗口内容缩到左上角

## 问题

macOS 上窗口处于原生全屏时锁屏，解锁后窗口仍全屏，但 webview 内容按锁屏前的旧尺寸渲染、锚在左上角，其余区域空白。

## 根因

wry/WKWebView 已知问题：锁屏时显示器重配置（framebuffer/backing-scale 变化），解锁后 NSWindow 保留全屏 frame，但 WKWebView 的 backing layer 未被通知重新布局（tao 认为窗口尺寸没变，不发 resize 事件），于是按旧 layer 尺寸合成、左上对齐。仓库内无任何代码触发或缓解此问题。

## 方案

- 前端在主窗口监听 `document.visibilitychange`（锁屏/解锁必触发）：变为 visible 时 invoke 一个 Rust 命令。
- Rust 命令对 `main` 窗口强制重新布局：取窗口 inner_size，`set_size` 抖动（先 +1 再还原）触发真实 resize → wry 重新 setFrame WKWebView。若 nudge 无效，备选直接对 WKWebView `setFrame:`。
- 仅针对 `main` 窗口；pet 系列窗口不受影响（复用现有 NSPanel 逻辑）。

## 验收

- 全屏 → 锁屏 → 解锁后内容铺满窗口。
- 非全屏锁屏/解锁无副作用（窗口尺寸不变化）。
