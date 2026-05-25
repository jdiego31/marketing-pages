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
  // n8n's Compression Decompress emits one item per file, with binary in $binary.data
  const fileName = item.json.fileName || item.json.name || item.binary?.data?.fileName;
  if (!fileName) continue;

  // Strip GitHub zipball's top-level wrapper folder
  // e.g., "jdiego31-marketing-pages-abc1234/index.html" → "index.html"
  const stripped = fileName.replace(/^[^/]+\//, '');
  if (!stripped || stripped.endsWith('/')) continue; // skip dirs

  // Skip excluded paths
  if (EXCLUDE.some((re) => re.test(stripped))) continue;

  const binaryData = item.binary?.data?.data;
  if (!binaryData) continue;

  files.push({
    file: stripped,
    data: binaryData, // already base64 from n8n Compression node
    encoding: 'base64',
  });
}

if (files.length === 0) {
  throw new Error('No files to deploy after filtering — check zipball extraction.');
}

return {
  json: {
    files,
    file_count: files.length,
  },
};
