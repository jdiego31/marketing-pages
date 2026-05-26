/**
 * n8n Code node — Process template
 *
 * Inputs:
 *   - $input.first().json — output from validate.js (slug, partner_name, colors, paths, flags...)
 *   - $('Read Template').first().json.content — base64 of template/index.html from GitHub Contents API
 *
 * Output:
 *   - processed_html (string) — final HTML with placeholders replaced and IF blocks resolved
 *   - All upstream fields passed through for downstream nodes
 */

const data = $input.first().json;
const templateB64 = $('Read Template').first().json.content;

// Decode base64 (GitHub Contents API returns base64-encoded content with newlines)
let html = Buffer.from(templateB64, 'base64').toString('utf-8');

// ---------- Placeholder replacement ----------
const replacements = {
  PARTNER_NAME: data.partner_name,
  LOGO_PATH: data.logo_path || '',
  COLOR_PRIMARY: data.color_primary,
  COLOR_SECONDARY: data.color_secondary,
  WIDGET_URL: data.widget_url,
  HERO_IMAGE_PATH: data.hero_image_path,
  CTA_HREF: data.cta_href,
};

for (const [key, value] of Object.entries(replacements)) {
  // Use split/join to avoid regex escaping issues with values
  html = html.split(`{{${key}}}`).join(value);
}

// ---------- Conditional blocks (<!--IF:flag-->...<!--/IF:flag-->) ----------
//
// Rules:
//   - flag = true  → strip markers, keep content
//   - flag = false → remove entire block (markers + content)
function processIfBlock(html, flag, keep) {
  const start = `<!--IF:${flag}-->`;
  const end = `<!--/IF:${flag}-->`;
  if (keep) {
    // Remove markers only
    return html.split(start).join('').split(end).join('');
  } else {
    // Remove entire block. Non-greedy regex so nested blocks of OTHER flags aren't swallowed.
    const re = new RegExp(`<!--IF:${flag}-->[\\s\\S]*?<!--/IF:${flag}-->`, 'g');
    return html.replace(re, '');
  }
}

const flags = {
  logo: data.has_logo,
  nologo: !data.has_logo,
  embed: data.embed_widget,
  loader: !data.embed_widget,
  cobrand: data.cobrand,
};

for (const [flag, keep] of Object.entries(flags)) {
  html = processIfBlock(html, flag, keep);
}

// ---------- Output ----------
// Pre-encode HTML as base64 here — Buffer works in the Code node sandbox
// but may fail silently inside HTTP node expressions in some n8n versions.
const processed_html_b64 = Buffer.from(html, 'utf-8').toString('base64');

return {
  json: {
    ...data,
    processed_html: html,
    processed_html_b64,
  },
};
