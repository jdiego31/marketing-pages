# n8n Workflow Setup — `partnerfunding` automation

End-to-end automation for generating partner landing pages from a Slack form.

## Stack y restricciones

- **n8n cloud** (sin shell access) — todo via HTTP nodes + Code nodes
- **GitHub**: source of truth + audit log de cada partner generado
- **Vercel API**: deploy directo via `POST /v13/deployments` (sin git auto-deploy en Vercel)
- **Slack**: entry point (form) + response (DM/thread)

## Credentials necesarias en n8n

| Credencial | Tipo en n8n | Scope / Permisos | Para qué |
|---|---|---|---|
| `github_pat` | HTTP Header Auth (`Authorization: Bearer <PAT>`) | `repo` (full) | Leer template, hacer commits del partner |
| `vercel_token` | HTTP Header Auth (`Authorization: Bearer <token>`) | Full access al team `lendflow` | Triggear deploys |
| `slack_oauth` | Slack OAuth2 | `chat:write`, `files:read` (para descargar archivos), `users:read` | Bajar el logo/hero del form + responder al solicitante |

### Crear los tokens

**GitHub PAT** (usar la cuenta `jdiego31`):
1. `https://github.com/settings/tokens` → "Generate new token (classic)"
2. Scopes: solo `repo`
3. Sin expiración o 1 año
4. Copiar el token (`ghp_...`)
5. En n8n: Credentials → New → "HTTP Header Auth" → Name: `Authorization`, Value: `Bearer ghp_...`

**Vercel token:**
1. `https://vercel.com/account/tokens` (scope: `lendflow`)
2. "Create Token" → Full Access → no expiration o 1 año
3. Copiar (`v...`)
4. En n8n: Credentials → New → "HTTP Header Auth" → Name: `Authorization`, Value: `Bearer v...`

**Slack OAuth** se configura desde n8n directamente (Credentials → New → Slack OAuth2 → seguir el flow).

## Identificadores del proyecto Vercel

Hardcoded en el workflow (no son secrets):

| | Valor |
|---|---|
| Project ID | `prj_KFGLlB9oaQgyXV6oRAUjWeAkdqmt` |
| Team ID | `team_HqA3bL7kkzPosLZDmtUYohZS` |
| GitHub repo | `jdiego31/marketing-pages` |
| Production alias | `partnerfunding.vercel.app` |

## Cómo importar el workflow

1. En n8n: Workflows → "+" → "Import from File" (o "Import from URL")
2. Seleccionar `workflow.json`
3. Después de importar, n8n va a pedir vincular credenciales:
   - HTTP nodes que llaman a GitHub → asignar `github_pat`
   - HTTP nodes que llaman a Vercel → asignar `vercel_token`
   - Slack nodes → asignar `slack_oauth`
4. Activar el workflow (toggle "Active" arriba a la derecha)
5. Copiar la **Webhook URL** del primer node — eso es lo que el Slack Workflow form va a golpear

## Arquitectura del workflow (13 nodes)

```
Webhook
  ↓
Code: validate + UTM + slug          ← lib/validate.js
  ↓
HTTP GET: check slug en GitHub
  ↓
IF: mode vs existence
  ├─ create+exists  → Slack error → END
  ├─ update+missing → Slack error → END
  └─ ok → continue
  ↓
HTTP GET: download logo from Slack  (skip si no hay)
HTTP GET: download hero from Slack  (skip si no hay)
HTTP GET: read template/index.html  (GitHub Contents API)
  ↓
Code: process template               ← lib/process.js
  ↓
HTTP PUT: <slug>/index.html  (GitHub Contents API, con sha si update)
HTTP PUT: <slug>/styles.css
HTTP PUT: <slug>/logo.<ext>  (skip si no hay)
HTTP PUT: <slug>/hero.<ext>  (skip si no hay)
  ↓
HTTP GET: zipball/main  (GitHub)
  ↓
n8n Compression node: extract ZIP
  ↓
Code: build files array (filter excluded, base64 encode)
  ↓
HTTP POST: /v13/deployments  (Vercel)
  ↓
HTTP GET: deployment status (loop hasta READY o timeout)
  ↓
HTTP GET: health check de partnerfunding.vercel.app/<slug>/
  ↓
Slack: DM al solicitante con la URL final
```

## Slack Workflow form — campos

Configurá el Slack Workflow form con estos fields. El form los manda al webhook URL como JSON.

| Campo | Tipo | Required |
|---|---|---|
| `mode` | Radio | ✓ (`create` o `update`) |
| `slug` | Text | Solo si `mode=update` |
| `partner_name` | Text | ✓ |
| `color_primary` | Text (hex) | ✓ |
| `color_secondary` | Text (hex) | ✓ |
| `widget_url` | URL | ✓ |
| `logo` | File upload (PNG/SVG/JPG, ≤2MB) | — |
| `hero_image` | File upload (JPG/PNG, ≤2MB) | — |
| `embed_widget` | Checkbox | — |
| `cobrand` | Checkbox | — |
| `utm_source` | Text | — |
| `utm_medium` | Text | — |
| `utm_campaign` | Text | — |

El Slack Workflow form **no expone directamente file URLs** — necesita un primer step "Send a webhook" cuyo body incluya los `files[0].url_private_download` de los uploads. Ver `slack-form-template.md` en este folder para el detalle.

## Testing el workflow

**Test 1: validation sola (paso 1-2)**
- Pegar un payload de prueba en el Webhook node con datos válidos
- Verificar que el Code "validate" devuelve el JSON normalizado

**Test 2: dry run sin Vercel deploy**
- Comentar (deshabilitar) el HTTP POST a Vercel
- Correr con un partner ficticio (`mode=create`, `slug` único)
- Verificar que GitHub recibe los commits

**Test 3: end-to-end con partner `_test`**
- Habilitar todo
- Mandar un payload real desde el Slack form (o curl directo al webhook)
- Verificar:
  - GitHub muestra `_test/index.html`, `styles.css`, etc.
  - `partnerfunding.vercel.app/_test/` carga
  - Slack recibe DM con el link

## Errores comunes

| Error | Causa probable | Fix |
|---|---|---|
| `401 Unauthorized` en GitHub HTTP | PAT mal copiado o expirado | Regenerar en `github.com/settings/tokens` |
| `403 Forbidden` en Vercel POST | Token sin scope `lendflow` | Recrear token con el team correcto |
| `422 sha mismatch` en GitHub PUT (update mode) | Race: alguien commiteó entre tu GET y PUT | Re-correr el workflow |
| Deploy queda en `BUILDING` >90s | Bug en files (algún path raro) | Ver logs de Vercel via `vercel inspect <id>` |
| Slack no recibe DM | OAuth scope incompleto | Reauthorizar Slack OAuth con `chat:write` y `im:write` |
