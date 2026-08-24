[简体中文](pet-notify-api.zh.md) | [English](pet-notify-api.en.md) | [日本語](pet-notify-api.ja.md) | [Français](pet-notify-api.fr.md) | [Deutsch](pet-notify-api.de.md) | [Español](pet-notify-api.es.md)

# API de notification externe du Pet

Le pet de bureau Folyn fait tourner un service HTTP **limité à 127.0.0.1** à l'exécution. Les applications externes
(scripts, cron, CI, autres apps de bureau) peuvent déclencher des notifications via celui-ci.

- Port par défaut : `17382`. S'il est occupé, l'app auto-essaie jusqu'à `17400` ; le port réel est affiché dans
  **Paramètres → Pet → API de notification externe**.
- Pas d'auth (localhost uniquement). Limite du corps de requête : 64 Ko.
- Les notifications réutilisent le pipeline interne de l'app, routées selon votre paramètre `forme de notification` (bulle / système / les deux / désactivé).

## Endpoints

### `POST /pet/action`

Le corps est en JSON, distribué via le champ `action`. `notify` est implémenté ; les autres actions renvoient `501`.

#### Champs

| Champ | Requis | Type | Description |
|------|------|------|------|
| `action` | oui | string | Fixé à `notify` ; les autres renvoient `501` |
| `text` | oui | string | Corps de la notification, ≤ 4096 caractères, non vide après trim |
| `kind` | non | string | Type de notification, par défaut `info`. Valeurs : `info` / `reminder` / `message` / `event` |
| `title` | non | string | Titre de la notification ; chaîne vide équivaut à non fourni |
| `source` | non | string | Identifiant de l'appelant, ≤ 128 caractères (ex. `github`, `cron`) |
| `data` | non | object | Objet JSON quelconque, transmis tel quel à l'UI de la bulle |
| `template` | non | string | Id de modèle, ≤ 64 caractères |
| `target` | non | object | Cible de navigation au clic, voir ci-dessous |
| `launch` | non | object | Lancement externe au clic (URL / app macOS), voir ci-dessous |
| `actions` | non | array | Boutons d'action de la bulle, transmis au rendu de la bulle (sanitizé par DOMPurify) |

#### `target` — navigation au clic

```json
{ "kind": "schedule", "id": "path/or/id" }
```

- `kind` : `schedule` / `chat` / `task` / `file`
- `id` : chaîne non vide

#### `launch` — lancement externe

```json
{ "type": "url", "value": "https://ci.example.com/r/1" }
{ "type": "app", "value": "Xcode" }
```

- `type = url` : `value` doit commencer par `http://` ou `https://` ; le clic ouvre dans le navigateur par défaut.
- `type = app` : `value` n'accepte que `[A-Za-z0-9 .\-]`, ni séparateur de chemin ni métacaractère shell ; le clic lance via `open -a`, contrôlé par une liste blanche maintenue par l'utilisateur (une UI d'autorisation apparaît la première fois).
- `value` ≤ 512 caractères.

#### `actions` — boutons de bulle

```json
[
  { "id": "view", "label": "Voir" },
  { "id": "open", "label": "Ouvrir" }
]
```

Le tableau est transmis tel quel, traité par le rendu de la bulle + DOMPurify. Un tableau vide équivaut à non fourni.

### Réponse

| Statut | Signification |
|------|------|
| `200 ok` | `pet://notify` déclenché |
| `400 bad request` | JSON invalide / `text` manquant / `text` vide / `kind` illégal / champ `target` ou `launch` invalide |
| `404 not found` | Chemin inconnu |
| `413 body too large` | body > 64 Ko |
| `501 not implemented` | `action` inconnue (ex. `show` / `hide`, réservé pour extension) |

### `GET /health`

```bash
curl 127.0.0.1:17382/health
# {"ok":true,"port":17382}
```

## Exemples

Notification minimale :

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"reminder","text":"Il est temps de boire de l\'eau"}'
```

Avec une cible de navigation :

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","title":"Réunion","text":"Réunion hebdo 10:00","target":{"kind":"schedule","id":"meet/weekly"}}'
```

Avec données transmises + modèle + identifiant d'appelant :

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"CI échouée","source":"github","template":"glass","data":{"repo":"folyn","runId":42}}'
```

Avec lancement externe (ouvrir les logs en un clic sur échec CI) :

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","kind":"event","text":"build failed","launch":{"type":"url","value":"https://ci.example.com/r/1"}}'
```

Avec boutons d'action de bulle :

```bash
curl -XPOST 127.0.0.1:17382/pet/action \
  -d '{"action":"notify","text":"3 nouveaux messages reçus","actions":[{"id":"view","label":"Voir"},{"id":"dismiss","label":"Ignorer"}]}'
```

## Découverte du port

Utilisez `17382` par défaut. Si ce port est pris (ou pour confirmer le port réel), consultez
la section **API de notification externe** dans **Paramètres → Pet**, ou appelez `GET /health`.
Le port **n'est pas écrit dans un fichier** ; au redémarrage de l'app, il revient au défaut `17382`.

## Contraintes de sécurité

- Le service HTTP se lie uniquement à `127.0.0.1` ; pas d'accès réseau externe.
- Pas d'auth — n'importe quel processus local peut poster. C'est un compromis accepté ; n'activez pas sur une machine partagée / multi-utilisateur.
- `text` / `source` / `template` / `launch.value` ont tous des limites de longueur.
- Le `value` de `launch.type = app` est contrôlé par une liste blanche de caractères + une liste blanche d'applications maintenue par l'utilisateur ; les séparateurs de chemin et métacaractères shell sont rejetés en amont.
- Côté Rust, `open_external` utilise `std::process::Command` avec arguments séparés ; `value` ne peut pas injecter de flag.
