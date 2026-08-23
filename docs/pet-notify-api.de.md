[简体中文](pet-notify-api.zh.md) | [English](pet-notify-api.en.md) | [日本語](pet-notify-api.ja.md) | [Français](pet-notify-api.fr.md) | [Deutsch](pet-notify-api.de.md) | [Español](pet-notify-api.es.md)

# Pet External Notify API

Der Quill-Desktop-Begleiter betreibt zur Laufzeit einen **nur auf 127.0.0.1** lauschenden HTTP-Dienst. Externe Apps
(Skripte, cron, CI, andere Desktop-Apps) können darüber Begleiter-Benachrichtigungen auslösen.

- Standard-Port: `17382`. Ist er belegt, versucht die App automatisch bis `17400`; der tatsächliche Port steht in
  **Einstellungen → Pet → External Notify API**.
- Keine Auth (nur Localhost). Request-Body-Limit: 64KB.
- Benachrichtigungen nutzen die interne Pipeline der App und werden gemäß Ihrer Einstellung `Benachrichtigungsform` (Blase / System / beide / aus) geroutet.

## Endpoints

### `POST /pet/action`

Der Body ist JSON, Dispatch über das Feld `action`. `notify` ist implementiert; andere Aktionen liefern `501`.

#### Felder

| Feld | Pflicht | Typ | Beschreibung |
|------|------|------|------|
| `action` | ja | string | Fest `notify`; andere liefern `501` |
| `text` | ja | string | Benachrichtigungstext, ≤ 4096 Zeichen, nach Trim nicht leer |
| `kind` | nein | string | Benachrichtigungstyp, Standard `info`. Werte: `info` / `reminder` / `message` / `event` |
| `title` | nein | string | Benachrichtigungstitel; leerer String wie nicht angegeben |
| `source` | nein | string | Aufruferkennung, ≤ 128 Zeichen (z. B. `github`, `cron`) |
| `data` | nein | object | Beliebiges JSON-Objekt, ungefiltert an die Blasen-UI durchgereicht |
| `template` | nein | string | Template-ID, ≤ 64 Zeichen |
| `target` | nein | object | Sprungziel beim Klick, siehe unten |
| `launch` | nein | object | Externer Start beim Klick (URL / macOS-App), siehe unten |
| `actions` | nein | array | Blasen-Aktionsbuttons, an den Blasen-Renderer durchgereicht (DOMPurify-gesäubert) |

#### `target` — Klick-Navigation

```json
{ "kind": "schedule", "id": "path/or/id" }
```

- `kind`: `schedule` / `chat` / `task` / `file`
- `id`: nicht-leerer String

#### `launch` — externer Start

```json
{ "type": "url", "value": "https://ci.example.com/r/1" }
{ "type": "app", "value": "Xcode" }
```

- `type = url`: `value` muss mit `http://` oder `https://` beginnen; Klick öffnet im Standardbrowser.
- `type = app`: `value` erlaubt nur `[A-Za-z0-9 .\-]`, keine Pfadtrenner oder Shell-Metazeichen; Klick startet über `open -a`, durch eine vom Nutzer gepflege Whitelist beschränkt (beim ersten Mal erscheint eine Autorisierungs-UI).
- `value` ≤ 512 Zeichen.

#### `actions` — Blasen-Buttons

```json
[
  { "id": "view", "label": "Ansehen" },
  { "id": "open", "label": "Öffnen" }
]
```

Das Array wird unverändert durchgereicht und vom Blasen-Renderer + DOMPurify verarbeitet. Leeres Array entspricht nicht angegeben.

### Antwort

| Status | Bedeutung |
|------|------|
| `200 ok` | `pet://notify` ausgelöst |
| `400 bad request` | Ungültiges JSON / `text` fehlt / `text` leer / `kind` ungültig / `target`- oder `launch`-Feld ungültig |
| `404 not found` | Unbekannter Pfad |
| `413 body too large` | body > 64KB |
| `501 not implemented` | Unbekannte `action` (z. B. `show` / `hide`, reserviert für Erweiterung) |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## Beispiele

Minimale Benachrichtigung:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"Zeit, Wasser zu trinken"}'
```

Mit Navigationsziel:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","title":"Meeting","text":"Wöchentliches Meeting 10:00","target":{"kind":"schedule","id":"meet/weekly"}}'
```

Mit durchgereichten Daten + Template + Aufruferkennung:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"CI fehlgeschlagen","source":"github","template":"glass","data":{"repo":"quill","runId":42}}'
```

Mit externem Start (bei CI-Fehler mit einem Klick das Log öffnen):

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","text":"build failed","launch":{"type":"url","value":"https://ci.example.com/r/1"}}'
```

Mit Blasen-Aktionsbuttons:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"3 neue Nachrichten erhalten","actions":[{"id":"view","label":"Ansehen"},{"id":"dismiss","label":"Ignorieren"}]}'
```

## Port-Entdeckung

Standard `17382` verwenden. Ist der Port belegt (oder um den tatsächlichen Port zu bestätigen), siehe
den Abschnitt **External Notify API** in **Einstellungen → Pet**, oder rufe `GET /health` auf.
Der Port wird **nicht in eine Datei geschrieben**; bei App-Neustart fällt er auf den Standard `17382` zurück.

## Sicherheits-Beschränkungen

- Der HTTP-Dienst bindet nur an `127.0.0.1`; kein externer Netzwerkzugriff.
- Keine Auth — jeder lokale Prozess kann POSTen. Das ist ein akzeptierter Kompromiss; auf geteilten / Mehrbenutzer-Maschinen nicht aktivieren.
- `text` / `source` / `template` / `launch.value` haben alle Zeichenlängen-Deckelungen.
- `launch.type = app`'s `value` wird durch eine Zeichen-Whitelist + eine vom Nutzer gepflegte App-Whitelist doppelt beschränkt; Pfadtrenner und Shell-Metazeichen werden vorab abgelehnt.
- Die Rust-Seite `open_external` nutzt `std::process::Command` mit separierten Argumenten; `value` kann keine Flags injizieren.
