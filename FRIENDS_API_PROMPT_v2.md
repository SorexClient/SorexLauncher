# Prompt for Claude Code — Extend Friends API (Requests + DMs)

Builds on top of [FRIENDS_API_PROMPT.md](FRIENDS_API_PROMPT.md). Paste the section between `--- BEGIN PROMPT ---` and `--- END PROMPT ---` into Claude Code inside the **API repository**.

---

## --- BEGIN PROMPT ---

Extend the existing **friends system** with two new feature areas: **friend requests** (replacing the immediate-add behavior) and **direct messages (DMs)** between friends. Match the existing project conventions — framework, route layout, error format, logging, validation patterns.

### Context recap

- Users are identified by Minecraft UUID. No JWT/session yet.
- The launcher polls these endpoints. Requests are pulled every 30s along with the friends list; messages are pulled every 5s while a chat is open. No WebSockets yet.
- The previous `POST /friends` (direct add) endpoint can stay for migration, but the launcher now goes through requests for new friendships. Keep behavior backwards-compatible.

---

## Part A — Friend Requests

### Endpoints

#### 1) `GET /friends/requests?uuid={uuid}`

Return both directions for a user.

**200 response:**
```json
{
  "incoming": [
    {
      "id":        "req_01HXYZ...",
      "from":      { "uuid": "...", "name": "Alice" },
      "to":        { "uuid": "{me}", "name": "Me" },
      "createdAt": 1734567890123
    }
  ],
  "outgoing": [
    {
      "id":        "req_01ABCD...",
      "from":      { "uuid": "{me}", "name": "Me" },
      "to":        { "uuid": "...", "name": "Bob" },
      "createdAt": 1734567890124
    }
  ]
}
```

Both arrays always present (possibly empty). Sort newest first.

#### 2) `POST /friends/requests`

Send a friend request by username.

**Body:**
```json
{ "uuid": "owner-uuid", "friendName": "Notch" }
```

**Behavior:**
1. Resolve `friendName` → UUID via Mojang (`https://api.mojang.com/users/profiles/minecraft/{name}`). Cache the mapping in the `users` table so you don't re-hit Mojang on every send.
2. **404** if the Minecraft user doesn't exist.
3. **400** if it would create a self-request (owner == target).
4. **409** if they are already friends.
5. **409** if a pending request in either direction already exists.
6. **Auto-accept shortcut:** if there's already a pending request from the *target* to the owner, treat this POST as an accept of THAT request — return 200 with `{ "friendship": {...} }` instead of creating a new request. This matches user expectation: "I'm trying to add someone who already added me — just become friends now."

**201 response:** the new request record (same shape as a single entry in `GET`).

#### 3) `POST /friends/requests/{id}/accept`

**Body:** `{ "uuid": "owner-uuid" }` — must be the **recipient** of the request.

**Behavior:**
- **403** if `uuid` is not the recipient.
- **404** if the request doesn't exist or was already resolved.
- On success: insert the friendship symmetrically (A→B and B→A in one transaction), delete the request, return **200** with the new friend record.

#### 4) `POST /friends/requests/{id}/reject`

**Body:** `{ "uuid": "owner-uuid" }` — must be either the recipient OR the sender (sender uses this to cancel).

**Behavior:** delete the request, return **204**.

### Storage

```
friend_requests(
  id           TEXT PRIMARY KEY,           -- e.g. ULID
  from_uuid    TEXT NOT NULL,
  to_uuid      TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  UNIQUE(from_uuid, to_uuid)               -- one pending per direction
)
CREATE INDEX idx_requests_to ON friend_requests(to_uuid);
CREATE INDEX idx_requests_from ON friend_requests(from_uuid);
```

### Rate limit

10 outgoing requests per minute per `uuid`. Reject 429 over the limit.

---

## Part B — Direct Messages

### Endpoints

#### 1) `GET /messages?uuid={me}&peer={them}&since={ts?}&limit={n?}`

Return the conversation between `me` and `them`, ordered **oldest first** so the launcher can append at the bottom.

