# Pet External Notify API

Quill 桌宠在运行时会在本机起一个 **仅 127.0.0.1** 的 HTTP 服务，外部应用
（脚本、cron、CI、其他桌面应用）可以通过它触发桌宠通知。

- 默认端口：`17382`。若被占用，app 会自动尝试到 `17400`，实际端口显示在
  **设置 → 桌宠 → 外部通知 API**。
- 无鉴权（仅本机可连）。请求体上限 64KB。
- 通知逻辑复用 app 内部链路：按你的 `通知形式` 设置（气泡 / 系统 / 两者 / 关闭）路由。

## 端点

### `POST /pet/action`

请求体为 JSON，通过 `action` 字段分派。目前实现 `notify`，其余 action 返回 `501`。

#### 字段

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `action` | 是 | string | 固定 `notify`，其它返回 `501` |
| `text` | 是 | string | 通知正文，≤ 4096 字符，trim 后不能为空 |
| `kind` | 否 | string | 通知类型，默认 `info`。取值：`info` / `reminder` / `message` / `event` |
| `title` | 否 | string | 通知标题，空字符串等同未提供 |
| `source` | 否 | string | 调用方标识，≤ 128 字符（如 `github`、`cron`） |
| `data` | 否 | object | 任意 JSON 对象，原样透传给气泡 UI |
| `template` | 否 | string | 模板 id，≤ 64 字符 |
| `target` | 否 | object | 点击通知后跳转目标，见下 |
| `launch` | 否 | object | 点击后外部启动（URL / macOS 应用），见下 |
| `actions` | 否 | array | 气泡操作按钮数组，透传给气泡渲染器（DOMPurify 净化） |

#### `target` — 点击跳转

```json
{ "kind": "schedule", "id": "path/or/id" }
```

- `kind`：`schedule` / `chat` / `task` / `file`
- `id`：非空字符串

#### `launch` — 外部启动

```json
{ "type": "url", "value": "https://ci.example.com/r/1" }
{ "type": "app", "value": "Xcode" }
```

- `type = url`：`value` 必须以 `http://` 或 `https://` 开头；点击在默认浏览器打开。
- `type = app`：`value` 仅允许 `[A-Za-z0-9 .\-]`，禁路径分隔符与 shell 元字符；点击通过 `open -a` 启动，受用户维护的白名单约束（首次会弹出授权 UI）。
- `value` ≤ 512 字符。

#### `actions` — 气泡按钮

```json
[
  { "id": "view", "label": "查看" },
  { "id": "open", "label": "打开" }
]
```

数组原样透传，由气泡渲染器 + DOMPurify 处理。空数组等同未提供。

### 响应

| 状态 | 含义 |
|------|------|
| `200 ok` | 已触发 `pet://notify` |
| `400 bad request` | 非法 JSON / 缺 `text` / `text` 为空 / `kind` 非法 / `target` 或 `launch` 字段不合法 |
| `404 not found` | 未知路径 |
| `413 body too large` | body > 64KB |
| `501 not implemented` | 未知 `action`（如 `show` / `hide`，预留扩展） |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## 示例

最小通知：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"该喝水了"}'
```

带跳转目标：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","title":"会议","text":"周会 10:00","target":{"kind":"schedule","id":"meet/weekly"}}'
```

带透传数据 + 模板 + 调用方标识：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"CI 失败","source":"github","template":"glass","data":{"repo":"quill","runId":42}}'
```

带外部启动（CI 报错时一键打开日志）：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","text":"build failed","launch":{"type":"url","value":"https://ci.example.com/r/1"}}'
```

带气泡操作按钮：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"收到 3 条新消息","actions":[{"id":"view","label":"查看"},{"id":"dismiss","label":"忽略"}]}'
```

## 端口发现

默认用 `17382` 即可。若该端口被占（或你想确认实际端口），查看
**设置 → 桌宠** 页面的「外部通知 API」区块，或调用 `GET /health`。
端口**不写入文件**，app 重启后回到默认 `17382`。

## 安全约束

- HTTP 服务仅绑定 `127.0.0.1`，不接受外部网络访问。
- 无鉴权 — 任何本机进程均可 POST。这是用户接受的折衷；不要在共享 / 多用户机器上启用。
- `text` / `source` / `template` / `launch.value` 都有字符长度上限。
- `launch.type = app` 的 `value` 字符白名单 + 用户维护的 app 白名单双重约束，路径分隔符与 shell 元字符会被提前拒绝。
- Rust 端 `open_external` 使用 `std::process::Command` 分离参数，`value` 无法注入 flag。
