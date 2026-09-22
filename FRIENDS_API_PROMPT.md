# Prompt for Claude Code — Implement Friends API for Sorex Launcher

Paste the section between `--- BEGIN PROMPT ---` and `--- END PROMPT ---` into Claude Code inside the **API repository** (the one hosted at `api.sorexclient.com`).

---

## --- BEGIN PROMPT ---

I need you to implement a **friends system** for the Sorex Launcher. The launcher is a desktop Electron app that already calls this API at `http://api.sorexclient.com/` for things like `/versions` and `/launcher-version`. I'm adding three new endpoints. Please add them in the same style as the existing routes (look at one of the existing route files to match conventions — framework, file layout, logging, error format, etc.).

### Context

- The launcher fetches the friends list every 30 seconds while open.
- Users are identified by their **Minecraft UUID** (the one returned by Microsoft/Mojang login). The UUID is stable per Microsoft account.
- There is no separate API auth layer for now — the launcher just passes the UUID. Don't add JWT/sessions yet, but do reject obviously malformed UUIDs.
- The launcher renders each friend as an avatar + name + online state + optional current server. The avatar is pulled from `minotar.net`, you don't need to serve it.

### Endpoints

#### 1) `GET /friends?uuid={uuid}`

Return the friends of the given user.

**Query:** `uuid` — owner's Minecraft UUID (with or without dashes; accept both).

**200 response:**
```json
{
  "friends": [
    {
      "uuid":     "f7c77d99-9f15-4a27-867c-1d0e0a5e1234",
      "name":     "DrStarNight",
      "online":   true,
      "server":   "blocksmc.com",
      "lastSeen": 1734567890123
    }
  ]
}
```

- `friends` is always an array, never `null`.
- `online` is `true` if a heartbeat was received in the last **120 seconds** (see `/launcher/heartbeat`, already implemented).
- `server` is `null` when the friend is in the launcher or singleplayer.
- `lastSeen` is a Unix-ms timestamp of the last heartbeat (also when offline).

If the UUID is unknown, return `{ "friends": [] }` (200), not 404.

#### 2) `POST /friends`

Add a friend by Minecraft username (the launcher only has the typed name, not the UUID).

**Body:**
```json
{ "uuid": "owner-uuid", "friendName": "Notch" }
```

**Behavior:**
1. Resolve `friendName` → UUID using Mojang's API (`https://api.mojang.com/users/profiles/minecraft/{name}`). Cache resolved UUIDs in your DB so you don't re-hit Mojang on every add.
2. Reject if `friendName` doesn't exist (`404` with `{ "error": "Unknown Minecraft user" }`).
3. Reject if it would create a self-friendship (`400`).
4. If the friendship already exists, return `200` with the existing record (idempotent — don't error).
5. Insert the friendship symmetrically: A→B AND B→A in one transaction. The launcher treats friendships as mutual.

**201 response:** the new friend record, same shape as a single entry in `GET /friends`.

#### 3) `DELETE /friends`

**Body:**
```json
{ "uuid": "owner-uuid", "friendUuid": "friend-uuid" }
```

Remove both directions of the friendship. Return `204` on success, `404` if it didn't exist.

### Heartbeat — already exists, just confirm

The launcher already POSTs to `/launcher/heartbeat` with `{ uuid, status: "online"|"offline" }` (currently the dev port `:3001`; please make sure `api.sorexclient.com` also handles it). Use these heartbeats to compute `online` and `lastSeen` for the friends list. If you also know which server the player is on (from the in-game mod), include it in the heartbeat as `server`.

### Storage suggestion

Two tables (or collections) is enough:

- `users(uuid PRIMARY KEY, name, last_seen_ms, current_server NULLABLE)`
- `friendships(owner_uuid, friend_uuid, created_at, PRIMARY KEY(owner_uuid, friend_uuid))`

Index `users(name)` so the POST endpoint's username lookup is fast.

### Edge cases & non-goals

- **Rate-limit** the POST endpoint per owner UUID — 10 adds per minute is plenty.
- **Don't** implement friend *requests*/accept flows yet. Add is direct for now.
- **Don't** implement blocking. We'll add that later.
- **Don't** add WebSockets. The launcher polls every 30s; that's fine.
- **Do** log errors with enough context to debug (owner UUID prefix is enough — don't log full UUIDs at INFO level for privacy).

### Format conventions to follow

- Match the existing error shape — find one of the existing handlers and copy its `{ "error": "..." }` style.
- All timestamps are Unix-ms numbers, not ISO strings (matches what the launcher already gets from `/versions`).
- UUIDs are returned **with** dashes in responses, regardless of how they came in.

### Acceptance test (write it)

Add an integration test that:
1. Creates two users via heartbeat.
2. POSTs `{ uuid: A, friendName: <B's name> }` → expects 201 and a friend record.
3. GETs `/friends?uuid=A` → sees B as online (heartbeat is recent).
4. Waits past the 120s online window (use a fake clock if you have one) → GETs again → B is offline but `lastSeen` is set.
5. DELETEs the friendship → both sides gone.

### What to deliver

- The three route handlers in the project's conventional location.
- The DB migration if you need new tables/columns.
- The test from above.
- A one-paragraph update for the project README under "Endpoints" listing the new routes.

## --- END PROMPT ---

---

## Notes for you (the launcher dev)

- The launcher side is already wired up. It calls `GET /friends?uuid=…` every 30 seconds via the `friends:list` IPC handler in [electron-main.cjs](electron-main.cjs), and the `FriendsPanel` re-renders whenever the response changes.
- `POST` / `DELETE` aren't bound to UI yet — the IPC handlers are in place (`friends:add`, `friends:remove`) but no "Add friend" modal exists. Once the API is live we can wire up the `+` button in the panel.
- Until the API ships, the launcher will simply show an empty friends list. No crash, no error toast — just empty.
