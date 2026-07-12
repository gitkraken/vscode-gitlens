import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionCategory, StickyDetailResolver } from '../../../shared/agentUtils.js';
import {
	agentPhaseToCategory,
	createStickyDetailResolver,
	describeAgentSession,
	formatAgentElapsed,
	fpField,
	getAgentPhaseLabel,
	permissionFingerprint,
	sortAgentSessions,
} from '../../../shared/agentUtils.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphStateContext } from '../context.js';
import '../../../shared/components/badges/badge.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/hooks-banner.js';
import '../../../shared/components/overlays/tooltip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-kanban': GlGraphKanban;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-kanban-close': CustomEvent<void>;
		/** Card click: target session's worktree WIP. `commonPath` is the session's owning-repo
		 *  common path — required by the host to encode the right primary/secondary WIP sha when the
		 *  session belongs to a different repo than the graph's currently-selected one. */
		'gl-graph-kanban-open-session': CustomEvent<{
			worktreePath: string | undefined;
			commonPath: string | undefined;
			sessionId: string;
		}>;
	}
}

/** Low-frequency refresh interval so the column buckets (idle → inactive) and the elapsed
 *  labels ('Working · 5m') stay live. Without this the kanban renders a frozen snapshot once
 *  agentSessions stops pushing — sessions never cross the 60-min inactiveThresholdMs without an
 *  unrelated signal change. 30s strikes a balance between liveness and re-render churn for a
 *  view that's often left open across long agent runs. */
const liveTickIntervalMs = 30 * 1000;

/** Buckets a session is placed in. `inactive` is a time-derived split of `idle` — the live
 *  AgentSessionPhase has no such state, so the kanban derives it from `lastActivity`. */
type KanbanColumnId = 'needs-input' | 'working' | 'idle' | 'inactive';

interface KanbanColumnDef {
	readonly id: KanbanColumnId;
	readonly label: string;
}

/** Sessions whose phase is idle AND haven't ticked an activity event in this many ms drop into
 *  the Inactive column. 60 minutes keeps short coffee breaks in Idle while genuinely abandoned
 *  sessions surface as Inactive without further user action. */
const inactiveThresholdMs = 60 * 60 * 1000;

const columns: readonly KanbanColumnDef[] = [
	{ id: 'needs-input', label: 'Needs Input' },
	{ id: 'working', label: 'Working' },
	{ id: 'idle', label: 'Idle' },
	{ id: 'inactive', label: 'Inactive' },
];

function columnIdForSession(session: AgentSessionState): KanbanColumnId {
	if (session.phase === 'waiting' || session.pendingPermission != null) return 'needs-input';

	if (session.phase === 'working') return 'working';

	const last = session.lastActivity.getTime();
	if (Number.isFinite(last) && Date.now() - last > inactiveThresholdMs) return 'inactive';

	return 'idle';
}

function sessionSubtitle(session: AgentSessionState): string | undefined {
	const wt = session.worktree;
	if (wt == null) return undefined;

	return wt.branch?.name ?? wt.name ?? wt.path.split('/').pop();
}

