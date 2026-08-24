[简体中文](pet-notify-api.zh.md) | [English](pet-notify-api.en.md) | [日本語](pet-notify-api.ja.md) | [Français](pet-notify-api.fr.md) | [Deutsch](pet-notify-api.de.md) | [Español](pet-notify-api.es.md)

# API de notificación externa del Pet

La mascota de escritorio de Mochi arranca un servicio HTTP **solo en 127.0.0.1** en tiempo de ejecución. Las apps externas
(scripts, cron, CI, otras apps de escritorio) pueden disparar notificaciones de la mascota a través de él.

- Puerto por defecto: `17382`. Si está ocupado, la app intenta automáticamente hasta `17400`; el puerto real se muestra en
  **Ajustes → Pet → External Notify API**.
- Sin auth (solo localhost). Límite del cuerpo de la petición: 64KB.
- Las notificaciones reutilizan el pipeline interno de la app y se enrutan según tu ajuste `forma de notificación` (burbuja / sistema / ambos / apagado).

## Endpoints

### `POST /pet/action`

El cuerpo es JSON, dispatch por el campo `action`. `notify` está implementado; las demás acciones devuelven `501`.

#### Campos

| Campo | Requerido | Tipo | Descripción |
|------|------|------|------|
| `action` | sí | string | Fijo `notify`; los demás devuelven `501` |
| `text` | sí | string | Cuerpo de la notificación, ≤ 4096 caracteres, no vacío tras trim |
| `kind` | no | string | Tipo de notificación, por defecto `info`. Valores: `info` / `reminder` / `message` / `event` |
| `title` | no | string | Título de la notificación; cadena vacía equivale a no proporcionado |
| `source` | no | string | Identificador del llamador, ≤ 128 caracteres (ej. `github`, `cron`) |
| `data` | no | object | Cualquier objeto JSON, se pasa tal cual a la UI de la burbuja |
| `template` | no | string | Id de plantilla, ≤ 64 caracteres |
| `target` | no | object | Destino de navegación al hacer clic, ver abajo |
| `launch` | no | object | Lanzamiento externo al hacer clic (URL / app de macOS), ver abajo |
| `actions` | no | array | Botones de acción de la burbuja, pasados al renderizador de la burbuja (sanitizado por DOMPurify) |

#### `target` — navegación al hacer clic

```json
{ "kind": "schedule", "id": "path/or/id" }
```

- `kind`: `schedule` / `chat` / `task` / `file`
- `id`: cadena no vacía

#### `launch` — lanzamiento externo

```json
{ "type": "url", "value": "https://ci.example.com/r/1" }
{ "type": "app", "value": "Xcode" }
```

- `type = url`: `value` debe empezar con `http://` o `https://`; el clic abre en el navegador por defecto.
- `type = app`: `value` solo permite `[A-Za-z0-9 .\-]`, sin separadores de ruta ni metacaracteres de shell; el clic lanza vía `open -a`, restringido por una whitelist mantenida por el usuario (la primera vez aparece una UI de autorización).
- `value` ≤ 512 caracteres.

#### `actions` — botones de la burbuja

```json
[
  { "id": "view", "label": "Ver" },
  { "id": "open", "label": "Abrir" }
]
```

El array se pasa tal cual, procesado por el renderizador de la burbuja + DOMPurify. Array vacío equivale a no proporcionado.

### Respuesta

| Estado | Significado |
|------|------|
| `200 ok` | `pet://notify` disparado |
| `400 bad request` | JSON inválido / falta `text` / `text` vacío / `kind` ilegal / campo `target` o `launch` inválido |
| `404 not found` | Ruta desconocida |
| `413 body too large` | body > 64KB |
| `501 not implemented` | `action` desconocido (ej. `show` / `hide`, reservado para extensión) |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## Ejemplos

Notificación mínima:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"Es hora de beber agua"}'
```

Con destino de navegación:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","title":"Reunión","text":"Reunión semanal 10:00","target":{"kind":"schedule","id":"meet/weekly"}}'
```

Con datos pasados + plantilla + identificador del llamador:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"CI falló","source":"github","template":"glass","data":{"repo":"mochi","runId":42}}'
```

Con lanzamiento externo (abrir el log con un clic ante fallo de CI):

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","text":"build failed","launch":{"type":"url","value":"https://ci.example.com/r/1"}}'
```

Con botones de acción de la burbuja:

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"3 mensajes nuevos recibidos","actions":[{"id":"view","label":"Ver"},{"id":"dismiss","label":"Ignorar"}]}'
```

## Descubrimiento del puerto

Usa `17382` por defecto. Si ese puerto está ocupado (o para confirmar el puerto real), consulta
la sección **External Notify API** en **Ajustes → Pet**, o llama a `GET /health`.
El puerto **no se escribe en un archivo**; al reiniciar la app vuelve al `17382` por defecto.

## Restricciones de seguridad

- El servicio HTTP solo se liga a `127.0.0.1`; sin acceso de red externo.
- Sin auth — cualquier proceso local puede hacer POST. Es un compromiso aceptado; no lo habilites en máquinas compartidas / multiusuario.
- `text` / `source` / `template` / `launch.value` tienen todos un límite de longitud.
- El `value` de `launch.type = app` está controlado por una whitelist de caracteres + una whitelist de apps mantenida por el usuario; los separadores de ruta y metacaracteres de shell se rechazan por adelantado.
- El lado Rust `open_external` usa `std::process::Command` con argumentos separados; `value` no puede inyectar flags.
