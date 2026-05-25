# Marketing Pages

Landing pages personalizadas por partner para Lendflow. Cada partner recibe una página con su logo, dos colores corporativos y un widget embebido.

- **Hosting:** Vercel (cuenta `jdiego31`, proyecto en el scope `lendflow`)
- **Repo:** [`jdiego31/marketing-pages`](https://github.com/jdiego31/marketing-pages)
- **URL pattern:** `<project>.vercel.app/<slug>`

Auto-deploy: cada push a `main` dispara un deploy en Vercel (~30–60 s).

## Estructura

```
marketing-pages/
├── template/             # NO se publica (excluido vía .vercelignore)
│   ├── index.html        # Maestro con placeholders {{VAR}}
│   └── styles.css
├── _assets/              # Assets compartidos entre partners
│   └── hero-default.jpg  # Foto default del hero (florista, small business)
├── <slug>/               # Una carpeta por partner, en la raíz
│   ├── index.html
│   ├── styles.css
│   ├── logo.(svg|png)
│   └── hero.(jpg|png)    # opcional — override del hero-default.jpg
├── vercel.json           # cleanUrls: true
└── .vercelignore         # excluye template/ y PLAN.md
```

Los partners viven en la raíz (no bajo `partners/`) para que `cleanUrls` baste y no haga falta configurar rewrites en `vercel.json`. Ejemplo: la carpeta `example/` se sirve en `<project>.vercel.app/example`.

## Placeholders del template

El template usa estos placeholders, que se reemplazan al generar cada partner:

**Requeridos (input directo de marketing):**

| Placeholder | Qué es | Ejemplo |
|---|---|---|
| `{{PARTNER_NAME}}` | Nombre visible del partner | `Acme Co` |
| `{{LOGO_PATH}}` | Ruta relativa al logo | `./logo.png` |
| `{{COLOR_PRIMARY}}` | Color principal hex | `#1f4ed8` |
| `{{COLOR_SECONDARY}}` | Color secundario hex | `#0ea5e9` |
| `{{WIDGET_URL}}` | URL del widget de Lendflow | `https://iw.lendflow.com/?env=...` |

**Opcional (con fallback al default global):**

| Placeholder | Qué es | Con `hero_image` upload | Sin upload (default) |
|---|---|---|---|
| `{{HERO_IMAGE_PATH}}` | Foto del hero (split 60/40 a la derecha) | `./hero.<ext>` (relativo al partner) | `/_assets/hero-default.jpg` |

**Derivados por n8n a partir del flag `embed_widget`:**

| Placeholder | Si `embed_widget=false` (default — link mode) | Si `embed_widget=true` (embed mode) |
|---|---|---|
| `{{CTA_HREF}}` | `{{WIDGET_URL}}` | `#apply` |

Los CTAs son `<a>` normales sin `target="_blank"`: el script `lendflow-loader.js` (incluido en modo link) intercepta el click y abre el widget on-page como overlay. Mismo dominio, sin pestañas nuevas.

**Bloques condicionales** (n8n conserva el contenido o borra el bloque entero según el flag):

- `<!--IF:embed-->...<!--/IF:embed-->` — sección con iframe embebido. Activa cuando `embed_widget=true`.
- `<!--IF:loader-->...<!--/IF:loader-->` — `<script src="https://iw.lendflow.com/js/lendflow-loader.js">`. Activa cuando `embed_widget=false` (es decir, en modo link).
- `<!--IF:cobrand-->...<!--/IF:cobrand-->` — línea "Funding powered by Lendflow" en el footer. Activa cuando `cobrand=true`.

`IF:embed` e `IF:loader` son mutuamente exclusivos — el flag `embed_widget` controla ambos en sentido opuesto.

## Inputs del Slack form

| Campo | Tipo | Default |
|---|---|---|
| `partner_name` | text | — |
| `logo` | file | — |
| `color_primary` | hex | — |
| `color_secondary` | hex | — |
| `widget_url` | url | — |
| `hero_image` | file (optional) | `null` → usa `/_assets/hero-default.jpg` |
| `embed_widget` | checkbox | `false` (CTA dispara el widget on-page vía `lendflow-loader.js`) |
| `cobrand` | checkbox | `false` (sin línea "Funding powered by Lendflow") |

## Cómo agregar un partner (manual, hoy)

1. Copiar `template/` a una carpeta nueva en la raíz con el slug del partner (lowercase, guiones en vez de espacios — ej. `acme-co`).
2. En `index.html`, reemplazar los placeholders requeridos.
3. Definir `{{CTA_HREF}}` según si querés link o embed (ver tabla arriba).
4. Para cada bloque `<!--IF:flag-->...<!--/IF:flag-->`: si el flag aplica, borrá solo los marcadores; si no, borrá el bloque entero. Recordá que `IF:embed` e `IF:loader` van inversos.
5. Agregar el archivo del logo en la misma carpeta (mismo nombre que `{{LOGO_PATH}}`).
6. Definir `{{HERO_IMAGE_PATH}}`: si el partner tiene foto propia, subila a la misma carpeta y usá `./hero.<ext>`. Si no, usá `/_assets/hero-default.jpg`.
7. Commit + push a `main`. Vercel despliega solo.
8. Verificar en `<project>.vercel.app/<slug>`.

Mirá `example/` como referencia funcional (modo default: link, sin cobrand).

## Cómo se va a agregar un partner (automatizado, próximamente)

El flujo end-to-end:

```
Slack Workflow form → n8n → commit a este repo → Vercel deploy → Slack notifica al solicitante
```

Detalles en [`PLAN.md`](./PLAN.md). Fase actual: **1 (pipeline base manual)**.

## Restricciones

- No usar `lendflow.com` como dominio del proyecto (request del equipo de marca).
- La cuenta de Vercel es `jdiego31` (personal, no SSO) — intencional, para evitar dependencias de DevOps.
