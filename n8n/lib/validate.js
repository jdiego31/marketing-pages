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

// Logo is required, but can come as either inline base64 data (test form)
// or a URL to download from (Slack file URL)
if (!payload.logo_file_data && !payload.logo_file_url) {
  throw new Error('Logo is required: provide either logo_file_data (base64) or logo_file_url.');
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
// n8n's Code node sandbox doesn't expose the `URL` global, so we do
// validation + param appending with plain string ops.
if (typeof widget_url !== 'string' || !/^https?:\/\/[^\s]+/i.test(widget_url)) {
  throw new Error(`Invalid widget_url. Value: ${JSON.stringify(widget_url)} (type: ${typeof widget_url}). Must be a string starting with http:// or https://.`);
}

function appendQueryParams(base, params) {
  const pairs = [];
  for (const [k, v] of Object.entries(params)) {
    if (v && String(v).trim()) {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v).trim())}`);
    }
  }
  if (pairs.length === 0) return base;
  const sep = base.indexOf('?') === -1 ? '?' : '&';
  return base + sep + pairs.join('&');
}

const widget_url_final = appendQueryParams(widget_url, {
  utm_source: payload.utm_source,
  utm_medium: payload.utm_medium,
  utm_campaign: payload.utm_campaign,
});

// ---------- File extensions ----------
// No URL parser — strip query/hash and grab the last `.ext` from the path.
function extFromUrl(url, fallback) {
  if (!url || typeof url !== 'string') return fallback;
  const pathOnly = url.split('?')[0].split('#')[0];
  const m = pathOnly.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : fallback;
}
function extFromName(name, fallback) {
  if (!name || typeof name !== 'string') return fallback;
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : fallback;
}

// Derive extensions — prefer the filename (from direct upload) over URL
const has_logo_data = !!payload.logo_file_data;
const has_hero_data = !!payload.hero_file_data;
const has_hero_url = !!payload.hero_file_url;
const has_hero = has_hero_data || has_hero_url;

const logo_ext = has_logo_data
  ? extFromName(payload.logo_file_name, 'png')
  : extFromUrl(payload.logo_file_url, 'png');

const hero_ext = has_hero_data
  ? extFromName(payload.hero_file_name, 'jpg')
  : (has_hero_url ? extFromUrl(payload.hero_file_url, 'jpg') : null);

// ---------- Output ----------
return {
  json: {
    slug,
    mode,
    partner_name,
    color_primary,
    color_secondary,
    widget_url: widget_url_final,

    // Logo (required) — either inline base64 or URL to download
    has_logo_data,
    logo_file_data: payload.logo_file_data || null,
    logo_file_url: payload.logo_file_url || null,
    logo_ext,
    logo_path: `./logo.${logo_ext}`,

    // Hero (optional) — either inline base64, URL, or default fallback
    has_hero,
    has_hero_data,
    hero_file_data: payload.hero_file_data || null,
    hero_file_url: payload.hero_file_url || null,
    hero_ext,
    hero_image_path: has_hero ? `./hero.${hero_ext}` : '/_assets/hero-default.jpg',

    embed_widget: !!payload.embed_widget,
    cobrand: !!payload.cobrand,
    cta_href: payload.embed_widget ? '#apply' : widget_url_final,

    requester_slack_id: payload.requester_slack_id || null,
    slack_channel_id: payload.slack_channel_id || null,
  },
};
