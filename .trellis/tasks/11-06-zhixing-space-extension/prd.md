# 知行空间扩展与宿主二进制下载能力

## Goal

在 Folyn 中浏览和维护公司知识库“知行空间”：管理空间，在精选知识和工作区中创建目录和文件，并把文件、目录或整个空间下载到本地。

## Repositories

| 部分 | 位置 |
|---|---|
| 扩展 | `~/project/folyn-extensions/extensions/zhixing-space/` |
| 宿主下载能力 | 当前 worktree（`frigatebird` 分支） |

## Requirements

### 扩展

- Trusted tier，以 `contributes.pages` 提供整页入口，id 为 `folyn-zhixing-space`。
- `permissions.http.origins` 声明 `https://mrbsg.gai.cn`。
- 设置页配置 API Token，保存到 `api.storage`；请求只发送 `Geekseek-User-Token` 一个鉴权头。
- 空间列表（`/space/list`，支持关键字）和创建空间（`/space/create`）。
  - 校验：`name` ≤ 50，`spaceKey` 仅小写字母、数字、`-` 且 ≤ 20，`description` 必填且 ≤ 200。
  - 创建后使用响应中的 `spaceKey`（带服务端随机后缀），不使用请求中的基础 Code。
- 每个空间分“精选知识”和“工作区”两个视图，文件树走 `/file/tree` 并传 `area`。
  - `workspaceCreated = false` 时不查询工作区，提示到知识中心页面创建。
- 新建目录：`/file/folder/create`，`area` 必填，`parentNodeId` 为当前目录。
- 新建文件：`/file/text/upsert`，仅文本扩展名；工作区路径保留 `/.workspace` 前缀。
  - 写入前用 `/file/resolve` 检查，已存在时不覆盖。
- 下载：
  - 文件或目录：按 `nodeId`。
  - 精选知识整体：仅传 `spaceKey`。
  - 工作区整体：`nodeId = workspaceRootNodeId`。
- 处理 `result != 0`、401 和 Token 未配置，向用户显示服务端 `msg`。

### 宿主

现有 `network.fetch` 无法完成下载：响应经 `resp.text()` 读取，二进制会损坏；超时固定 30 秒；扩展也没有写入自身目录的 API。

- 新增 `network.download(url, init)`，由 Rust 流式写入扩展私有下载目录，不经过 IPC 传输文件内容。
- 与 `fetch` 使用相同的 `permissions.http.origins` 校验（JS 快速失败 + Rust 复查）。
- 响应非 2xx 或为 JSON 时不落盘，把响应体返回给扩展，用于展示业务错误。
- 文件名取自 `Content-Disposition`，并做路径穿越防护；同名文件不覆盖。
- 先写临时文件，完成后再改名，失败时不留下半截文件。
- 提供在系统文件管理器中显示已下载文件的能力。

## Acceptance Criteria

- [ ] 配置 Token 后能列出空间；未配置或 Token 无效时有明确提示。
- [ ] 能创建空间，后续操作使用服务端返回的最终 `spaceKey`。
- [ ] 精选知识和工作区分别显示各自的文件树，工作区未创建时显示引导。
- [ ] 能在两个区域的根目录和子目录下创建目录和文本文件。
- [ ] 能下载文件、目录、精选知识 ZIP 和工作区 ZIP，内容与服务端一致。
- [ ] 下载业务错误不产生本地文件，并显示服务端 `msg`。
- [ ] 不在 `permissions.http.origins` 内的地址被 JS 和 Rust 两层拒绝。
- [ ] 文件名含 `../` 时不会写出下载目录。

## Out of Scope

- 上传本地二进制文件（`/file/upload`）：`ExtensionHttpInit` 只支持字符串 body。
- 编辑、追加和删除已有文件，搜索，Ripgrep，版本历史，目录索引，检索追踪。
- 创建工作区、跨区域移动：OpenAPI 不支持。

## Decisions

- 在线模式，不做本地工作副本：文件树按需拉取，文本文件经 `text/read` 打开，未上传的修改作为草稿存在 `api.storage`（`~/.folyn/storage/ext_folyn-zhixing-space_draft_<spaceKey>_<area>.json`），只有点上传才写回。考虑过的本地副本方案（整区 ZIP 下载解压、本地编辑、按哈希判断变更、拉取时三方合并）因需要宿主新增解压与扩展目录读写能力、且每次拉取都要整区下载而未采用。

- 下载目录为 `~/.folyn/extension-data/<id>/downloads/`：扩展专属，升级和重装后保留，卸载时不自动删除。不用安装目录 `~/.folyn/extensions/<id>/`，因为它在重装和升级时被整个删除（`extension_install.rs:32`、`:163`），卸载时同样删除（`extension_lifecycle.rs:33`）。

## Technical Notes

- `api.storage` 是明文 JSON，宿主和 SDK 没有提供系统钥匙串能力，Token 以明文保存在本地。
- 服务端拒绝 `tauri://localhost` 的 CORS 预检（403），请求必须走 Rust。
- 未鉴权请求返回 HTTP 401 和通用 JSON（`result: 401`），已实测。
- 扩展的 `folyn-extension-sdk` 依赖指向 `~/project/folyn`（master），宿主改动在 `frigatebird`，合入前 SDK 类型需要对齐。
- reqwest 未启用 `stream` feature，用 `Response::chunk()` 流式读取，不增加依赖。
