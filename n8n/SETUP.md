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

### Quickstart: test sin Slack (con `test-form.html`)

Hasta que tengás Slack OAuth configurado, podés probar el workflow completo usando el HTML form local:

1. **Setup mínimo en n8n:**
   - Crear credentials `github_pat` y `vercel_token` (Slack no hace falta — los nodes de Slack vienen pre-desactivados en `workflow.json`)
   - Import `workflow.json`
   - Bindear credenciales en los HTTP nodes que las usan
   - Activar el workflow (toggle "Active")
   - Copiar la **Production Webhook URL** del Webhook node

2. **Abrir el test form:**
   ```bash
   open n8n/test-form.html
   ```
   (o doble click desde Finder)

3. **Pegar el webhook URL en el primer campo** (se guarda en localStorage)

4. **Llenar el form y submit:**
   - `mode=create`, `partner_name=Test Partner`, colores, widget_url, etc.
   - Logo y hero: dejar en blanco para testear el fallback (texto + default global)

5. **Ver la respuesta:**
   - Success → JSON con `{ status, slug, url, vercel_deployment_id, ... }`
   - Error → JSON con `{ status: "error", message, ... }`
   - Loading takes ~25-35s (zipball download + Vercel deploy + 15s wait + health check)

6. **Verificar manualmente:**
   - GitHub: `https://github.com/jdiego31/marketing-pages` muestra el commit nuevo
   - Vercel: `https://partnerfunding.vercel.app/<slug>/` carga el partner

### Cuando llegue Slack (mañana)

1. Crear la credential Slack OAuth en n8n
2. Bindear en los nodes `Slack Success` y `Slack Error`
3. **Habilitar los dos Slack nodes** (en el JSON están `"disabled": true` — toggle desde la UI o quitar el flag)
4. Setup el Slack Workflow form con los campos de la sección anterior, apuntar submit al webhook URL
5. Eliminar `test-form.html` o dejarlo como herramienta de debug

### Test progresivo (si rompe algo)

| Test | Cómo |
|---|---|
| Validation solo | Pegar payload en Webhook node "Listen for Test Event" → ver output de `Validate` |
| GitHub commit sin deploy | Desactivar `Deploy to Vercel` y nodes posteriores → correr → ver el commit en GitHub |
| Full E2E | `test-form.html` con datos reales |

## Errores comunes

| Error | Causa probable | Fix |
|---|---|---|
| `401 Unauthorized` en GitHub HTTP | PAT mal copiado o expirado | Regenerar en `github.com/settings/tokens` |
| `403 Forbidden` en Vercel POST | Token sin scope `lendflow` | Recrear token con el team correcto |
| `422 sha mismatch` en GitHub PUT (update mode) | Race: alguien commiteó entre tu GET y PUT | Re-correr el workflow |
| Deploy queda en `BUILDING` >90s | Bug en files (algún path raro) | Ver logs de Vercel via `vercel inspect <id>` |
| Slack no recibe DM | OAuth scope incompleto | Reauthorizar Slack OAuth con `chat:write` y `im:write` |
