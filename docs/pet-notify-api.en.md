[简体中文](pet-notify-api.zh.md) | [English](pet-notify-api.en.md) | [日本語](pet-notify-api.ja.md) | [Français](pet-notify-api.fr.md) | [Deutsch](pet-notify-api.de.md) | [Español](pet-notify-api.es.md)

# Pet External Notify API

The Quill desktop pet runs a **127.0.0.1-only** HTTP service at runtime. External apps
(scripts, cron, CI, other desktop apps) can trigger pet notifications through it.

- Default port: `17382`. If occupied, the app auto-tries up to `17400`; the actual port is shown in
  **Settings → Pet → External Notify API**.
- No auth (localhost only). Request body limit: 64KB.
- Notifications reuse the app's internal pipeline, routed according to your `notification form` setting (bubble / system / both / off).

## Endpoints

### `POST /pet/action`

The body is JSON, dispatched via the `action` field. `notify` is implemented; other actions return `501`.

#### Fields

| Field | Required | Type | Description |
|------|------|------|------|
| `action` | yes | string | Fixed `notify`; others return `501` |
| `text` | yes | string | Notification body, ≤ 4096 chars, must be non-empty after trim |
| `kind` | no | string | Notification type, default `info`. Values: `info` / `reminder` / `message` / `event` |
| `title` | no | string | Notification title; empty string equals not provided |
| `source` | no | string | Caller identifier, ≤ 128 chars (e.g. `github`, `cron`) |
| `data` | no | object | Any JSON object, passed through to the bubble UI |
| `template` | no | string | Template id, ≤ 64 chars |
| `target` | no | object | Jump target on click, see below |
| `launch` | no | object | External launch on click (URL / macOS app), see below |
| `actions` | no | array | Bubble action buttons, passed through to the bubble renderer (DOMPurify-sanitized) |

#### `target` — click to navigate

```json
{ "kind": "schedule", "id": "path/or/id" }
```

- `kind`: `schedule` / `chat` / `task` / `file`
- `id`: non-empty string

#### `launch` — external launch

```json
{ "type": "url", "value": "https://ci.example.com/r/1" }
{ "type": "app", "value": "Xcode" }
```

- `type = url`: `value` must start with `http://` or `https://`; click opens in the default browser.
- `type = app`: `value` allows only `[A-Za-z0-9 .\-]`, no path separators or shell metacharacters; click launches via `open -a`, gated by a user-maintained whitelist (an authorization UI appears the first time).
- `value` ≤ 512 chars.

#### `actions` — bubble buttons

```json
[
  { "id": "view", "label": "View" },
  { "id": "open", "label": "Open" }
]
```

The array is passed through, processed by the bubble renderer + DOMPurify. Empty array equals not provided.

### Response

| Status | Meaning |
|------|------|
| `200 ok` | `pet://notify` triggered |
| `400 bad request` | Invalid JSON / missing `text` / empty `text` / illegal `kind` / invalid `target` or `launch` field |
| `404 not found` | Unknown path |
| `413 body too large` | body > 64KB |
| `501 not implemented` | Unknown `action` (e.g. `show` / `hide`, reserved for extension) |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## Examples

Minimal notification:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"Time to drink water"}'
```

With a navigation target:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","title":"Meeting","text":"Weekly meeting 10:00","target":{"kind":"schedule","id":"meet/weekly"}}'
```

With passthrough data + template + caller identifier:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"CI failed","source":"github","template":"glass","data":{"repo":"quill","runId":42}}'
```

With external launch (one-click open the log on CI failure):

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","text":"build failed","launch":{"type":"url","value":"https://ci.example.com/r/1"}}'
```

With bubble action buttons:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"3 new messages received","actions":[{"id":"view","label":"View"},{"id":"dismiss","label":"Dismiss"}]}'
```

## Port discovery

Default to `17382`. If that port is taken (or to confirm the actual port), see
the **External Notify API** section in **Settings → Pet**, or call `GET /health`.
The port is **not written to a file**; on app restart it returns to the default `17382`.

## Security constraints

- The HTTP service binds only to `127.0.0.1`; no external network access.
- No auth — any local process can POST. This is an accepted trade-off; do not enable on shared / multi-user machines.
- `text` / `source` / `template` / `launch.value` all have character-length caps.
- `launch.type = app`'s `value` is gated by a character whitelist + a user-maintained app whitelist; path separators and shell metacharacters are rejected up front.
- The Rust-side `open_external` uses `std::process::Command` with separated arguments; `value` cannot inject flags.
