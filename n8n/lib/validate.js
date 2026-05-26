/**
 * n8n Code node — Validate input + apply UTMs + generate slug
 *
 * Input: $input.first().json.body (the Slack webhook payload)
 * Output: normalized json object with all fields ready for downstream nodes
 *
 * Throws on validation failure — wrap in a try/catch IF node downstream
 * to send error response to Slack.
 */

// Body can arrive as:
//   - object (Content-Type: application/json) → use directly
//   - string (Content-Type: text/plain or none) → JSON.parse
//   - direct fields in $json (some webhook configs) → fallback
let payload = $input.first().json.body;
if (typeof payload === 'string') {
  try { payload = JSON.parse(payload); }
  catch (e) { throw new Error(`Body is not valid JSON: ${e.message}`); }
}
if (!payload || typeof payload !== 'object') {
  payload = $input.first().json;
}

// ---------- Required fields ----------
const REQUIRED = ['mode', 'partner_name', 'color_primary', 'color_secondary', 'widget_url'];
const missing = REQUIRED.filter((f) => !payload[f]);
if (missing.length) {
  throw new Error(`Missing required fields: ${missing.join(', ')}`);
}

const { mode, partner_name, color_primary, color_secondary, widget_url } = payload;

// ---------- Mode ----------
if (!['create', 'update'].includes(mode)) {
  throw new Error(`Invalid mode '${mode}'. Must be 'create' or 'update'.`);
}

// ---------- Colors ----------
const HEX = /^#[0-9A-F]{6}$/i;
if (!HEX.test(color_primary)) {
  throw new Error(`Invalid color_primary '${color_primary}'. Use #RRGGBB hex format.`);
}
if (!HEX.test(color_secondary)) {
  throw new Error(`Invalid color_secondary '${color_secondary}'. Use #RRGGBB hex format.`);
}

// ---------- Slug ----------
function toSlug(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

let slug;
if (mode === 'create') {
  slug = toSlug(partner_name);
  if (!slug) throw new Error(`Cannot derive slug from partner_name '${partner_name}'.`);
} else {
  if (!payload.slug) throw new Error("In 'update' mode, the slug field is required.");
  slug = payload.slug;
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid slug '${slug}'. Use only lowercase letters, digits, and hyphens.`);
  }
}

// Guard reserved paths
const RESERVED = ['template', '_assets', 'n8n', 'example'];
if (mode === 'create' && RESERVED.includes(slug)) {
  throw new Error(`Slug '${slug}' is reserved.`);
}

// ---------- Widget URL + UTM ----------
let widgetUrl;
try {
  widgetUrl = new URL(widget_url);
} catch (e) {
  throw new Error(`Invalid widget_url '${widget_url}'.`);
}

// Append UTMs only if provided
['utm_source', 'utm_medium', 'utm_campaign'].forEach((key) => {
  const value = payload[key];
  if (value && typeof value === 'string' && value.trim()) {
    widgetUrl.searchParams.set(key, value.trim());
  }
});

const widget_url_final = widgetUrl.toString();

// ---------- File extensions ----------
function extFromUrl(url, fallback) {
  if (!url) return fallback;
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : fallback;
  } catch (e) {
    return fallback;
  }
}

const has_logo = !!payload.logo_file_url;
const has_hero = !!payload.hero_file_url;
const logo_ext = has_logo ? extFromUrl(payload.logo_file_url, 'png') : null;
const hero_ext = has_hero ? extFromUrl(payload.hero_file_url, 'jpg') : null;

// ---------- Output ----------
return {
  json: {
    slug,
    mode,
    partner_name,
    color_primary,
    color_secondary,
    widget_url: widget_url_final,

    has_logo,
    has_hero,
    logo_file_url: payload.logo_file_url || null,
    hero_file_url: payload.hero_file_url || null,
    logo_ext,
    hero_ext,
    logo_path: has_logo ? `./logo.${logo_ext}` : '',
    hero_image_path: has_hero ? `./hero.${hero_ext}` : '/_assets/hero-default.jpg',

    embed_widget: !!payload.embed_widget,
    cobrand: !!payload.cobrand,
    cta_href: payload.embed_widget ? '#apply' : widget_url_final,

    requester_slack_id: payload.requester_slack_id || null,
    slack_channel_id: payload.slack_channel_id || null,
  },
};
