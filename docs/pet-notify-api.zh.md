# Pet External Notify API

Quill 桌宠在运行时会在本机起一个 **仅 127.0.0.1** 的 HTTP 服务，外部应用
（脚本、cron、其他桌面应用）可以通过它触发桌宠通知。

- 默认端口：`17382`。若被占用，app 会自动尝试到 `17400`，实际端口显示在
  **设置 → 桌宠 → 外部通知 API**。
- 无鉴权（仅本机可连）。
- 通知逻辑复用 app 内部链路：按你的 `通知形式` 设置（气泡 / 系统 / 两者 / 关闭）路由。

## 端点

### `POST /pet/action`

请求体为 JSON，通过 `action` 字段分派。目前实现 `notify`，其余 action 返回 `501`。

```jsonc
{
  "action": "notify",          // 必填
  "kind": "info",              // 可选，默认 info。取值: info|reminder|message|event
  "title": "提醒",             // 可选
  "text": "该喝水了",          // 必填，≤ 4096 字符
  "target": {                  // 可选，点击通知后跳转
    "kind": "schedule",        // schedule|chat|task|file
    "id": "path/or/id"
  }
}
```

响应：

| 状态 | 含义 |
|------|------|
| `200 ok` | 已触发 `pet://notify` |
| `400 bad request` | 非法 JSON / 缺 `text` / 非法 `kind` / 非法 target |
| `413 body too large` | body > 64KB |
| `501` | 未知 action（如 `show`/`hide`，预留扩展） |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## 示例

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"该喝水了"}'
```

## 端口发现

默认用 `17382` 即可。若该端口被占（或你想确认实际端口），查看
**设置 → 桌宠** 页面的「外部通知 API」区块，或调用 `GET /health`。
端口**不写入文件**，app 重启后回到默认 `17382`。
