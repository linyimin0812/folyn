# 拆分 plugin_commands 安全层到 plugin_security

## 背景
`apps/desktop/src-tauri/src/plugin_commands.rs` 共 2431 行(产品码 ~1528 行 + 内嵌 `#[cfg(test)] mod tests` ~903 行),单文件混了 6 职责:URI scheme、插件注册表、安装命令、网络 fetch、RPC、以及**安全敏感代码**(签名验签/integrity 哈希/zip 路径安全/manifest 校验/origin 校验)。安全代码和业务流程混编,既难测又难审。

## 目标
把**安全/信任边界**相关函数及其单元测试整体迁移到新模块 `apps/desktop/src-tauri/src/plugin_security.rs`,业务命令与 URI scheme 留在 `plugin_commands.rs`。**纯 move 重构,不改任何逻辑、不改签名、不改公开可见性。**

## 迁移清单(函数 → plugin_security.rs)

### 产品码
- `compute_hash`
- `compute_integrity` + `walk_and_hash`(私有 helper)
- `verify_integrity`
- `decode_base64`
- `canonicalize_manifest`
- `verify_plugin_signature`
- `validate_manifest` + `is_kebab_case` + `regex_lite`(私有 helper)
- `check_size`(私有)
- `is_blacklisted_path`(私有)
- `is_unknown_ext`(私有)
- `safe_zip_path`(私有)
- `extract_zip_filtered`(私有)
- `extract_origin`
- `is_origin_allowed`
- `check_http_origin`

### 测试
上述函数在 `#[cfg(test)] mod tests` 中的全部用例一并迁移到 `plugin_security.rs` 的内嵌 `#[cfg(test)] mod tests`。

## 留在 plugin_commands.rs
- URI scheme:`parse_plugin_uri`、`content_type_for`、`PLUGIN_CSP`
- 注册表:`PluginEntry`、`plugins_dir`、`read_plugins_json`、`write_plugins_json`、`upsert_record`、`remove_record`
- 安装命令:`install_plugin`、`install_plugin_zip`、`unique_staging_suffix`、`copy_dir_recursive` + `copy_inner`、`list_plugins`、`uninstall_plugin`、`approve_plugin`、`get_plugin_record`、`read_plugin_file`、`grant_plugin_capabilities`、`verify_plugin_signature_cmd`
- 网络:`HttpResponse`、`reqwest_fetch`、`fetch_url`、`is_valid_plugin_id`、`plugin_http_fetch`
- RPC:`RpcResponseData`、`next_rpc_request_id`、`plugin_rpc_respond`、`handle_plugin_rpc_request`

## 接线
1. `lib.rs` 顶部新增 `mod plugin_security;`(紧邻现有 `mod plugin_commands;`)。
2. `plugin_commands.rs` 顶部加 `use crate::plugin_security::{compute_hash, compute_integrity, verify_integrity, decode_base64, canonicalize_manifest, verify_plugin_signature, validate_manifest, extract_zip_filtered, extract_origin, is_origin_allowed, check_http_origin};`(仅导入 `plugin_commands.rs` 内部仍调用的函数)。
3. `lib.rs` 的 `generate_handler!` 与 URI scheme 处无需改动 —— 命令函数仍在 `plugin_commands`,且 `plugin_commands` 通过 `use` 重新导出后符号解析不变。

## 验证
- `cargo check`(用户自己跑,我不跑全项目编译 —— 见 memory feedback_no_whole_project_compile)。
- 现有单元测试覆盖了全部被迁移函数(见 `mod tests`),迁移后必须全部通过。
- 行为零变化:无逻辑改动、无签名改动、无可见性改动。

## 非目标
- 不拆 `chat.rs`、`ErDiagramX6.tsx` 等其他大文件(见上轮架构报告)。
- 不改 `voice` 模块。
- 不动 install_plugin 的业务流程。

## 风险
- 低。纯 move;唯一陷阱是 `plugin_commands.rs` 内部对被迁函数的调用需补 `use`,漏一个就编译失败 —— 编译器会直接报出。
- 测试 mod 迁移时注意:测试里用了 `super::`(引用 plugin_commands 内其它非迁移函数)的情况需检查;从 grep 看被迁函数的测试是自包含的,只调用被迁函数本身。
