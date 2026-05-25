# Workflow nodes — node-by-node config

Refer to this when building the workflow manually in n8n's UI, or when `workflow.json` import fails due to version mismatch.

The workflow has **17 nodes** in sequence. Edges between nodes are simple `main → main` unless noted.

## What's in workflow.json vs what's TODO

The shipped `workflow.json` is the **baseline path** (~15 nodes) and excludes some conditional branches to keep the import simple. After import, add these:

| Feature | Status | Notes |
|---|---|---|
| Logo upload (download from Slack + PUT to GitHub) | TODO | Add an IF on `has_logo` after Mode OK, branch into Download Logo → use in PUT. See nodes 5 and 11 below. |
| Hero upload (same pattern) | TODO | Same as logo, conditional on `has_hero`. |
| `mode=update` sha handling | TODO | Each PUT needs the existing file's `sha`. Add a GET before each PUT in update mode. Alternative: use Git Trees API for atomic commits. |
| Polling deploy status | TODO | Currently uses `Wait 15s` + health check. For higher reliability, replace with poll loop on `/v13/deployments/{id}`. |
| Slack ephemeral "received" acknowledgement | TODO | Slack form expects an immediate response. Today the user sees the final result ~30-40s later. Could split into 2 webhooks (ack + completion). |

---

## 1. Webhook

- **Node type:** `n8n-nodes-base.webhook`
- **HTTP Method:** `POST`
- **Path:** `partner-funding`
- **Response Mode:** `Last Node`
- **Response Code:** `200`
- **Response Data:** `Auto` (returns final Slack response)
- **Authentication:** None (Slack form provides a signed URL; we trust the webhook URL itself)

Resulting URL: `https://<your-n8n-host>/webhook/partner-funding`. Copy this for the Slack form.

**Expected payload (JSON body):**
```json
{
  "mode": "create",
  "partner_name": "Acme Co",
  "color_primary": "#1f4ed8",
  "color_secondary": "#0ea5e9",
  "widget_url": "https://iw.lendflow.com/?env=...",
  "logo_file_url": "https://files.slack.com/.../logo.png",
  "hero_file_url": null,
  "embed_widget": false,
  "cobrand": false,
  "utm_source": "spring2026",
  "utm_medium": "email",
  "utm_campaign": "reengagement",
  "requester_slack_id": "U01ABCD"
}
```

---

## 2. Validate (Code)

- **Node type:** `n8n-nodes-base.code`
- **Mode:** Run Once (default)
- **Language:** JavaScript
- **Code:** paste contents of `lib/validate.js`

**Output:** normalized JSON with `slug`, `mode`, `partner_name`, `color_*`, `widget_url` (with UTMs appended), `has_logo`, `has_hero`, `logo_ext`, `hero_ext`, `logo_path`, `hero_image_path`, `embed_widget`, `cobrand`, `cta_href`, `requester_slack_id`.

If validation fails, the node throws — the workflow stops with the error message in n8n's run history. (Future: catch with an Error Trigger and post a Slack error to the requester.)

---

## 3. Check Slug Exists (HTTP Request)