- `since` (optional, Unix ms): only messages with `sentAt > since`. Use this for poll-update — the launcher passes the timestamp of its most recent known message.
- `limit` (optional, default 100, clamp 1–500).

**200 response:**
```json
{
  "messages": [
    { "id": "msg_01H...", "from": "uuid-a", "to": "uuid-b", "body": "hi", "sentAt": 1734567890123 }
  ]
}
```

- **403** if `me` and `peer` are not friends.

#### 2) `POST /messages`

**Body:**
```json
{ "uuid": "sender-uuid", "peer": "recipient-uuid", "body": "hello" }
```

**Behavior:**
- **403** if `uuid` and `peer` are not friends.
- **400** if `body` empty or > 2000 chars.
- Sanitize: trim, reject if entirely whitespace, **strip control chars** but keep newlines.
- On success: persist with server-generated `id` and `sentAt = now`. Return **201** with the message record.

### Storage

```
messages(
  id        TEXT PRIMARY KEY,             -- ULID
  from_uuid TEXT NOT NULL,
  to_uuid   TEXT NOT NULL,
  body      TEXT NOT NULL,                -- ≤ 2000 chars
  sent_at   BIGINT NOT NULL
)
-- Query for GET /messages?uuid=A&peer=B is:
-- (from=A AND to=B) OR (from=B AND to=A), ordered by sent_at
CREATE INDEX idx_msg_pair_time ON messages(LEAST(from_uuid, to_uuid), GREATEST(from_uuid, to_uuid), sent_at);
```

If your DB doesn't have `LEAST`/`GREATEST`, use two separate indexes on `(from_uuid, to_uuid, sent_at)` and `(to_uuid, from_uuid, sent_at)`.

### Rate limit

20 messages per minute per `uuid`. Reject 429 over the limit.

### Retention (optional but recommended)

Hard-delete messages older than 90 days via a daily cron. Add this only if it's easy in your stack — otherwise skip and we'll do it later.

---

## Shared edge cases & non-goals

- **No read receipts** yet. No typing indicators. No file attachments. No group chats.
- **No push notifications.** The launcher polls.
- **No edit / delete** of messages. If a user wants a message gone, that's a moderation issue.
- **Profanity filter:** out of scope. If you must, log it for offline review — don't reject inline.
- **CORS:** match the allowlist used by the other public endpoints.

## Acceptance tests

For friend requests:
1. POST `/friends/requests` with valid `friendName` → 201, appears in sender's `outgoing` and receiver's `incoming`.
2. POST again with same names → 409.
3. Receiver POSTs `/friends/requests` back to the sender → behaves as auto-accept (200, no duplicate request created, both are now friends in `GET /friends`).
4. Accept by non-recipient → 403.
5. Reject by sender → request gone, no friendship.
6. POST 11 times in a minute → 11th returns 429.

For messages:
1. Send between non-friends → 403.
2. Send between friends → 201, appears in `GET /messages` for both sides.
3. GET with `since=` set to last message's `sentAt` → empty until a new message arrives.
4. Body > 2000 chars → 400.
5. Body with only `\n\n` → 400 (whitespace-only).
6. Send 21 in a minute → 21st returns 429.

## What to deliver

- The 6 new route handlers.
- DB migrations for `friend_requests` and `messages` tables.
- The tests above.
- README updates for both new sections.

## --- END PROMPT ---

---

## Notes for you (the launcher dev)

- IPC handlers are already wired:
  - `friends:listRequests`, `friends:sendRequest`, `friends:acceptRequest`, `friends:rejectRequest`
  - `messages:list`, `messages:send`
- The launcher's Friends page polls `/friends/requests` every 30s (same cadence as `/friends`) and polls `/messages` every 5s while a chat is open.
- Until the API ships, the Friends page works — it just shows empty lists and the "Send request" button reports an error to the user.
- The legacy `POST /friends` (direct add) IPC still exists but the UI doesn't call it. Safe to remove in a future cleanup once the request flow is verified live.
