[简体中文](pet-notify-api.zh.md) | [English](pet-notify-api.en.md) | [日本語](pet-notify-api.ja.md) | [Français](pet-notify-api.fr.md) | [Deutsch](pet-notify-api.de.md) | [Español](pet-notify-api.es.md)

# Pet External Notify API

Quill デスクトップペットは実行時、**127.0.0.1 のみ**の HTTP サービスを起動します。外部アプリ
（スクリプト・cron・CI・他のデスクトップアプリ）はここからペット通知をトリガーできます。

- デフォルトポート：`17382`。占有されている場合、アプリは自動的に `17400` まで試行し、実際のポートは
  **設定 → デスクトップペット → 外部通知 API** に表示されます。
- 認証なし（ローカルホストのみ）。リクエストボディ上限 64KB。
- 通知ロジックはアプリ内内部リンクを再利用し、あなたの `通知形式` 設定（バブル／システム／両方／オフ）に従ってルーティングします。

## エンドポイント

### `POST /pet/action`

ボディは JSON で、`action` フィールドでディスパッチします。現在 `notify` を実装、それ以外は `501` を返します。

#### フィールド

| フィールド | 必須 | 型 | 説明 |
|------|------|------|------|
| `action` | はい | string | 固定 `notify`、それ以外は `501` |
| `text` | はい | string | 通知本文、≤ 4096 文字、trim 後空不可 |
| `kind` | いいえ | string | 通知タイプ、デフォルト `info`。値：`info` / `reminder` / `message` / `event` |
| `title` | いいえ | string | 通知タイトル、空文字列は未指定と同等 |
| `source` | いいえ | string | 呼び出し元識別子、≤ 128 文字（例：`github`、`cron`） |
| `data` | いいえ | object | 任意の JSON オブジェクト、バブル UI にそのまま透過 |
| `template` | いいえ | string | テンプレート id、≤ 64 文字 |
| `target` | いいえ | object | クリック時のジャンプ先、下記参照 |
| `launch` | いいえ | object | クリック時の外部起動（URL／macOS アプリ）、下記参照 |
| `actions` | いいえ | array | バブル操作ボタン配列、バブルレンダラーに透過（DOMPurify で浄化） |

#### `target` — クリックでジャンプ

```json
{ "kind": "schedule", "id": "path/or/id" }
```

- `kind`：`schedule` / `chat` / `task` / `file`
- `id`：空でない文字列

#### `launch` — 外部起動

```json
{ "type": "url", "value": "https://ci.example.com/r/1" }
{ "type": "app", "value": "Xcode" }
```

- `type = url`：`value` は `http://` または `https://` で始まる必要があります。クリックでデフォルトブラウザに開きます。
- `type = app`：`value` は `[A-Za-z0-9 .\-]` のみ許可、パス区切り文字とシェルメタ文字は禁止。クリックで `open -a` で起動し、ユーザー管理のホワイトリストで制限されます（初回は認可 UI が出ます）。
- `value` ≤ 512 文字。

#### `actions` — バブルボタン

```json
[
  { "id": "view", "label": "表示" },
  { "id": "open", "label": "開く" }
]
```

配列はそのまま透過し、バブルレンダラー + DOMPurify で処理されます。空配列は未指定と同等。

### レスポンス

| ステータス | 意味 |
|------|------|
| `200 ok` | `pet://notify` をトリガー済み |
| `400 bad request` | 不正 JSON／`text` 欠落／`text` が空／`kind` 不正／`target` または `launch` フィールド不正 |
| `404 not found` | 未知のパス |
| `413 body too large` | body > 64KB |
| `501 not implemented` | 未知の `action`（例：`show` / `hide`、拡張予約） |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## 例

最小通知：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"水分補給の時間です"}'
```

ジャンプ先あり：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","title":"会議","text":"定例会議 10:00","target":{"kind":"schedule","id":"meet/weekly"}}'
```

透過データ + テンプレート + 呼び出し元識別子あり：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"CI 失敗","source":"github","template":"glass","data":{"repo":"quill","runId":42}}'
```

外部起動あり（CI 失敗時にログをワンクリックで開く）：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","text":"build failed","launch":{"type":"url","value":"https://ci.example.com/r/1"}}'
```

バブル操作ボタンあり：

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"新着メッセージ 3 件","actions":[{"id":"view","label":"表示"},{"id":"dismiss","label":"無視"}]}'
```

## ポート発見

デフォルトは `17382` を使えば OK です。そのポートが占有されている場合（または実際のポートを確認したい場合）、
**設定 → デスクトップペット** の「外部通知 API」セクションを参照するか、`GET /health` を呼び出してください。
ポートは**ファイルに書き込まれず**、アプリ再起動でデフォルト `17382` に戻ります。

## セキュリティ制約

- HTTP サービスは `127.0.0.1` にのみバインドし、外部ネットワークからのアクセスは受け付けません。
- 認証なし — ローカルの任意のプロセスが POST 可能。これはユーザーが受け入れたトレードオフです。共有／マルチユーザーマシンでは有効にしないでください。
- `text` / `source` / `template` / `launch.value` はすべて文字数上限を持ちます。
- `launch.type = app` の `value` は文字ホワイトリスト + ユーザー管理のアプリホワイトリストの二重制約。パス区切り文字とシェルメタ文字は事前に拒否されます。
- Rust 側の `open_external` は `std::process::Command` で引数を分離し、`value` はフラグを注入できません。