- **Node type:** `n8n-nodes-base.httpRequest`
- **Method:** `GET`
- **URL:** `=https://api.github.com/repos/jdiego31/marketing-pages/contents/{{ $json.slug }}`
- **Authentication:** Generic Credential → HTTP Header Auth → `github_pat`
- **Headers:**
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
- **Options → Response → Never Error:** `true` (so 404 doesn't kill the node — we need to check it manually)
- **Options → Response → Include Response Headers and Status:** `true`

**Output:** `$json.statusCode` (200 or 404) + body.

---

## 4. Mode/Existence Check (IF)

- **Node type:** `n8n-nodes-base.if`
- **Conditions:** Combine with `AND`. Need ONE of:
  - `mode == "create"` AND `statusCode == 404` → continue
  - `mode == "update"` AND `statusCode == 200` → continue
- Use the **OR** combinator at the top level with two AND groups.

Expressions (n8n style):
```
{{ $('Validate').first().json.mode === 'create' && $('Check Slug Exists').first().json.statusCode === 404 }}
||
{{ $('Validate').first().json.mode === 'update' && $('Check Slug Exists').first().json.statusCode === 200 }}
```

- **true branch:** go to node 5
- **false branch:** go to node "Slack Error" (see node 17b below)

---

## 5. Download Logo (HTTP Request) — *conditional*

Only runs if `$('Validate').first().json.has_logo === true`. Use n8n's "Continue On Fail" + filter, or wrap in a small IF node.

- **Method:** `GET`
- **URL:** `={{ $('Validate').first().json.logo_file_url }}`
- **Authentication:** Slack OAuth2 (`slack_oauth`) — n8n auto-attaches `Authorization: Bearer xoxb-...` when using Slack credential on a generic HTTP node
- **Response Format:** `File` (binary)
- **Property Name:** `logo_binary`

---

## 6. Download Hero (HTTP Request) — *conditional*

Same as node 5 but with `hero_file_url` and property `hero_binary`. Skip if `has_hero` is false.

---

## 7. Read Template (HTTP Request)

- **Method:** `GET`
- **URL:** `https://api.github.com/repos/jdiego31/marketing-pages/contents/template/index.html`
- **Authentication:** `github_pat`
- **Headers:** same as node 3
- **Output:** body is JSON with `content` (base64-encoded HTML) and `sha`.

> Also fetch `template/styles.css` here (parallel HTTP node) — call it **Read Template CSS**. Same setup, different path.

---

## 8. Process Template (Code)

- **Node type:** `n8n-nodes-base.code`
- **Code:** paste `lib/process.js`

Input: output of node 2 (Validate) + reads `$('Read Template').first().json.content` internally.

Output: `{ ...validate output, processed_html }`.

---

## 9–12. PUT Files to GitHub (HTTP Request × 4)

Four parallel-ish HTTP nodes, one per file. n8n runs them in sequence by default, which is fine for our scale.

For each:
- **Method:** `PUT`
- **URL:** `=https://api.github.com/repos/jdiego31/marketing-pages/contents/{{ $('Validate').first().json.slug }}/<filename>`
- **Authentication:** `github_pat`
- **Headers:** `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
- **Body Content Type:** JSON
- **Body:**
  ```json
  {
    "message": "Add partner: {{ $('Validate').first().json.slug }}",
    "content": "<base64>",
    "sha": "<only if updating an existing file>"
  }
  ```

**Per-file specifics:**

| Filename | Content | sha (for update) |
|---|---|---|
| `index.html` | base64 of `$('Process Template').first().json.processed_html` | from `$('Check Slug Exists')` if `mode=update` |
| `styles.css` | base64 of `$('Read Template CSS').first().json.content` (decode then re-encode, OR pass through `content` directly since GitHub returns it as base64 already) | same |
| `logo.<ext>` | base64 of `$binary.logo_binary` (from node 5) | from a prior GET if updating |
| `hero.<ext>` | base64 of `$binary.hero_binary` | from a prior GET if updating |

> **Update mode complication:** if updating, each file needs its current `sha` for the PUT to succeed. Add a GET for each file before its PUT. Simpler alternative: use the **Git Trees API** (one POST creates all blobs + commits) — heavier setup but atomic. For MVP, do per-file GET+PUT.

---

## 13. Get Zipball (HTTP Request)

- **Method:** `GET`
- **URL:** `https://api.github.com/repos/jdiego31/marketing-pages/zipball/main`
- **Authentication:** `github_pat`
- **Response Format:** `File` (binary)
- **Property Name:** `repo_zip`

Note: GitHub redirects the zipball URL to a `codeload.github.com` URL. n8n's HTTP node follows redirects by default.

---

## 14. Decompress (Compression node)

- **Node type:** `n8n-nodes-base.compression`
- **Operation:** `Decompress`
- **Binary Property Name (input):** `repo_zip`
- **Format:** Auto-detect (or `zip`)

Output: **one item per file** in the zip, with `$binary.data.data` containing base64 contents and `$json.fileName` the path within the zip.

---

## 15. Build Deploy Payload (Code)

- **Code:** paste `lib/build-deploy.js`

Output: single item with `json.files = [{ file, data, encoding: "base64" }, ...]`.

---

## 16. Deploy to Vercel (HTTP Request)

- **Method:** `POST`
- **URL:** `https://api.vercel.com/v13/deployments?teamId=team_HqA3bL7kkzPosLZDmtUYohZS`
- **Authentication:** `vercel_token`
- **Headers:** `Content-Type: application/json`
- **Body:**
  ```json
  {
    "name": "partnerfunding",
    "project": "prj_KFGLlB9oaQgyXV6oRAUjWeAkdqmt",
    "target": "production",
    "files": "={{ $('Build Deploy Payload').first().json.files }}",
    "projectSettings": { "framework": null }
  }
  ```

**Output:** `json.id` (deployment ID), `json.url` (deployment URL like `partnerfunding-xxx-lendflow.vercel.app`).

---

## 17. Wait + Health Check (Wait node + HTTP Request)

For MVP, skip the polling loop. Just wait, then health-check.

**17a. Wait:**
- **Node type:** `n8n-nodes-base.wait`
- **Amount:** `15`
- **Unit:** `Seconds`

**17b. Health Check (HTTP Request):**
- **Method:** `GET`
- **URL:** `=https://partnerfunding.vercel.app/{{ $('Validate').first().json.slug }}/`
- **Options → Response → Never Error:** `true`

If `statusCode !== 200`, the next node should branch to an error response. For MVP, just continue and let Slack message reflect the URL even if deploy is still propagating.

> **Better future version:** replace 17a+17b with a polling loop: HTTP GET `/v13/deployments/{id}` → IF `readyState === "READY"` → continue; ELSE Wait 5s → loop (max 12 iterations). Use n8n's **Switch** + **Wait** in a cycle.

---

## 18. Slack Success Response

- **Node type:** `n8n-nodes-base.slack` (v2.3+)
- **Credential:** `slack_oauth`
- **Resource:** `Message`
- **Operation:** `Send`
- **Channel:** `={{ $('Validate').first().json.requester_slack_id }}` (DM)
- **Text:**
  ```
  ✅ Your partner landing for *{{ $('Validate').first().json.partner_name }}* is live:
  https://partnerfunding.vercel.app/{{ $('Validate').first().json.slug }}/
  ```

---

## Error path (separate flow)

When node 4 (IF) goes to the FALSE branch, route to:

**18b. Slack Error Response**
- Same as node 18 but with an error message:
  ```
  ❌ Couldn't create your partner landing:
  • If mode is `create`, the slug `{{ $('Validate').first().json.slug }}` already exists. Use `update` instead.
  • If mode is `update`, the slug doesn't exist. Use `create` first.
  ```

---

## Connection map

```
Webhook
  → Validate
    → Check Slug Exists
      → IF (mode/existence)
        ├─ true → [Download Logo, Download Hero, Read Template, Read Template CSS — parallel]
        │           → Process Template
        │             → PUT index.html → PUT styles.css → PUT logo? → PUT hero?
        │               → Get Zipball
        │                 → Decompress
        │                   → Build Deploy Payload
        │                     → Deploy to Vercel
        │                       → Wait 15s
        │                         → Health Check
        │                           → Slack Success
        └─ false → Slack Error
```
