# 进一步全拆 plugin_commands 到 install / lifecycle / fetch / rpc

## 背景
上一轮(task 08-18-plugin-commands-plugin-security)只抽出了安全层到 `plugin_security.rs`,但 `plugin_commands.rs` 仍 1243 行,还混着 4 个独立职责。本 task 把它们全拆出去,`plugin_commands.rs` 只留 URI scheme + 注册表(core 共享类型/helper)+ `is_valid_plugin_id`。

## 目标模块(5 文件 + 已有 plugin_security)

### `plugin_commands.rs`(core,大幅瘦身)
**留**:URI scheme + 注册表 + 共享 path util
- `parse_plugin_uri`、`content_type_for`、`PLUGIN_CSP`(URI scheme)
- `plugins_dir`、`PluginEntry`、`read_plugins_json`、`write_plugins_json`、`upsert_record`、`remove_record`(注册表)
- `is_valid_plugin_id`(path-safety 共享 helper,被 lifecycle + fetch 用)
- **移除** `use crate::plugin_security::{...}`(core 迁完后不再调用任何安全函数)
- **测试留**:parse_plugin_uri、content_type_for、plugins.json upsert/remove(`make_entry` helper 随留)、approve 测试(测的是 `upsert_record`/`make_entry`/`entry.integrity`,属 registry 行为)、PluginEntry serde round-trip、PluginEntry signature serde、is_valid_plugin_id

### `plugin_install.rs`(新建)
**迁**:安装路径
- `copy_dir_recursive`、`copy_inner`、`unique_staging_suffix`、`install_plugin_zip`、`install_plugin`
- 无测试(install 的测试本质是 extract_zip_filtered 的,已在上轮迁入 plugin_security)
- 依赖:`use crate::plugin_commands::{PluginEntry, plugins_dir, read_plugins_json, write_plugins_json, upsert_record};` + `use crate::plugin_security::{compute_integrity, verify_plugin_signature, validate_manifest, extract_zip_filtered};` + `use crate::errors::AppError;` + std/fs/path、serde、tauri::{Emitter, Manager}
- 这两个 install 函数 emit `"plugin://installed"` 事件,保留

### `plugin_lifecycle.rs`(新建)
**迁**:CRUD 命令
- `list_plugins`、`uninstall_plugin`、`approve_plugin`、`get_plugin_record`、`read_plugin_file`、`grant_capabilities`、`verify_plugin_signature_cmd`
- 无测试(approve 测试随 registry 留 core)
- 依赖:`use crate::plugin_commands::{PluginEntry, plugins_dir, read_plugins_json, write_plugins_json, upsert_record, remove_record, is_valid_plugin_id};` + `use crate::plugin_security::verify_plugin_signature;`(仅 verify_plugin_signature_cmd 用)+ `use crate::errors::AppError;` + tauri::{Emitter, Manager}、serde、std
- lifecycle 不调 install(已确认);install 也不调 lifecycle

### `plugin_fetch.rs`(新建)
**迁**:网络 fetch
- `HttpResponse`(struct)、`FETCH_URL_ALLOWED_HOSTS`(const)、`reqwest_fetch`、`fetch_url`、`plugin_http_fetch`
- **测试迁**:`http_response_round_trips`(测 HttpResponse)
- 依赖:`use crate::plugin_commands::{is_valid_plugin_id, plugins_dir};`(plugin_http_fetch 用)+ `use crate::plugin_security::check_http_origin;` + `use crate::errors::AppError;` + tauri::{Emitter, Manager}、reqwest、serde、std::time::Duration

### `plugin_rpc.rs`(新建)
**迁**:RPC 桥
- `RpcResponseData`(struct)、`next_rpc_request_id`、`plugin_rpc_respond`、`handle_plugin_rpc_request` + 顶部 `use std::sync::atomic::{AtomicU64, Ordering};`(随 rpc 段迁)
- **测试迁**:`next_rpc_request_id_is_monotonic_and_unique`(fetch-RPC bridge 段)
- 依赖:`use crate::errors::AppError;` + tauri(Manager)、serde、std::sync::atomic。**自包含**,不依赖其它 plugin 模块

