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
├── <slug>/               # Una carpeta por partner, en la raíz
│   ├── index.html
│   ├── styles.css
│   └── logo.(svg|png)
├── vercel.json           # cleanUrls: true
└── .vercelignore         # excluye template/ y PLAN.md
```

Los partners viven en la raíz (no bajo `partners/`) para que `cleanUrls` baste y no haga falta configurar rewrites en `vercel.json`. Ejemplo: la carpeta `example/` se sirve en `<project>.vercel.app/example`.

## Placeholders del template

El template usa estos placeholders, que se reemplazan al generar cada partner:

| Placeholder | Qué es | Ejemplo |
|---|---|---|
| `{{PARTNER_NAME}}` | Nombre visible del partner | `Acme Co` |
| `{{LOGO_PATH}}` | Ruta relativa al logo | `./logo.png` |
| `{{COLOR_PRIMARY}}` | Color principal hex | `#1f4ed8` |
| `{{COLOR_SECONDARY}}` | Color secundario hex | `#0ea5e9` |
| `{{WIDGET_URL}}` | URL del widget de Lendflow | `https://...` |

## Cómo agregar un partner (manual, hoy)

1. Copiar `template/` a una carpeta nueva en la raíz con el slug del partner (lowercase, guiones en vez de espacios — ej. `acme-co`).
2. Reemplazar los placeholders en `index.html`.
3. Agregar el archivo del logo en la misma carpeta (mismo nombre que `{{LOGO_PATH}}`).
4. Commit + push a `main`. Vercel despliega solo.
5. Verificar en `<project>.vercel.app/<slug>`.

Mirá `example/` como referencia funcional.

## Cómo se va a agregar un partner (automatizado, próximamente)

El flujo end-to-end:

```
Slack Workflow form → n8n → commit a este repo → Vercel deploy → Slack notifica al solicitante
```

Detalles en [`PLAN.md`](./PLAN.md). Fase actual: **1 (pipeline base manual)**.

## Restricciones

- No usar `lendflow.com` como dominio del proyecto (request del equipo de marca).
- La cuenta de Vercel es `jdiego31` (personal, no SSO) — intencional, para evitar dependencias de DevOps.
