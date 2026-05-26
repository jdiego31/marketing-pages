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

  // Iterate ALL binary properties on the item — handles both n8n output formats
  // (single item with many binaries, or multiple items each with one).
  for (const [propName, bin] of Object.entries(item.binary)) {
    if (!bin || typeof bin !== 'object') continue;
    if (!bin.data) continue;

    // Build the full file path within the repo. n8n's Compression node exposes
    // the path differently across versions:
    //   - bin.fileName with full path     → use as-is
    //   - bin.fileName basename + bin.directory  → concat
    //   - bin.fileName basename only      → root-level
    let fullPath = '';
    if (bin.fileName && bin.fileName.includes('/')) {
      fullPath = bin.fileName;
    } else if (bin.directory) {
      const dir = bin.directory.replace(/^\/+|\/+$/g, '');
      fullPath = (dir ? dir + '/' : '') + (bin.fileName || '');
    } else if (bin.fileName) {
      fullPath = bin.fileName;
    } else {
      continue;
    }

    // Strip GitHub zipball wrapper ("owner-repo-shortsha/")
    fullPath = fullPath.replace(/^[^/]+-[a-f0-9]{7,}\//, '');

    if (!fullPath || fullPath.endsWith('/')) continue;
    if (EXCLUDE.some((re) => re.test(fullPath))) continue;

    files.push({
      file: fullPath,
      data: bin.data,
      encoding: 'base64',
    });
  }
}

// Detect duplicates — if any, the path extraction is wrong for this n8n version
const pathCounts = {};
for (const f of files) pathCounts[f.file] = (pathCounts[f.file] || 0) + 1;
const dupes = Object.entries(pathCounts).filter(([, c]) => c > 1).map(([p]) => p);
if (dupes.length > 0) {
  const sample = items[0]?.binary ? (() => {
    const k = Object.keys(items[0].binary)[0];
    const b = items[0].binary[k];
    return b ? { propName: k, fileName: b.fileName, directory: b.directory, hasData: !!b.data } : null;
  })() : null;
  throw new Error('Duplicate paths: ' + dupes.join(', ') + '. Sample binary: ' + JSON.stringify(sample));
}

if (files.length === 0) {
  throw new Error('No files to deploy after filtering.');
}

return [{
  json: {
    files,
    file_count: files.length,
    sample_paths: files.slice(0, 10).map((f) => f.file),
    slug,
    partner_name: $('Validate').first().json.partner_name,
    requester_slack_id: $('Validate').first().json.requester_slack_id,
  },
}];