## lib.rs 改动
1. 注册新模块(在 `mod plugin_security;` 后):
   ```rust
   mod plugin_commands;
   mod plugin_security;
   mod plugin_install;
   mod plugin_lifecycle;
   mod plugin_fetch;
   mod plugin_rpc;
   ```
2. URI scheme handler(349 行 `use plugin_commands::{...}`)更新为从两处导入:
   ```rust
   use plugin_commands::{content_type_for, parse_plugin_uri, plugins_dir, PLUGIN_CSP};
   use plugin_rpc::{handle_plugin_rpc_request, next_rpc_request_id};
   ```
3. `generate_handler!`(857-868)更新模块前缀:
   - `plugin_install::install_plugin`、`plugin_install::install_plugin_zip`
   - `plugin_lifecycle::list_plugins`、`::uninstall_plugin`、`::approve_plugin`、`::get_plugin_record`、`::read_plugin_file`、`::grant_capabilities`、`::verify_plugin_signature_cmd`
   - `plugin_fetch::plugin_http_fetch`、`plugin_fetch::fetch_url`
   - `plugin_rpc::plugin_rpc_respond`

## 接线总原则
- 每个新文件顶部 `use` 只导**实际被该文件调用的**符号;不要 glob `*`(避免unused/冲突)。
- `pub` 可见性**不变**:被跨模块调用的函数本就 `pub`,迁入新文件后仍是 `pub`;私有 helper(`copy_inner`、`reqwest_fetch`)保持私有。
- `#[tauri::command]` 宏**随函数迁**,位置不动。
- 纯 move:不改任何函数体逻辑、不改签名、不改可见性、不改事件名。

## 验证(实现者自检,**不跑 cargo**——见 memory feedback_no_whole_project_compile)
- 行数:`plugin_commands.rs` 从 1243 → ~450(URI+registry+util+测试);4 个新文件各自行数合理。
- `grep -nE 'pub (async )?fn |pub struct |pub const |const ' plugin_commands.rs` 应只剩 URI scheme + registry + is_valid_plugin_id,无 install/lifecycle/fetch/rpc 函数。
- lib.rs:6 个 `mod plugin_` 声明;`generate_handler!` 内所有命令前缀正确(无 `plugin_commands::install_plugin` 残留)。
- 依赖无环:plugin_commands 不 `use` 任何 plugin_*;plugin_install/lifecycle/fetch 各 `use` plugin_commands + plugin_security;plugin_rpc 不 `use` 任何 plugin_*。
- 大括号各文件平衡。
- 测试随函数:plugin_fetch 有 http_response_round_trips;plugin_rpc 有 next_rpc_request_id 测试;plugin_commands 保留 parse_uri/content_type/upsert/make_entry/approve/entry serde/is_valid_plugin_id 测试。

## 非目标
- 不动 `plugin_security.rs`(上轮已拆完)。
- 不动 `chat.rs`(另一 task,已改)。
- 不把 registry 拆成独立 `plugin_registry.rs`(用户要 5 模块,registry 作为 core 留 plugin_commands)。
- 不统一各 provider stream(那是 chat.rs 范畴)。
- 不 git commit。

## 风险
- 中。改动面大(4 新文件 + lib.rs + plugin_commands 瘦身),但全是纯 move。唯一注意点:
  - 每个新文件的 `use` 清单要精确——漏一个编译就报,编译器会指路。
  - `reqwest_fetch` 私有但被 `fetch_url` 和 `plugin_http_fetch` 调用(同文件内),迁到 plugin_fetch 后仍同文件,无跨模块问题。
  - `copy_inner` 私有被 `copy_dir_recursive` 调用(同文件),迁 plugin_install 后同文件,无问题。
  - `is_valid_plugin_id` 留 core、被 fetch+lifecycle 跨模块 `use`——确认它 `pub`(已是 `pub fn`)。