@customElement('gl-graph-kanban')
export class GlGraphKanban extends SignalWatcher(LitElement) {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				width: 100%;
				height: 100%;
				min-height: 0;
				color: var(--vscode-foreground);
				background-color: var(--vscode-editor-background);
				--gl-kanban-card-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
				--gl-kanban-card-border: var(--vscode-panel-border, transparent);
				--gl-kanban-column-gap: 1.2rem;
				--gl-kanban-card-radius: var(--gl-radius-sm);
			}

			/* Section is a flex column so the header stays auto-sized at the top and the body
	   gets the remaining height (via flex: 1 / min-height: 0). Without this, <section>'s
	   default block layout produces a content-sized body that never overflows — both the
	   horizontal column scroll and the per-column vertical scroll silently disappear. */
			section {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				width: 100%;
				min-height: 0;
			}

			.header {
				display: flex;
				flex: none;
				gap: var(--gl-space-8);
				align-items: center;
				min-height: 3.2rem;

				/* 0.6rem right so the close button sits at a tight inset matching the visualizations
		 * toolbar; left stays at 1.2rem for the title's breathing room. min-height + tight
		 * vertical padding matches the Treemap/Visual History toolbar height (3.2rem). */
				padding: var(--gl-space-4) var(--gl-space-6) var(--gl-space-4) var(--gl-space-12);
				border-bottom: var(--gl-border-width) solid var(--vscode-panel-border, transparent);
			}

			.header__title {
				display: flex;
				gap: var(--gl-space-8);
				align-items: baseline;
				font-size: var(--gl-font-base);
				font-weight: 600;
			}

			.header__title h2 {
				padding: 0;
				margin: 0;
				font: inherit;
				font-size: var(--gl-font-sm);
				font-weight: 600;
				text-transform: uppercase;
				white-space: nowrap;
			}

			.header__count {
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65);
			}

			/* Experimental stamp uses the shared gl-badge with appearance=experimental. Sits inside
	   .header__title, between the title h2 and the session count, signalling that the whole
	   view (not just one control) is experimental. */
			.header__experimental gl-badge {
				--gl-badge-font-size: 0.95rem;
			}

			.header__close {
				margin-left: auto;
			}

			.hooks-banner {
				/* No bottom margin — .body below has its own 1.2rem padding-top, so an extra
		 * margin-bottom here would double up to 2.4rem of visual gap. */
				display: block;
				margin: var(--gl-space-12) var(--gl-space-12) 0;
			}

			.body {
				display: grid;
				flex: 1 1 auto;
				grid-auto-columns: minmax(24rem, 1fr);
				grid-auto-flow: column;
				gap: var(--gl-kanban-column-gap);
				min-height: 0;
				padding: var(--gl-space-12);
				overflow: auto hidden;

				/* Hint to the browser to GPU-composite the scrolling layer. Without this, horizontal
		   scroll of the kanban body forces a full document repaint per frame; with it the
		   browser can scroll the existing layer's painted bitmap. */
				will-change: scroll-position;
			}

			.column {
				display: flex;
				flex-direction: column;
				min-height: 0;

				/* Paint isolation: confine column-internal repaints (card hover/scroll) so the
		   browser doesn't re-layout the whole kanban body when one column scrolls or a
		   card hover-state changes. contain:content enables layout, paint, and style
		   containment but keeps the column's intrinsic size correct (no size). */
				contain: content;
				overflow: hidden;
				background-color: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
				border: var(--gl-border-width) solid var(--gl-kanban-card-border);
				border-radius: var(--gl-kanban-card-radius);
			}

			.column__heading {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: var(--gl-space-8) var(--gl-space-10);
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--color-foreground--65);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				border-bottom: var(--gl-border-width) solid var(--gl-kanban-card-border);
			}

			.column__heading[data-column='needs-input'] {
				color: var(--gl-agent-waiting-color);
			}

			.column__heading[data-column='working'] {
				color: var(--gl-agent-working-color);
			}

			.column__heading-label {
				padding: 0;
				margin: 0;
				font: inherit;
			}

			.column__count {
				margin-left: auto;
				font-size: var(--gl-font-micro);
				font-weight: 400;
				color: var(--color-foreground--65);
				text-transform: none;
				letter-spacing: 0;
			}

			.column__list {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				gap: var(--gl-space-8);
				min-height: 0;
				padding: var(--gl-space-8);
				overflow-y: auto;

				/* Same GPU-composite hint as the body. Each column scrolls independently when its
		   card list overflows; promoting the layer keeps per-column vertical scroll smooth. */
				will-change: scroll-position;
			}

			.column__empty {
				padding: var(--gl-space-4) var(--gl-space-2);
				font-size: var(--gl-font-sm);
				font-style: italic;
				color: var(--color-foreground--50);
			}

			.card {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				padding: 0.9rem 1rem;

				/* Paint isolation: card hover (border-color + color-mix background change) repaints
		   only this card's box, not its column or siblings. Without it, hover transitions
		   thrashed visibly on scroll because the browser would re-evaluate paint regions
		   across the column. */
				contain: layout style paint;
				font: inherit;
				color: inherit;
				text-align: left;
				appearance: none;
				cursor: pointer;
				background-color: var(--gl-kanban-card-bg);
				border: var(--gl-border-width) solid var(--gl-kanban-card-border);
				border-radius: var(--gl-kanban-card-radius);
				box-shadow: 0 1px 0 rgb(0 0 0 / 6%);
			}

			.card:hover {
				background-color: var(--vscode-list-hoverBackground, var(--gl-kanban-card-bg));
				border-color: var(--vscode-focusBorder, var(--gl-kanban-card-border));
			}

			.card:focus-visible {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.card[data-column='needs-input'] {
				border-left: 2px solid var(--gl-agent-waiting-color);
			}

			.card[data-column='working'] {
				border-left: 2px solid var(--gl-agent-working-color);
			}

			.card[data-column='idle'] {
				border-left: 2px solid var(--gl-agent-idle-color);
			}

			.card[data-column='inactive'] {
				border-left: 2px solid color-mix(in srgb, var(--gl-agent-idle-color) 50%, transparent);
			}

			.card__head {
				display: flex;
				gap: var(--gl-space-6);
				align-items: baseline;
				justify-content: space-between;
			}

			.card__title {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: var(--gl-font-md);
				font-weight: 600;
				white-space: nowrap;
			}

			.card__phase {
				font-size: var(--gl-font-micro);
				font-weight: 500;
				color: var(--color-foreground--65);
				white-space: nowrap;
			}

			.card[data-column='needs-input'] .card__phase {
				color: var(--gl-agent-waiting-color);
			}

			.card[data-column='working'] .card__phase {
				color: var(--gl-agent-working-color);
			}

			/* 2nd row: subtitle on the left, Open Session icon button on the right. Always laid out
	   even when the subtitle is missing so the Open Session stays visually anchored. */
			.card__sub-row {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				justify-content: space-between;
				min-height: 1.8rem;
			}

			.card__subtitle {
				flex: 1 1 auto;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: var(--gl-font-micro);
				color: var(--color-foreground--65);
				white-space: nowrap;
			}

			.card__open {
				flex: none;
			}

			.card__detail {
				display: -webkit-box;
				overflow: hidden;
				-webkit-line-clamp: 3;
				font-size: var(--gl-font-sm);
				line-height: 1.4;
				color: var(--vscode-foreground);
				-webkit-box-orient: vertical;
			}

			.card__actions {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				justify-content: flex-end;
				margin-top: var(--gl-space-2);
			}

			/* Permission actions (Allow / Deny / View Plan) cluster on the left when present;
	   margin-right: auto pushes Open Session — the trailing child — to the far right. When
	   no permission is pending, Open Session is alone and flex-end already right-aligns it. */
			.card__permission-actions {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-4);
				align-items: center;
				margin-right: auto;
			}

			.card__actions gl-button {
				--button-padding: 0 0.8rem;
			}

			.empty-state {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				gap: var(--gl-space-6);
				align-items: center;
				justify-content: center;
				padding: var(--gl-space-20);
				color: var(--color-foreground--65);
				text-align: center;
			}

			.empty-state code-icon {
				font-size: 2.4rem;
				color: var(--color-foreground--50);
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	/** Periodic re-render driver. Connected on `connectedCallback`, cleared on disconnect so we
	 *  don't leak intervals across hot-reloads or component re-mounts. Drives `columnIdForSession`
	 *  and `formatAgentElapsed` to re-evaluate against the wall clock — without this, sessions
	 *  never migrate idle → inactive and elapsed labels stay frozen across long quiet stretches. */
	private _liveTickHandle?: ReturnType<typeof setInterval>;

	/** Memoized derived view: sorted + bucketed sessions. The host pushes a fresh `agentSessions`
	 *  array reference on every per-session delta (status, prompt, phase) — even when no card
	 *  actually changes column. Re-running `sortAgentSessions` (O(n log n)) and the bucketing pass
	 *  (O(n) plus per-session `columnIdForSession` clock reads) on every render contributes
	 *  noticeably to hover/scroll jank when sessions push often. Cache by the array identity AND
	 *  a coarse 10-second wall-clock bucket so the bucketing stays live across the inactive
	 *  threshold without invalidating on every tick. */
	private _bucketsCache?: {
		sessionsRef: readonly AgentSessionState[];
		clockBucket: number;
		sorted: AgentSessionState[];
		buckets: Map<KanbanColumnId, AgentSessionState[]>;
	};

	/** Monotonically-increasing tick counter mixed into {@link computeFingerprint} so the periodic
	 *  live-tick deterministically invalidates the no-op-render guard once per interval — without
	 *  it, `shouldUpdate` would short-circuit the tick (session content is unchanged across the
	 *  tick) and elapsed labels / idle→inactive bucket flips would freeze. The host's
	 *  agentSessions pushes don't increment this; they change `agentSessions` content, which the
	 *  fingerprint already detects on its own. */
	private _tickGeneration = 0;

	/** Last rendered fingerprint — see {@link computeFingerprint}. Compared in `shouldUpdate` to
	 *  skip renders for no-op host pushes (same sessions, identical visible fields). Captured in
	 *  `update` so a `shouldUpdate=true` result always corresponds to a real render, even if
	 *  exceptions later abort the cycle. */
	private _lastFingerprint?: string;

	/** Sticky "current tool call" resolver shared with the details panel — see
	 *  {@link createStickyDetailResolver}. Hides the brief inter-tool-call flicker where
	 *  `session.statusDetail` empties before the next tool latches, by holding the last live tool
	 *  detail for the resolver's default 3s window. Permission detail lines are not stickified —
	 *  they reflect a steady state rather than a stream of events. */
	private readonly _stickyResolver: StickyDetailResolver = createStickyDetailResolver();

	private buildBuckets(sessions: readonly AgentSessionState[]): {
		sorted: AgentSessionState[];
		buckets: Map<KanbanColumnId, AgentSessionState[]>;
	} {
		// 10s coarse clock bucket — re-runs the bucketing at most once per 10s independent of the
		// 30s tick, which is enough granularity for idle → inactive transitions (60-min threshold)
		// without rebucketing on every signal push.
		const clockBucket = Math.floor(Date.now() / 10_000);
		const cache = this._bucketsCache;
		if (cache?.sessionsRef === sessions && cache?.clockBucket === clockBucket) {
			return { sorted: cache.sorted, buckets: cache.buckets };
		}

		const sorted = sortAgentSessions(sessions);
		const buckets = new Map<KanbanColumnId, AgentSessionState[]>();
		for (const session of sorted) {
			const column = columnIdForSession(session);
			const list = buckets.get(column);
			if (list != null) {
				list.push(session);
			} else {
				buckets.set(column, [session]);
			}
		}
		this._bucketsCache = { sessionsRef: sessions, clockBucket: clockBucket, sorted: sorted, buckets: buckets };

		// Drop sticky-detail entries for sessions no longer in the live set. Cheap to do here
		// because we already have `sorted` in hand; only runs on cache-miss (i.e., once per push
		// where the array reference changes), so the prune frequency stays bounded.
		if (this._stickyResolver.size > 0) {
			this._stickyResolver.prune(sorted.map(s => s.id));
		}

		return { sorted: sorted, buckets: buckets };
	}

	/** Build a stable string capturing every field the kanban actually renders, plus the live-tick
	 *  generation. Identical fingerprint between two reactive pushes → no visible change → skip
	 *  the render entirely via {@link shouldUpdate}. The host fires `DidChangeAgentSessionsNotification`
	 *  on every Claude Code event (multiple per second during active work) with a fresh array
	 *  reference; many of those carry no meaningful diff for the kanban — same phase, same tool
	 *  call, same prompt — and we'd otherwise pay a full Lit render-and-diff for each one.
	 *
	 *  Fields included reflect what `renderCard` consumes — this is the canonical declaration of
	 *  "every per-session input the kanban paints from":
	 *  - `id`, `phase`, `displayName` — identity and column-assignment inputs
	 *  - `status`, `statusDetail` — current-tool-call surface used by sticky detail
	 *  - `lastPrompt` — fallback detail line
	 *  - `worktree.{branch.name|name|path}` — subtitle source (resolved in `sessionSubtitle`)
	 *  - `phaseSince` (ms) — elapsed-label source; transitions also bust the sticky cache
	 *  - `lastActivity` bucketed to 60s — only matters for the 60-min idle→inactive flip;
	 *    finer-grained changes don't affect the rendered output, so coarsening saves churn.
	 *  - `pendingPermission` — encoded by {@link permissionFingerprint} so every needs-input
	 *    variant's renderable fields (plan summary/file, question text/count, tool name/desc, …)
	 *    contribute, not just the kind/toolName pair the early version captured.
	 *
	 *  Adding a new rendered field requires extending this fingerprint (or {@link permissionFingerprint}
	 *  for permission-typed fields) or the kanban will silently fail to update when only that
	 *  field changes. */
	private computeFingerprint(sessions: readonly AgentSessionState[]): string {
		const parts: string[] = [`t${this._tickGeneration}`];
		for (const s of sessions) {
			const subtitle = s.worktree?.branch?.name ?? s.worktree?.name ?? s.worktree?.path ?? '';
			parts.push(
				`${s.id}|${s.phase}|${fpField(s.status)}|${fpField(s.statusDetail)}|${fpField(s.displayName)}|${fpField(s.lastPrompt)}|${fpField(subtitle)}|${s.phaseSince.getTime()}|${Math.floor(s.lastActivity.getTime() / 60000)}|${permissionFingerprint(s.pendingPermission)}`,
			);
		}
		return parts.join('\n');
	}

	override shouldUpdate(_changedProps: PropertyValues): boolean {
		const fingerprint = this.computeFingerprint(this.graphState.agentSessions ?? []);
		if (this._lastFingerprint === fingerprint) {
			return false;
		}

		return true;
	}

	override update(changedProps: PropertyValues): void {
		// Capture the fingerprint AFTER `super.update()` (which runs `render()`). If a render
		// throws — bad session shape, template-binding error, getter exception — we want the next
		// push with the same inputs to retry rather than be silently de-duped against the failed
		// fingerprint. Storing before `super.update()` would advance `_lastFingerprint` to the
		// just-failed inputs and lock the kanban on whatever paint survived.
		super.update(changedProps);
		this._lastFingerprint = this.computeFingerprint(this.graphState.agentSessions ?? []);
	}

	/** Impression telemetry — point-in-time snapshot, fired once per mount (the component mounts
	 *  only while Kanban is the active display mode and remounts per activation, so first-render is
	 *  one impression). `agentSessions` is a signal initialized to `[]` and populated asynchronously,
	 *  so on a fast toggle before the first push the counts below may all read 0 and later arrivals
	 *  do NOT re-fire — treat them as "what was visible at open", not a settled total. Mirrors the
	 *  agents sidebar's `emitAgentsShownTelemetry` semantics (the same signal makes "not loaded" and
	 *  "loaded but empty" indistinguishable, so deferring — as the treemap does on `data.root` — isn't
	 *  possible here). */
	protected override firstUpdated(): void {
		const sessions = this.graphState.agentSessions ?? [];
		const { buckets } = this.buildBuckets(sessions);
		emitTelemetrySentEvent<'graph/kanban/shown'>(this, {
			name: 'graph/kanban/shown',
			data: {
				'sessions.count': sessions.length,
				'sessions.working.count': buckets.get('working')?.length ?? 0,
				'sessions.needsInput.count': buckets.get('needs-input')?.length ?? 0,
				'sessions.idle.count': buckets.get('idle')?.length ?? 0,
				'sessions.inactive.count': buckets.get('inactive')?.length ?? 0,
			},
		});
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._liveTickHandle = setInterval(() => {
			// Increment the generation BEFORE requesting the update — `shouldUpdate` reads it via
			// `computeFingerprint`, so the new value must already be set when the lifecycle picks
			// up. Without the increment, the fingerprint would be identical to the previous render
			// and the tick would no-op, leaving elapsed labels stale.
			this._tickGeneration++;
			this.requestUpdate();
		}, liveTickIntervalMs);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		if (this._liveTickHandle != null) {
			clearInterval(this._liveTickHandle);
			this._liveTickHandle = undefined;
		}
	}

	private onClose = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-kanban-close', { bubbles: true, composed: true }));
	};

	/** Card click handler bound ONCE per component, identified via `data-session-id` on the card.
	 *  Per-card inline arrows (`@click=${(e) => this.onCardClick(session, e)}`) would recreate ~N
	 *  closures every render; Lit's event-binding diff then removes+rebinds them all, which
	 *  noticeably contributes to scroll/hover jank when SignalWatcher drives frequent re-renders
	 *  on agentSessions deltas. Stable references mean Lit reuses the same listener across renders. */
	private onCardClick = (event: Event): void => {
		const card = (event.currentTarget as HTMLElement | null) ?? null;
		const sessionId = card?.dataset.sessionId;
		if (sessionId == null) return;

		// Skip clicks that originated on ANY action button inside the card — they have their own
		// command links and should not also trigger the card-level WIP-open. `closest('gl-button')`
		// catches Open Session (in `.card__sub-row`) AND the permission actions (`.card__actions`),
		// regardless of which subtree they live in — so layout changes can't silently regress the
		// guard the way `closest('.card__actions')` did when Open Session moved to the sub-row.
		// The buttons handle their own activation (command links); this delegated listener only
		// observes the composed click for telemetry — one listener instead of per-render closures.
		const target = event.target as HTMLElement | null;
		const actionButton = target?.closest<HTMLElement>('gl-button');
		if (actionButton != null) {
			this.emitCardActionTelemetry(actionButton, sessionId);
			return;
		}

		const session = (this.graphState.agentSessions ?? []).find(s => s.id === sessionId);
		if (session == null) return;

		const repo = this.effectiveRepo;
		const family = repo == null ? undefined : (repo.commonPath ?? repo.path);
		emitTelemetrySentEvent<'graph/kanban/sessionSelected'>(this, {
			name: 'graph/kanban/sessionSelected',
			data: {
				'session.phase': session.phase,
				'session.category': agentPhaseToCategory[session.phase],
				'session.hasPendingPermission': session.pendingPermission != null,
				// Same repo-family comparison the open-session gate in graph-app applies — a
				// cross-repo card click is a no-op there, so this flag explains "dead" clicks.
				'session.sameRepo': family != null && session.commonPath === family,
				// Prefer the rendered card's column — recomputing via `columnIdForSession` could
				// disagree with what the user actually saw (idle → inactive is a time threshold).
				column: (card?.dataset.column as KanbanColumnId | undefined) ?? columnIdForSession(session),
			},
		});

		this.dispatchEvent(
			new CustomEvent('gl-graph-kanban-open-session', {
				detail: {
					worktreePath: session.worktreePath,
					commonPath: session.commonPath,
					sessionId: session.id,
				},
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Telemetry for the card's inner action buttons, identified by `data-telemetry-action` —
	 *  static attributes instead of per-button click closures (see `onCardClick`'s perf note). */
	private emitCardActionTelemetry(button: HTMLElement, sessionId: string): void {
		switch (button.dataset.telemetryAction) {
			case 'open-session':
				emitTelemetrySentEvent<'graph/kanban/sessionAction'>(this, {
					name: 'graph/kanban/sessionAction',
					data: { action: 'openSession' },
				});
				break;

			case 'open-plan':
				emitTelemetrySentEvent<'graph/kanban/sessionAction'>(this, {
					name: 'graph/kanban/sessionAction',
					data: { action: 'openPlanFile' },
				});
				break;

			case 'permission-allow':
			case 'permission-deny': {
				const session = (this.graphState.agentSessions ?? []).find(s => s.id === sessionId);
				emitTelemetrySentEvent<'graph/kanban/permissionResolved'>(this, {
					name: 'graph/kanban/permissionResolved',
					data: {
						decision: button.dataset.telemetryAction === 'permission-allow' ? 'allow' : 'deny',
						'permission.kind': session?.pendingPermission?.kind ?? 'unknown',
					},
				});
				break;
			}
		}
	}

	/** Resolves the graph's selected repo exactly as the open-session gate does
	 *  (`GraphApp.fallbackRepoFamily`): a stale/unmatched `selectedRepository` resolves to
	 *  `undefined` (NO `?? repos[0]` fallback), so `session.sameRepo` can't report `true` for a
	 *  click the gate would reject — the flag exists to explain those dead clicks. */
	private get effectiveRepo() {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		return repoId != null ? repos?.find(r => r.id === repoId) : repos?.[0];
	}

	private onCardKeydown = (event: KeyboardEvent): void => {
		// Enter and Space activate the card as an "open WIP details" affordance, matching the
		// implicit semantics that `<button>` would provide — we use `<div role="button">` to avoid
		// nesting interactive descendants (gl-button) inside a real <button>, which is invalid HTML5.
		if (event.key !== 'Enter' && event.key !== ' ') return;

		// Don't swallow keystrokes targeting inner action buttons — those manage their own
		// activation. `closest('gl-button')` catches the gl-button host even when the event
		// originated inside its shadow DOM and was retargeted to the host.
		const target = event.target as HTMLElement | null;
		if (target?.closest('gl-button') != null) return;

		event.preventDefault();
		this.onCardClick(event);
	};

	override render(): unknown {
		const rawSessions = this.graphState.agentSessions ?? [];
		const { sorted: sessions, buckets: sessionsByColumn } = this.buildBuckets(rawSessions);

		return html`
			<section aria-label="Agent Kanban">
				<div class="header">
					<div class="header__title">
						<h2>Agent Kanban</h2>
						<gl-tooltip
							class="header__experimental"
							placement="bottom"
							content="This is an experimental feature"
							.distance=${6}
						>
							<gl-badge appearance="experimental" aria-label="Experimental feature">EXP</gl-badge>
						</gl-tooltip>
						<span class="header__count" aria-live="polite"
							>${sessions.length} session${sessions.length === 1 ? '' : 's'}</span
						>
					</div>
					<gl-button
						class="header__close"
						appearance="toolbar"
						tooltip="Show Commit Graph"
						aria-label="Show Commit Graph"
						@click=${this.onClose}
					>
						<code-icon icon="close"></code-icon>
					</gl-button>
				</div>
				${(this.graphState.canInstallClaudeHook ?? false) && !(this.graphState.hooksBannerCollapsed ?? true)
					? html`<gl-hooks-banner
							class="hooks-banner"
							source="graph-kanban"
							layout="responsive"
						></gl-hooks-banner>`
					: nothing}
				${sessions.length === 0 ? this.renderEmpty() : this.renderColumns(sessionsByColumn)}
			</section>
		`;
	}

	private renderEmpty() {
		return html`<div class="empty-state">
			<code-icon icon="robot"></code-icon>
			<p>No active agent sessions.</p>
			<p>Start an agent on a worktree to see it appear here.</p>
		</div>`;
	}

	private renderColumns(sessionsByColumn: ReadonlyMap<KanbanColumnId, readonly AgentSessionState[]>) {
		// `aria-live="polite"` on the columns container so screen-reader users hear an announcement
		// when sessions migrate buckets (Working → Needs Input on a permission prompt, Idle →
		// Inactive past the 60-min threshold). `polite` defers to natural pauses so the announcement
		// doesn't interrupt the user mid-action.
		return html`<div class="body scrollable" aria-live="polite" aria-atomic="false">
			${repeat(
				columns,
				c => c.id,
				c => this.renderColumn(c, sessionsByColumn.get(c.id) ?? []),
			)}
		</div>`;
	}

	private renderColumn(column: KanbanColumnDef, sessions: readonly AgentSessionState[]) {
		const headingId = `kanban-column-heading-${column.id}`;
		return html`<section class="column" aria-labelledby=${headingId}>
			<header class="column__heading" data-column=${column.id} id=${headingId}>
				<h3 class="column__heading-label">${column.label}</h3>
				<span
					class="column__count"
					aria-label=${`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
					>${sessions.length}</span
				>
			</header>
			<div class="column__list scrollable">
				${sessions.length === 0
					? html`<p class="column__empty">Nothing here</p>`
					: repeat(
							sessions,
							s => s.id,
							s => this.renderCard(s, column.id),
						)}
			</div>
		</section>`;
	}

	private renderCard(session: AgentSessionState, columnId: KanbanColumnId) {
		const category: AgentSessionCategory = agentPhaseToCategory[session.phase];
		const elapsed = formatAgentElapsed(session.phaseSince);
		const phaseLabel = getAgentPhaseLabel(category, session.pendingPermission);
		const subtitle = sessionSubtitle(session);
		const detail = this.resolveStickyDetail(session, category, elapsed);

		// Use a `<div role="button" tabindex="0">` rather than a native `<button>` so we can host
		// interactive descendants (gl-button for Open Session / Allow / Deny / View Plan) without
		// nesting <button> inside <button> — which is invalid HTML and produces inconsistent
		// activation, focus, and screen-reader behavior across browsers. `aria-label` carries the
		// accessible name (display name + phase) so AT users get a single coherent announcement
		// before tabbing into the inner actions.
		const ariaLabel = `${session.displayName} — ${phaseLabel}${elapsed != null ? ` (${elapsed})` : ''}`;
		return html`<div
			class="card"
			role="button"
			tabindex="0"
			data-column=${columnId}
			data-session-id=${session.id}
			aria-label=${ariaLabel}
			@click=${this.onCardClick}
			@keydown=${this.onCardKeydown}
		>
			<div class="card__head">
				<gl-tooltip content=${session.displayName}
					><span class="card__title">${session.displayName}</span></gl-tooltip
				>
				<span class="card__phase">${phaseLabel}${elapsed != null ? ` · ${elapsed}` : ''}</span>
			</div>
			<div class="card__sub-row">
				${subtitle != null
					? html`<span class="card__subtitle">${subtitle}</span>`
					: html`<span class="card__subtitle"></span>`}
				<gl-button
					class="card__open"
					appearance="toolbar"
					tooltip="Open Session"
					data-telemetry-action="open-session"
					href=${createCommandLink('gitlens.agents.openSession', JSON.stringify(session.id))}
				>
					<code-icon icon="link-external"></code-icon>
				</gl-button>
			</div>
			<p class="card__detail">${detail}</p>
			${this.renderPermissionActions(session)}
		</div>`;
	}

	/** Card detail line resolver. The flickery surface (current tool call while
	 *  `working + tool_use`) goes through {@link _stickyResolver}; everything else flows through
	 *  the same fallback chain the kanban shipped with — `describeAgentSession` for needs-input
	 *  and idle, with `lastPrompt` ahead of the elapsed clock so idle cards keep showing the
	 *  most informative content. */
	private resolveStickyDetail(
		session: AgentSessionState,
		category: AgentSessionCategory,
		elapsed: string | undefined,
	): string {
		if (category === 'needs-input' && session.pendingPermission != null) {
			// Evict any prior working-phase entry. The needs-input branch bypasses
			// `resolveLiveTool` (the only call site that evicts on phase change), so without this
			// explicit eviction a session that goes working+tool_use → needs-input → working
			// (permission resolved) would briefly re-render the PRE-permission tool detail from
			// the still-fresh sticky cache, even though the agent has moved on.
			this._stickyResolver.evict(session.id);
			return (
				describeAgentSession(session, category, elapsed, {
					awaitingPrefix: 'short',
					idleFallback: 'lastPrompt',
				}) ??
				session.lastPrompt ??
				'No recent activity'
			);
		}

		const stickyTool = this._stickyResolver.resolveLiveTool(session);
		if (stickyTool != null) return stickyTool;

		const live = describeAgentSession(session, category, elapsed, {
			awaitingPrefix: 'short',
			idleFallback: 'none',
		});
		return (
			live ??
			session.lastPrompt ??
			(elapsed != null ? `Last active ${elapsed} ago` : undefined) ??
			'No recent activity'
		);
	}

	private renderPermissionActions(session: AgentSessionState) {
		const permission = session.pendingPermission;
		if (permission == null) return nothing;

		const isPlan = permission.kind === 'plan';
		return html`<div class="card__actions">
			<div class="card__permission-actions">
				<gl-button
					appearance="secondary"
					density="compact"
					tooltip=${isPlan ? 'Approve Plan' : 'Allow'}
					data-telemetry-action="permission-allow"
					href=${createCommandLink('gitlens.agents.resolvePermission', {
						sessionId: session.id,
						decision: 'allow' as const,
					})}
				>
					<code-icon icon="check"></code-icon>
					${isPlan ? 'Approve' : 'Allow'}
				</gl-button>
				<gl-button
					appearance="secondary"
					density="compact"
					tooltip=${isPlan ? 'Reject Plan' : 'Deny'}
					data-telemetry-action="permission-deny"
					href=${createCommandLink('gitlens.agents.resolvePermission', {
						sessionId: session.id,
						decision: 'deny' as const,
					})}
				>
					<code-icon icon="x"></code-icon>
					${isPlan ? 'Reject' : 'Deny'}
				</gl-button>
				${isPlan && permission.planFilePath != null
					? html`<gl-button
							appearance="toolbar"
							tooltip="View Plan"
							data-telemetry-action="open-plan"
							href=${createCommandLink(
								'gitlens.agents.openPlanFile',
								JSON.stringify(permission.planFilePath),
							)}
						>
							<code-icon icon="tasklist"></code-icon>
						</gl-button>`
					: nothing}
			</div>
		</div>`;
	}
}
