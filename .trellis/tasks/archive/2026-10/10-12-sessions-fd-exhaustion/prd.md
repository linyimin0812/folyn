# 会话发现阶段文件描述符耗尽

## Bug

用户在真实数据上打开会话面板时，发现阶段大量报错：

- Claude 来源：「部分来源读取失败：…unreadable file head」（后半批全部失败）
- pi 来源：「Too many open files (os error 24)」

## 根因（已定位）

`fs.tauri.ts` 的 `readLines` 端口用 `@tauri-apps/plugin-fs` 的 `readTextFileLines` 做有界头读取（HEAD_LINES 行后 break）。但该 API 返回的迭代器**没有 `return()` 方法**（dist-js/index.js 源码确认：对象只有 `next()` 和 `[Symbol.asyncIterator]()`），`void iterator.return?.()` 是空操作。Rust 侧资源只在迭代到 done（EOF）时释放——提前 break = 每个文件泄漏一个文件句柄。发现是串行扫几百个文件（Claude 跨项目 ~300+），逐一泄漏直到 macOS 默认 256 FD 软上限耗尽。三个来源的发现并行共享 FD 预算，pi 的原生错误 24 直接确认了耗尽。

## 修复方案

在 `fs.tauri.ts` 的 `readLines` 端口一处修复（三个适配器共用）：改用 `open()` 拿 FileHandle → `read()` 读前 64KB → `finally close()`（FileHandle 有显式 close）。字节流用 UTF-8 解码后按行 split，丢弃最后一个可能截断的行。64KB 足够 HEAD_LINES（各适配器 ≤ 50 行）的元数据扫描。不使用 `readTextFileLines`。

## 同任务修复 #2：Claude 会话标题字段名错误（真实数据验证）

`scanHead` 读取 `record.title`，但真实记录的字段名是 `aiTitle`（ai-title）/`customTitle`（custom-title）——标题永远为空，回落到第一条提示词，列表显示"会话名不对"。修复：读取正确字段，优先级 custom-title（用户改的名）> ai-title > 首条提示词；同文件内多次出现时取**最后**一条（标题可能中途再生成）。

## 验收

- 真实机器上打开会话面板：Claude/pi/Codex 三来源无 unreadable / EMFILE 错误，全部会话列出
- Claude 会话标题显示 ai-title/custom-title 的值（如「预览页双击选词」），不再显示原始提示词
- 合成回归测试：readLines 端口在 break 情况下显式关闭句柄（mock FileHandle 断言 close 被调用）
- 现有 sessions 测试套件全绿
