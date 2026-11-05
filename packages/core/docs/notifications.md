# Consuming `@gitkraken/core-gitlens` notifications

How to show GitKraken notifications (the `notifications-service-v2` inbox) in a second host, such as GitKraken
Desktop or the `gk` CLI, using the `plus/notifications` subpaths of `@gitkraken/core-gitlens`.

Scope: the **client and state** for one user's notifications, filtered by a `productType`. It fetches, validates,
caches in memory and mutates (read, unread, delete, settings). It does not poll, persist, toast, render or open
links; those are the host's job (see §5). GitLens is the reference host:
[`src/plus/notifications/context.ts`](https://github.com/gitkraken/vscode-gitlens/blob/main/src/plus/notifications/context.ts)
is the adapter and
[`notificationsController.ts`](https://github.com/gitkraken/vscode-gitlens/blob/main/src/plus/notifications/notificationsController.ts)
is the lifecycle.

---

## 1. Entry points

| Subpath                                                              | Use it for                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@gitkraken/core-gitlens/plus/notifications/notificationsService.js` | `NotificationsService`: the state holder and the actions.                  |
| `@gitkraken/core-gitlens/plus/notifications/context.js`              | `NotificationsContext` (what you implement) and `NotificationsLogger`.     |
| `@gitkraken/core-gitlens/plus/notifications/models.js`               | `GkNotification`, `NotificationsState`, `NotificationsSnapshot`, settings. |
| `@gitkraken/core-gitlens/plus/notifications/presentation.js`         | Pure display and safety helpers (§6).                                      |
| `@gitkraken/core-gitlens/plus/notifications/errors.js`               | `NotificationsApiError` (§7).                                              |

Everything else (the raw API client, the parser) is internal. The package has no `vscode` or `l10n` dependency and
runs in Node and in the browser; it cannot localize, so every user-facing string is yours to produce.

## 2. Implementing `NotificationsContext`

```ts
interface NotificationsContext {
	readonly productType: string;
	fetchGkApi(path: string, init?: RequestInit, query?: URLSearchParams): Promise<Response>;
	now?(): number;
	readonly log?: NotificationsLogger;
}
```

- **`productType`**: sent as the `productType` query parameter on every list request. The package never
  hardcodes one (GitLens passes `gitlens`).
- **`fetchGkApi`**: an authenticated request against the GK API root.
  - `path` is relative, has no leading slash and **never carries a query string** (e.g. `v1/notifications`,
    `v1/notifications/user-settings`). Any query arrives separately as a `URLSearchParams`; merge it yourself.
  - A non-2xx response must be **returned, not thrown**: the package turns it into a `NotificationsApiError`.
    Throw only for transport failures.
  - Authentication is yours. The service doesn't scope notifications by organization: it lists the user's
    notifications (organization notifications are delivered to each member) whatever `gk-org-id` says.
  - The package sets only `Content-Type: application/json` plus the method and body.
- **`now`** (optional): epoch ms; defaults to `Date.now()`. A test seam.
- **`log`** (optional): `debug`, `warn` and `error` sinks. The package never logs on its own, and logs dropped
  notifications without their content.

GitLens makes these requests with `background: true`, so a failing poll never toasts an error or trips its
too-many-failures breaker. Do the equivalent if your API layer surfaces errors to the user.

## 3. Using `NotificationsService`

One service instance holds one account's notifications for one `productType`.

```ts
const service = new NotificationsService(context);
service.onDidChange(() => render(service.getState()));
```

### State

`getState()` returns `{ items, hasMore, status, lastSyncedAt, settings, unreadCount }`. `items` is newest first;
`status` is `'idle' | 'loading' | 'ready' | 'error'`; `unreadCount` counts the **loaded** items only.
`onDidChange` fires on every state change (a `void` event: re-read `getState()`).

### `refresh()`

Re-fetches every page already loaded (capped at five), so read state, deletions and expiry from elsewhere reach a
list the user paged through. Expired items are pruned and local actions still in flight are kept.

- **Never rejects.** On failure the cached items stay and `status` becomes `'error'`; check `getState().status`.
- **Resolves to the notices to toast**: the unread, toast-eligible (§6) notices that newly arrived with this
  refresh, newest first. Empty when the refresh failed, when nothing had synced before it, or when nothing is new.
- **No backfill on a first sync.** The first load for an account is the existing inbox, not news. A restored
  snapshot that has a `lastSyncedAt` counts as synced, so notices that arrived while the host was closed do toast.
- "New" means the id was not held before the refresh **and** its `createdAt` is later than the newest held one,
  less `newToastableSkewMargin` (5 minutes). Only server timestamps are compared.
- **Concurrent calls share one request and resolve to the same list.** Act on the result from exactly one place
  (your refresh loop); every other caller should ignore it, or you will toast twice.

### `loadMore()`

Loads the next page (after any refresh in flight). Concurrent calls share one request. Unlike `refresh()`, it
**rejects** on failure and leaves the loaded items as they were. A no-op when `hasMore` is false.

### Mutations

`markRead(ids)`, `markUnread(ids)`, `delete(ids)`, `markAllRead()` and `deleteAllRead()` (the last two act on
**loaded** items) apply to the state immediately and reject, after rolling back, if the request fails. A `404` is
not a failure: the server answers it only when none of the ids exist any more, so the targets are treated as
already gone and removed. A refresh that was fetching while an action ran will not undo it. Empty id lists are
no-ops.

### Settings

`getSettings()` fetches and caches `{ marketingEnabled, helpEnabled, securityEnabled }` (a flag missing from the
server counts as enabled). `updateSettings(partial)` applies optimistically and saves. The server stores the whole
object per request, so saves are serialized: at most one is in flight, and calls made meanwhile share one
follow-up request carrying the latest state. A failed save rolls back to the last acknowledged settings unless a
newer change is queued behind it, and rejects.

### Snapshots and disposal

`toSnapshot()` returns `{ items, hasMore, page, lastSyncedAt, settings }`: plain data, safe to JSON-serialize.
`restore(snapshot)` seeds a service from one, pruning expired items; it only checks that each item has a string
`id` and numeric `createdAt`, and does **not** re-validate the rest (see the CTA note in §5). `dispose()` (also
`Symbol.dispose`) disposes the change emitter; it does not cancel requests in flight.

## 4. Minimal wiring

```ts
import type { NotificationsContext } from '@gitkraken/core-gitlens/plus/notifications/context.js';
import { NotificationsService } from '@gitkraken/core-gitlens/plus/notifications/notificationsService.js';
import { isSafeExternalUrl } from '@gitkraken/core-gitlens/plus/notifications/presentation.js';

const context: NotificationsContext = {
	productType: '<your-product-type>', // the product type notifications-service-v2 targets for your host
	fetchGkApi: (path, init, query) => {
		const url = new URL(path, gkApiRoot); // path has no leading slash; gkApiRoot ends with '/'
		if (query != null) {
			url.search = query.toString();
		}
		return fetch(url, { ...init, headers: { ...init?.headers, ...authAndOrgHeaders() } }); // no throw on non-2xx
	},
	log: { warn: m => logger.warn(m), error: (ex, m) => logger.error(ex, m) },
};

const service = new NotificationsService(context);
const cached = loadCache()?.[identity]; // { snapshot, writtenAt } or undefined
if (cached != null) {
	service.restore(cached.snapshot);
}

async function poll(): Promise<void> {
	const arrived = await service.refresh(); // never rejects
	if (service.getState().status !== 'ready') return;

	for (const n of arrived) {
		await maybeToast(n); // §5: dedupe across windows, skip while the inbox is showing
	}
}
```

## 5. What the host owns

The package deliberately leaves these to you. Each item names how GitLens does it.

- **Polling.** The service never refreshes on its own. GitLens refreshes 5 seconds after starting, then every 30
  minutes, **only while the window is focused**; losing focus cancels the timer. On regaining focus it refreshes
  immediately if the last attempt (successful or failed) was 5 or more minutes ago, otherwise it waits out the rest
  of the 30 minutes, so a down service is not hit on every focus change.
- **Persistence.** Debounce `toSnapshot()` on `onDidChange` (GitLens: 1 second) and store it keyed by an
  **account id**, one entry per account, so windows (or sessions) on different accounts don't overwrite each
  other's `lastSyncedAt`. Restore only the current account's entry; otherwise
  start empty. `onDidChange` also fires for status flips on every refresh, so skip the write when the snapshot is
  unchanged (GitLens compares it serialized). GitLens keeps the 5 most recently written accounts, re-reading
  the shared entry right before each write so another window's account isn't dropped.
- **Sign-out.** Delete every persisted snapshot, so no account's notifications are left behind, and dispose the
  service.
- **Account switch.** Dispose the service and create a new one for the new account, then refresh right away. An
  organization switch needs nothing: the list doesn't depend on the active organization. Ignore the result of a
  refresh that was in flight for the replaced service: GitLens compares the service it started with to the
  current one before toasting.
- **De-duplicate toasts across windows and processes.** `refresh()` de-duplicates only within one service. GitLens
  keeps a shared `{ [notificationId]: toastedAt }` map in global storage, re-reads it right before toasting,
  records the new ids **before** showing the toast (and skips toasting if the write fails), and prunes entries older
  than 30 days.
- **Suppress toasts while an inbox UI is showing.** GitLens tracks which views show the inbox and records the
  notices as toasted but does not show them, since the user is looking at them.
- **Re-check CTA URLs.** The parser already drops a `callToAction` notice whose link is not `https:`, but
  `restore()` does not re-parse a snapshot. Call `isSafeExternalUrl(cta.url)` immediately before opening the link
  externally. GitLens also marks the notice read after opening its CTA.
- **Neutralize markdown links in toast text.** A toast is plain host UI, and some hosts render `[text](target)`
  there as a link, including command targets. GitLens breaks the syntax in server-supplied toast text
  (`text.replace(/\]\s*\(/g, '] (')`). Do the equivalent for whatever your toast API does.
- **Render bodies as untrusted markdown.** `body` and `fallback` text come from the server. GitLens renders them
  with its `gl-markdown` element in `untrusted` mode: links only for `http:`, `https:` and `mailto:` (otherwise
  just their text), images dropped, raw HTML shown as escaped text, and no theme icons. If you render markdown
  yourself, apply the same policy. That inline-link policy is looser than `isSafeExternalUrl` on purpose: a CTA
  is a prominent single-click action, so it is `https:` only.
- **Localization and layout.** Titles of toasts, chips and button labels, the `projectShared` sentence, the
  "needs a newer version" message, and relative dates are all yours.

## 6. Presentation helpers and display rules

Pure functions from `presentation.js`:

| Helper                           | What it does                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isToastEligible(n)`             | `true` only for `security` and `system` content types; everything else arrives quietly. `refresh()` already applies it.                                                                       |
| `getCategoryChip(contentType)`   | `'help'`, `'offer'` (marketing), `'security'` or `'system'`; `undefined` for `feature`.                                                                                                       |
| `isSafeExternalUrl(url)`         | `true` only for a parseable `https:` URL.                                                                                                                                                     |
| `getDisplayBody(headline, body)` | Trims the body, and drops its first paragraph when that paragraph only repeats the headline (ignoring `*`, `_`, `` ` ``, whitespace and a trailing period). `undefined` when nothing remains. |
| `toPlainText(markdown)`          | Best-effort single-line plain text (links and images reduced to their text, tags, headings, quotes, list markers and emphasis removed). Not a parser.                                         |
| `formatUnreadCount(count)`       | The count as a string, `'99+'` above 99.                                                                                                                                                      |

Display rules the model encodes:

- **Headline is the server's `title` only**, trimmed. It is never the internal `name`, which is an identifier, not
  display text. A missing `title` does not drop a notice; `headline` is simply `undefined` and you supply your own
  header.
- **`summary`** is a plain-text one-liner (`payload.desktopMessage`, else `fallback` run through `toPlainText`).
  Use it where there is no `headline`, for example a single-notice toast. Never markdown-render it.
- **`body`** is markdown, or `undefined` for `projectShared`.
- **`projectShared`** carries `{ organization, owner, project, teams }` and no body: assemble the sentence
  yourself (GitLens: "In {organization}, {owner} created a new Team Workspace: {project}", plus the teams when
  there are any).
- **`needsNewerVersion`** is set when the event is one this package does not know. It is then shown through its
  `fallback` text as `body`, and `event` is `'unknown'`. Use the flag to prompt the user to update. An unknown event
  with no `fallback` is dropped. An unknown `contentType` is treated as `feature` (no chip, no toast).
- **`cta`** exists only for `callToAction` notices and its `url` is always `https:`.

## 7. Classifying errors

Mutations and `loadMore()` reject with `NotificationsApiError`; `refresh()` never does (it logs through
`context.log` instead).

```ts
import { NotificationsApiError } from '@gitkraken/core-gitlens/plus/notifications/errors.js';

try {
	await service.markRead([id]);
} catch (ex) {
	if (NotificationsApiError.is(ex)) {
		// ex.status: the HTTP status; ex.operation: 'list' | 'markRead' | 'markUnread' | 'delete'
		//            | 'getSettings' | 'updateSettings'
	}
}
```

`status` is the response status, including for a 2xx response whose body is not valid JSON (the `cause` then holds
the parse error). `operation` names the request. `message` is for logs, not for display; show your own
localized text. Transport failures from your `fetchGkApi` propagate as whatever you threw.
