# 扩展商店（Extension Store）

Folyn 的扩展商店：在「设置 → 扩展」里新增「商店」标签页，列出 GitHub 上托管的可用扩展，点击即可下载安装。扩展打包成 zip，托管在 [linyimin0812/folyn-extensions](https://github.com/linyimin0812/folyn-extensions) 的 GitHub Releases。

## 面向用户

设置 → 扩展 → 商店标签页。每张卡片显示扩展名、版本、tier、作者、描述。已安装的扩展显示「已安装」；未安装的显示「安装」按钮，点击即从 GitHub Releases 下载 zip 并安装。MVP 不做版本更新检查 —— 需要更新时在「已安装」页卸载后重装，或直接在商店重新安装覆盖。

## 架构

```
商店标签页 (ExtensionsSettings.tsx)
   │  fetchCatalog()                          installFromUrl(entry)
   ▼                                            ▼
extensionStore.ts                              extensionStore.ts
   │  invoke('fetch_url', { url: CATALOG_URL })  invoke('install_extension_from_url', { id, url })
   ▼                                            ▼
fetch_url (Rust) — 白名单含 raw.githubusercontent.com   install_extension_from_url (Rust)
   │  reqwest GET catalog.json                     │  reqwest 下载 zip 字节 → 落临时 zip
   ▼                                               │  → 调 install_extension_zip (复用全部解压/校验/落盘/事件)
catalog JSON on folyn-extensions repo              ▼
                                            GitHub Releases (github.com/.../releases/download/<tag>/<zip>)
```

**关键边界**：
- `fetch_url` 的 host 白名单加了 `raw.githubusercontent.com`（catalog 在 folyn-extensions 仓库，webview 无法跨域直接取，走 Rust 代理）。
- `install_extension_from_url` 只允许 host 为 `github.com`（SSRF 防护）。Release asset 会 302 到 `objects.githubusercontent.com`，reqwest 的 `Policy::limited(10)` 跟随重定向 —— host 检查只看初始 URL。
- 下载的 zip 字节落 `~/.folyn/extensions/.staging/<id>-dl-<pid>-<nanos>.zip`，然后调 `install_extension_zip`，**完整复用**其 unzip / 过滤 / manifest 校验 / integrity / registry / `extension://installed` 事件逻辑。临时 zip 在成功与失败路径都清理。

## catalog 格式

catalog 是 folyn-extensions 仓库根目录的 `catalog.json`，经 `https://raw.githubusercontent.com/linyimin0812/folyn-extensions/main/catalog.json` 取。

参考格式（见 `extensions/store/catalog.json`）：

```json
{
  "extensions": [
    {
      "id": "folyn-rich-text",
      "name": { "zh": "富文本", "en": "Rich Text" },
      "version": "0.1.0",
      "description": { "zh": "富文本编辑器：ProseMirror 编辑器 + HTML 导出", "en": "Rich text editor: ProseMirror editor + HTML export" },
      "tier": "trusted",
      "author": "Folyn",
      "icon": "<svg ...>...</svg>",
      "downloadUrl": "https://github.com/linyimin0812/folyn-extensions/releases/download/folyn-rich-text-0.1.0/folyn-rich-text-0.1.0.zip"
    }
  ]
}
```

字段：
- `id` — 必须与 zip 内 `manifest.json` 的 `id` 一致（`install_extension_zip` 会校验）。
- `name` / `version` / `description` / `author` — 展示用。`name`/`description` 可为纯字符串（所有语言回退）或 `{ locale: text }` 对象，应用按当前 locale 解析（回退：当前 locale → zh → en → 第一个可用）。
- `tier` — `trusted` | `sandbox`。可信层安装后仍需在「已安装」页点「批准」授权（TOFU）。
- `icon` — 应与扩展 `manifest.json` 的 `icon` **一致**：inline SVG 文本（把扩展的 `.svg` 内容粘进来）或 emoji。商店从 catalog 渲染、已装列表从本地 manifest 渲染，两边一致才不出现「商店和已装图标不同」。
- `downloadUrl` — 必须是 `github.com` 的 Release asset 直链。

## 发布一个扩展到商店

1. **构建 dist**：在 `extensions/<id>/` 跑该扩展的 build 脚本（如 `pnpm build`，产物在 `dist/`）。
2. **打包 zip**：把 `dist/` 内容 + `manifest.json` 打成 zip，根目录必须含 `manifest.json`：
   ```sh
   cd extensions/<id>
   (cd dist && zip -r -X ../<id>-<version>.zip .) && cp src/manifest.json <id>-<version>.zip  # 注意 manifest 要在 zip 根
   ```
   更稳妥：先组装一个临时目录 `pkg/`（含 `manifest.json` + `dist/` 内容），再 `zip -r -X <id>-<version>.zip pkg/*` 确保 manifest 在根。zip 内不得有 `src/`、`*.ts`、`package*.json` 等（`extract_zip_filtered` 会拒绝）。
3. **创建 Release**：在 folyn-extensions 仓库创建 tag `<id>-<version>`（如 `folyn-rich-text-0.1.0`），上传 zip 作为 asset：
   ```sh
   gh release create folyn-rich-text-0.1.0 folyn-rich-text-0.1.0.zip \
     --repo linyimin0812/folyn-extensions \
     --title "folyn-rich-text 0.1.0"
   ```
4. **更新 catalog**：编辑 folyn-extensions 仓库的 `catalog.json`，加/更新该条目（`version` 与 `downloadUrl` 的 tag/asset 名要一致），提交到 `main`。

商店在用户切到「商店」标签页时拉取 catalog（首次加载，之后可点「刷新」重取）。

## 第三方贡献扩展

本商店是「集中目录 + PR」模型：`catalog.json` 在 [linyimin0812/folyn-extensions](https://github.com/linyimin0812/folyn-extensions) 仓库，第三方扩展的 zip 托管在发布者自己的 GitHub Releases。第三方把扩展打成 zip、发到自己仓库的 Release、向 folyn-extensions 提 PR 在 `catalog.json` 加一条（`downloadUrl` 指向自己的 Release），维护者审核 manifest / 权限 / tier 后合并，所有用户即在商店可见。

完整发布流程与维护者审核 checklist 见 [folyn-extensions/CONTRIBUTING.md](https://github.com/linyimin0812/folyn-extensions/blob/main/CONTRIBUTING.md)。关键约束：zip 根须含 `manifest.json`、无源码/锁文件/`node_modules`（`extract_zip_filtered` 强制）、`downloadUrl` host 必须 `github.com`（`install_extension_from_url` 的 SSRF 防护）。

### 从 URL 直接安装（点对点分享）

商店页另有一个「从 URL 安装」输入框：粘贴任意 `github.com` Release zip 直链即可装，不经 catalog。id 由 Rust 侧从下载 zip 的 `manifest.json` 根条目读出（`read_manifest_id_from_zip`，不解压全部）—— 不从文件名猜，因为命名规范不强制。适合私下分享、未进官方目录的扩展。

## 实现位置

| 文件 | 作用 |
|---|---|
| `apps/desktop/src-tauri/src/extension_fetch.rs` | `fetch_url` 白名单加 `raw.githubusercontent.com`（catalog 取数）|
| `apps/desktop/src-tauri/src/extension_security.rs` | `read_manifest_id_from_zip`：从 zip 根 manifest 读 id（从 URL 安装时）|
| `apps/desktop/src-tauri/src/extension_install.rs` | `install_extension_from_url`：reqwest 下载 → 临时 zip → 复用 `install_extension_zip`；空 id 时从 zip manifest 读 id |
| `apps/desktop/src-tauri/src/lib.rs` | 注册 `install_extension_from_url` 命令 |
| `apps/desktop/src/store/extensionStore.ts` | `catalog` / `catalogLoading` / `catalogError` / `fetchCatalog` / `installFromUrl` / `installFromRawUrl` |
| `apps/desktop/src/components/settings/ExtensionsSettings.tsx` | 「已安装 / 商店」标签页 + `StoreEntryCard` + 「从 URL 安装」输入框 |
| `apps/desktop/src/i18n/locales/{en,zh}/settings.json` | `settings:extensions.store.*` 文案 |
| `extensions/store/catalog.json` | 参考 catalog（复制到 folyn-extensions 仓库根） |
