/**
 * n8n Code node — Build Vercel deploy payload from extracted zipball
 *
 * Inputs:
 *   - $input.all() — N items, one per file extracted by the Compression node.
 *     Each item: { json: { fileName }, binary: { data: { data: <base64>, mimeType, ... } } }
 *
 * Output:
 *   - Single item with json.files = array of { file, data, encoding: "base64" } for Vercel API
 *
 * GitHub zipball wraps the repo content in a top-level folder
 * (e.g., "jdiego31-marketing-pages-abc1234/"). We strip that prefix.
 *
 * Files excluded from deploy (matches .vercelignore intent):
 *   - template/  — internal master template, not for production
 *   - PLAN.md    — local-only doc
 *   - .git/      — git metadata
 *   - .vercel/   — local CLI link
 *   - .gitignore, .vercelignore — config, not content
 *   - n8n/       — automation source, not deployable content
 */

const items = $input.all();
const slug = $('Validate').first().json.slug;

const EXCLUDE = [
  /^template\//,
  /^PLAN\.md$/,
  /^\.git\//,
  /^\.vercel\//,
  /^\.vercelignore$/,
  /^\.gitignore$/,
  /^n8n\//,
  /\/\.DS_Store$/,
  /^\.DS_Store$/,
];

const files = [];

for (const item of items) {
  if (!item.binary || typeof item.binary !== 'object') continue;

  // Iterate ALL binary properties on the item.
  //   Newer n8n: one item with many binary keys (file_0, file_1, ...)
  //   Older n8n: multiple items, each with one binary key (data)
  for (const [propName, bin] of Object.entries(item.binary)) {
    if (!bin || typeof bin !== 'object') continue;

    const fileName = bin.fileName || bin.name;
    if (!fileName) continue;

    // GitHub zipball wraps in "jdiego31-marketing-pages-abc1234/"
    const stripped = fileName.replace(/^[^/]+\//, '');
    if (!stripped || stripped.endsWith('/')) continue;

    if (EXCLUDE.some((re) => re.test(stripped))) continue;

    const data = bin.data;
    if (!data) continue;

    files.push({
      file: stripped,
      data,
      encoding: 'base64',
    });
  }
}

if (files.length === 0) {
  // Debug aid: dump what we received so we can adjust
  const debug = items.map((it, i) => ({
    index: i,
    json_keys: Object.keys(it.json || {}),
    binary_keys: Object.keys(it.binary || {}),
    first_binary_sample: it.binary ? (() => {
      const k = Object.keys(it.binary)[0];
      const b = k ? it.binary[k] : null;
      return b ? { propName: k, fileName: b.fileName, hasData: !!b.data, mimeType: b.mimeType } : null;
    })() : null,
  }));
  throw new Error('No files to deploy. Debug: ' + JSON.stringify(debug));
}

return [{
  json: {
    files,
    file_count: files.length,
    slug,
    partner_name: $('Validate').first().json.partner_name,
    requester_slack_id: $('Validate').first().json.requester_slack_id,
  },
}];
