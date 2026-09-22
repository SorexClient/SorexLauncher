# Prompt for Claude Code — Implement News API for Sorex Launcher

Paste the section between `--- BEGIN PROMPT ---` and `--- END PROMPT ---` into Claude Code inside the **API repository** (the one hosted at `api.sorexclient.com`).

---

## --- BEGIN PROMPT ---

I need you to implement a **news/announcements system** for the Sorex Launcher. The launcher is a desktop Electron app that already calls this API at `http://api.sorexclient.com/` for things like `/versions`, `/launcher-version`, and `/friends`. I'm adding a public news feed plus a minimal admin write path. Match the existing conventions in the project (framework, file layout, error format, logging, auth — look at one or two existing routes and follow that style).

### Context

- The launcher pulls the news list on startup and every **5 minutes** afterwards.
- News appears in two places: a sidebar preview on the home screen (first 3 items) and a dedicated "News" page showing the whole list.
- Each item is rendered as: optional banner image, optional category tag, title, optional subtitle. Optional `url` opens in the system browser.
- News is **public** — no UUID required on the GET.
- Admin write endpoints (POST/PUT/DELETE) require auth. We don't have a full admin system yet — gate it with a single shared bearer token in env (`NEWS_ADMIN_TOKEN`). We'll replace this with a proper admin role later.

### Endpoints

#### 1) `GET /news?limit=20`

Public. Returns the latest news, newest first.

**Query:** `limit` — optional, default 20, clamp to [1, 50].

**200 response:**
```json
{
  "news": [
    {
      "id":          "n_2026_03_14_aurora",
      "title":       "Aurora update is live",
      "subtitle":    "New cosmetics, faster startup, fixed bugs.",
      "tag":         "Update",
      "image":       "https://cdn.sorexclient.com/news/aurora-banner.jpg",
      "url":         "https://sorexclient.com/blog/aurora",
      "publishedAt": 1734567890123
    }
  ]
}
```

- `news` is always an array, never `null`.
- Sort by `publishedAt` descending.
- Skip items whose `publishedAt` is in the future (lets us schedule posts).
- Skip items flagged as drafts.
- `image` is optional. If present, must be HTTPS and resolve to an image. Don't break the launcher if it's missing — the UI falls back to a plain card.
- `url` is optional. Must be HTTPS if present.
- `tag` is a short label like "Update", "Event", "Shop". Free text, but recommend keeping it ≤ 12 chars.

Cache the response for 60s at the edge if you have caching — there's no per-user variation.

#### 2) `POST /news` (admin)

Create a news item.

**Auth:** `Authorization: Bearer <NEWS_ADMIN_TOKEN>` — reject 401 if missing/wrong.

**Body:**
```json
{
  "title":       "Required",
  "subtitle":    "Optional",
  "tag":         "Optional",
  "image":       "https://... optional",
  "url":         "https://... optional",
  "publishedAt": 1734567890123,
  "draft":       false
}
```

- `title` required, 1–120 chars.
- `subtitle` ≤ 240 chars.
- `tag` ≤ 24 chars.
- `image` and `url` must be HTTPS if set.
- `publishedAt` optional — default to now if missing. Can be in the future to schedule.
- `draft` optional — default false. Drafts never show in GET.
- `id` is server-generated. Use a stable slug-style ID derived from date + title (e.g. `n_2026_03_14_aurora-update-is-live`), not just a UUID, so the URL stays human-readable.

**201 response:** the created record (same shape as GET items, plus `draft`).

#### 3) `PUT /news/{id}` (admin)

Update fields. Same auth and field rules as POST. Partial updates allowed. Returns 200 with the updated record, 404 if not found.

#### 4) `DELETE /news/{id}` (admin)

Returns 204 on success, 404 if not found.

### Storage suggestion

One table:

```
news(
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  tag          TEXT,
  image_url    TEXT,
  link_url     TEXT,
  published_at BIGINT NOT NULL,   -- Unix ms
  draft        BOOLEAN NOT NULL DEFAULT false,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
)
```

Index `(draft, published_at DESC)` so the GET query is one index scan.

### Format conventions

- Match the existing error shape (look at an existing handler — should be `{ "error": "..." }` or similar).
- All timestamps are Unix-ms numbers, not ISO strings (matches `/versions`).
- IDs are lowercase, kebab-style, ASCII-only.
- Validate input — reject 400 with a clear error message rather than coercing.

### Edge cases & non-goals

- **Don't** add user-specific filtering, reactions, or comments.
- **Don't** add localization yet — single-language for now (English content, the launcher renders it as-is in all languages).
- **Don't** add markdown rendering — `subtitle` is plain text only.
- **Do** rate-limit the admin endpoints (10 writes per minute is plenty).
- **Do** support CORS for the launcher's `file://` origin and our website — add the same allowlist the other public endpoints use.

### Acceptance tests

Write integration tests that:
1. POST with no auth → 401.
2. POST with valid auth → 201, item visible in GET.
3. POST with `draft: true` → 201, item **NOT** visible in GET.
4. POST with `publishedAt` 1 hour in the future → 201, item **NOT** in GET. Advance the test clock 1 hour → item now visible.
5. PUT updates a field → reflected in next GET.
6. DELETE → 204, item gone from GET.
7. GET with `limit=2` → returns exactly 2 (assuming ≥ 2 published items).
8. GET with `limit=999` → clamped to 50.

### What to deliver

- The four route handlers in the project's conventional location.
- The DB migration for the `news` table.
- The tests from above.
- A one-paragraph update for the project README under "Endpoints".
- A short note in the README telling the operator where to set `NEWS_ADMIN_TOKEN` and how to rotate it.

## --- END PROMPT ---

---

## Notes for you (the launcher dev)

- Launcher side is already wired up. It calls `GET /news?limit=20` on startup via the `news:list` IPC handler in [electron-main.cjs](electron-main.cjs), and the home sidebar plus the News page both render `newsItems`.
- The refresh interval is 5 minutes — adjust in [App.svelte](src/App.svelte) if you want it more or less aggressive.
- Until the API ships, the News page is empty. No crash, no toast — just empty grid with a header.
- If you want a quick way to seed content during testing, you can `curl` the POST endpoint directly with the admin token.
