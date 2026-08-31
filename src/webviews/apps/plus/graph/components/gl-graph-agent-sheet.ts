import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { focusOutlineButton } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { basename } from '@gitlens/utils/path.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	AgentSessionWorktreeState,
	PastAgentSessionDetail,
	PastAgentSessionState,
} from '../../../../../agents/models/agentSessionState.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import { notifyService } from '../../../shared/actions/rpc.js';
import type { AgentSessionCategory, StickyDetailResolver } from '../../../shared/agentUtils.js';
import {
	agentPhaseToCategory,
	agentProviderIcon,
	canResolvePermission,
	createAgentSessionArchiveHref,
	createAgentSessionOpenHref,
	createStickyDetailResolver,
	describeAgentSession,
	formatAgentElapsed,
	getAgentCategoryLabel,
	getAgentPhaseLabel,
	getAgentProviderLabel,
	getAgentSessionOpenAction,
} from '../../../shared/agentUtils.js';
import type { TreeItemBase, TreeItemSelectionDetail, TreeModel } from '../../../shared/components/tree/base.js';
import { folderToTreeModel, sortTreeChildren } from '../../../shared/components/tree/file-tree-utils.js';
import { graphServicesContext } from '../context.js';
import { SheetWrapper } from './sheetWrapper.js';
import '@gitlens/components/components/agentMark.js';
import '../../../shared/components/agents/gl-agent-prompt-detail.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/button.js';
import '../../../shared/components/chips/action-chip.js';
import '@gitlens/components/components/codeIcon.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '@gitlens/components/components/overlays/tooltip.js';
import '../../../shared/components/tree/tree-view.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-agent-sheet': GlGraphAgentSheet;
	}

	interface GlobalEventHandlersEventMap {
		/** A location chip (header current-location row, or an "Also worked in" history row) was
		 *  activated — the graph jumps to that worktree/branch's row if one is currently rendered.
		 *  Reveal-only: never scopes/focuses the graph, just navigates. */
		'gl-graph-reveal-location': CustomEvent<{ worktreePath?: string; branchName?: string; upstreamName?: string }>;
		/** The header's up/down chevrons — the panel swaps the sheet to the previous/next session in
		 *  the agents section's card order, in place. */
		'gl-agent-session-cycle': CustomEvent<{ direction: -1 | 1 }>;
	}
}

type FileActivityEntry = NonNullable<AgentSessionState['fileActivity']>[number];

/** One gl-tree-item row's layout height in px (measured live) — verify against the tree's row CSS
 *  if it drifts. */
const fileActivityRowHeight = 22;

interface FileActivityRow {
	readonly path: string;
	readonly kind: 'edit' | 'read';
	readonly live: boolean;
	/** Sort key — 0 for a live (in-flight) entry, elapsed ms otherwise. Ascending = most recent first. */
	readonly ageMs: number;
	readonly verb: string;
	readonly ageLabel: string;
}

/** A {@link FileActivityRow} once relativized against the session's family roots — see
 *  {@link GlGraphAgentSheet.resolveFileActivityRow}. `rootPath` is the root the row resolved
 *  against (`undefined` when the absolute path fell outside every known root — in which case
 *  `treePath` is just the absolute path and the row isn't openable). */
interface ResolvedFileActivityRow extends FileActivityRow {
	readonly rootPath: string | undefined;
	readonly treePath: string;
}

/** Convert an absolute file-activity path to a forward-slash path relative to `root`. Mirrors
 *  `gl-graph-treemap.ts`'s private `toRepoRelative` (not imported — that one's scoped to
 *  `TreemapNode.path`, this one to file-activity roots). */
function relativizeToRoot(root: string, filePath: string): string | undefined {
	const norm = filePath.replace(/\\/g, '/');
	const rootNorm = root.replace(/\\/g, '/');
	if (norm === rootNorm) return '';
	if (norm.startsWith(`${rootNorm}/`)) return norm.slice(rootNorm.length + 1);
	return undefined;
}

/**
 * Details sheet for a live agent session — identity, a hero that morphs by phase (needs-input /
 * working / idle / ended), and a constant body of activity and prompts. Also renders a sparse
 * read-only variant for a past (no-longer-live) session, given a {@link PastAgentSessionState}
 * snapshot plus optional on-demand {@link PastAgentSessionDetail} enrichment.
 *
 * The header IS the identity, live and past alike: avatar + phase mark, name, a meta line
 * (harness · model · subagent count), a status zone (quiet elapsed beside the phase pill), and the
 * session's CURRENT location as clickable chips — mapped onto `gl-detail-sheet`'s `title`/`subtitle`
 * slots so it stays sticky above the scrolling body. The body below only ever answers "what does
 * this phase need, and what has it done": hero (by phase) → Activity → Last prompt → First prompt
 * → Also worked in (history, last — the header already carries where the session IS now).
 *
 * Data via props only — every field already rides on {@link AgentSessionState}, so opening the
 * sheet costs no fetch. When `session` is `undefined` (the session archived or otherwise left the
 * live snapshot while the sheet was open), the chrome stays up with a single quiet line — closing
 * is left to the user, not forced.
 */
@customElement('gl-graph-agent-sheet')
export class GlGraphAgentSheet extends SheetWrapper(LitElement) {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: block;
			}

			.content {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				min-height: 0;
				padding-top: var(--gl-space-10);
				overflow-y: auto;
			}

			.empty {
				padding: var(--gl-space-12);
				color: var(--color-foreground--65);
			}

			/* ---------- Header: title slot (row 1) ---------- */

			/* The corner badge hangs 0.2rem past the avatar's box; the sheet's title part clips
			   (overflow: hidden serves plain-text titles' ellipsis) — the name span here
			   ellipsizes itself, so the part can safely show overflow. */
			gl-detail-sheet::part(title) {
				overflow: visible;
			}

			.title-row {
				display: flex;
				width: 100%;
				min-width: 0;
				align-items: center;
				gap: var(--gl-space-8);
			}

			.avatar {
				position: relative;
				display: grid;
				flex: none;
				place-items: center;
				width: 2rem;
				height: 2rem;
			}

			/* The shared mark draws its own silhouette, ring, waves, and opaque backing — this only
			   positions it, sizes it (badge variant is em-sized off font-size), colors it by phase,
			   and hands it the surface color to cut the avatar's corner with. Tucked onto the glyph's
			   corner exactly as the sidebar tree and graph rows tuck it (the glyph is 1.6rem centered
			   in this 2rem box, so 0.25rem here ≈ the tree's 0.05em inset from the glyph's own edge) —
			   every surface should agree on where the phase mark sits. */
			.avatar__badge {
				position: absolute;
				right: 0.25rem;
				bottom: 0.25rem;
				z-index: 2;
				font-size: 1.2rem;

				--gl-agent-mark-chip: var(--vscode-sideBar-background, var(--vscode-editor-background));
			}

			.avatar__badge--needs-input {
				color: var(--gl-agent-waiting-color);
			}

			.avatar__badge--working {
				color: var(--gl-agent-working-color);
			}

			.avatar__badge--ended {
				color: var(--gl-agent-ended-color);
			}

			.title-row__name {
				flex: 1 1 auto;
				min-width: 0;
				margin: 0;
				overflow: hidden;
				font-size: var(--gl-font-lg);
				font-weight: 600;
				line-height: 1.35;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			/* ---------- Header: subtitle slot (rows 2-3) ---------- */

			.subtitle {
				display: flex;
				width: 100%;
				min-width: 0;
				flex-direction: column;
				gap: var(--gl-space-6);
			}

			.meta-row {
				display: flex;
				align-items: center;
				gap: var(--gl-space-8);
			}

			.meta {
				display: flex;
				flex: 1 1 auto;
				flex-wrap: wrap;
				align-items: center;
				gap: var(--gl-space-6);
				min-width: 0;
				margin: 0;
				overflow: hidden;
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
			}

			.meta__dot {
				opacity: 0.7;
			}

			/* Subagent count as glyph + number — the word lives in the title tooltip. */
			.subs {
				display: inline-flex;
				align-items: center;
				gap: 0.3rem;
			}

			/* Status zone: quiet elapsed beside the phase pill — "in this state for N". The long form
			   ("Waiting for your input for 12m" / "Ended 3 days ago") lives in both elements' title.
			   Lives in the header's actions slot (left of Open/Close) — the margin keeps it from
			   crowding those buttons. */
			.status-zone {
				display: inline-flex;
				flex: none;
				align-items: center;
				gap: var(--gl-space-6);
				margin-right: var(--gl-space-8);
			}

			.status-zone__time {
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
				font-variant-numeric: tabular-nums;
			}

			/* Squircle phase pill — phase only, no pip: the avatar's corner mark already carries the dot. */
			.chip {
				display: inline-flex;
				flex: none;
				align-items: center;
				gap: var(--gl-space-4);
				padding: 0.2rem 0.6rem;
				border: var(--gl-border-width) solid currentColor;
				border-radius: var(--gl-radius-sm);
				font-size: var(--gl-font-sm);
				font-weight: 600;
				white-space: nowrap;
			}

			.chip--needs-input {
				color: var(--gl-agent-waiting-color);
			}

			.chip--working {
				color: var(--gl-agent-working-color);
			}

			.chip--idle {
				color: var(--gl-agent-idle-color);
			}

			.chip--ended {
				color: var(--gl-agent-ended-color);
			}

			/* Current-location chips — right side of the subtitle's meta row, quiet and clickable, one
			   per branch/worktree(/folder). The meta line (flex: 1 1 auto) grows to fill the row,
			   pushing this container flush right; both sides ellipsize on overflow rather than wrap. */
			.loc-chips {
				display: inline-flex;
				flex: 0 1 auto;
				min-width: 0;
				align-items: center;
				gap: var(--gl-space-8);
			}

			/* gl-tooltip is display: contents, so this sizes nothing itself — min-width: 0 just lets
			   the wrapped chip button (the real flex item) shrink past its content size. */
			.loc-chip__tooltip {
				display: contents;
				min-width: 0;
			}

			.loc-chip-btn {
				display: inline-flex;
				flex: 0 1 auto;
				min-width: 0;
				align-items: center;
				padding: 0.2rem 0.5rem;
				margin: -0.2rem -0.5rem;
				font: inherit;
				background: none;
				border: none;
				border-radius: var(--gl-radius-sm);
				cursor: pointer;
			}

			/* Zero gl-branch-name's own margin-inline — it assumes it's a standalone label, not a
			   button's sole child. */
			.loc-chip-btn gl-branch-name {
				margin-inline: 0;
			}

			.loc-chip-btn:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.loc-chip-btn:focus-visible {
				${focusOutlineButton}
			}

			.loc-chip-btn--branch {
				color: var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor));
			}

			.loc-chip-btn--muted {
				color: var(--color-foreground--65);
			}

			/* Cwd-only fallback — no worktree resolved, nothing to jump to. */
			.loc-chip-static {
				display: inline-flex;
				flex: 0 1 auto;
				min-width: 0;
				align-items: center;
				gap: var(--gl-space-4);
				padding: 0.2rem 0.5rem;
				overflow: hidden;
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.loc-chip-static code-icon {
				flex: none;
			}

			/* ---------- Hero (varies by phase) ---------- */

			.hero {
				margin: 0 var(--gl-space-12) var(--gl-space-12);
			}

			.hero__actions {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: flex-end;
				gap: var(--gl-space-6);
				margin-top: var(--gl-space-8);
			}

			.hero__unresolvable {
				display: flex;
				align-items: center;
				gap: var(--gl-space-8);
			}

			.hero__hint {
				flex: 1 1 auto;
				min-width: 0;
				margin: 0;
				overflow: hidden;
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.hero__line {
				margin: 0;
				color: var(--color-foreground--65);
			}

			.tool-block {
				padding: 0.4rem 0.5rem;
				background: color-mix(in srgb, transparent 92%, var(--color-foreground));
				border-radius: var(--gl-radius-sm);
			}

			.tool-block__code {
				overflow-wrap: anywhere;
				font-family: var(--vscode-editor-font-family, monospace);
				word-break: break-all;
			}

			.tool-block__caption {
				margin-top: var(--gl-space-2);
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
			}

			/* Slim end row (ended live / past sessions) — reason left, actions right. No status card. */
			.endrow {
				display: flex;
				align-items: center;
				gap: var(--gl-space-8);
				margin: 0 var(--gl-space-12) var(--gl-space-12);
			}

			.endrow__reason {
				flex: 1 1 auto;
				min-width: 0;
				margin: 0;
				overflow: hidden;
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.endrow__actions {
				display: inline-flex;
				flex: none;
				align-items: center;
				gap: var(--gl-space-6);
			}

			/* ---------- Constant body sections ---------- */

			.sec {
				padding: 0 var(--gl-space-12) var(--gl-space-16);
			}

			.sec__head {
				display: flex;
				align-items: center;
				gap: var(--gl-space-6);
				margin: 0 0 var(--gl-space-8);
			}

			.sec__title {
				margin: 0;
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
				font-weight: 600;
				letter-spacing: 0.05em;
				text-transform: uppercase;
			}

			.sec__count {
				padding: 0.1rem 0.5rem;
				background: color-mix(in srgb, transparent 88%, var(--color-foreground));
				border-radius: 1rem;
				color: var(--color-foreground--65);
				font-size: var(--gl-font-micro, 1rem);
			}

			/* "Also worked in" rows — history, so a distinct row style from the header's .loc-chip-btn.
			   Negative margin exactly cancels the padding so hover background never shifts the row and
			   the icon stays flush with the section title's left edge. */
			.loc {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
			}

			.loc__row {
				display: flex;
				align-items: center;
				width: 100%;
				gap: var(--gl-space-8);
				padding: 0.2rem 0.4rem;
				margin: -0.2rem -0.4rem;
				color: inherit;
				font: inherit;
				text-align: left;
				background: none;
				border: none;
				border-radius: var(--gl-radius-xs, 0.2rem);
				cursor: pointer;
			}

			.loc__row:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.loc__row:focus-visible {
				${focusOutlineButton}
			}

			.loc__row code-icon {
				flex: none;
				color: var(--color-foreground--65);
			}

			.loc__val {
				overflow: hidden;
				min-width: 0;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.loc__meta {
				color: var(--color-foreground--65);
				font-size: var(--gl-font-sm);
			}

			.prompt {
				margin: 0;
				white-space: pre-wrap;
				word-break: break-word;
			}

			.prompt--clamped {
				display: -webkit-box;
				overflow: hidden;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
			}
		`,
	];

	@property({ attribute: false })
	session?: AgentSessionState;

	@property({ attribute: false })
	pastSession?: PastAgentSessionState;

	@property({ attribute: false })
	pastDetail?: PastAgentSessionDetail;

	/** This session's position in the panel's cycle list (the agents section's card order), and that
	 *  list's size — drives the header's up/down session chevrons. `-1`/`0` = not cyclable. */
	@property({ attribute: false })
	cycleIndex = -1;

	@property({ attribute: false })
	cycleCount = 0;

	@consume({ context: graphServicesContext, subscribe: true })
	@state()
	private services?: typeof graphServicesContext.__context__;

	/** Sticky "current tool call" resolver for the working hero — see
	 *  {@link createStickyDetailResolver} and its card-panel counterpart in
	 *  `gl-details-agent-status.ts`. */
	private readonly _stickyResolver: StickyDetailResolver = createStickyDetailResolver();

	/** Memoized file-activity tree — rebuilt only when `fileActivity`'s array identity changes, so
	 *  re-renders from unrelated state (elapsed ticks, hero phase) don't re-walk the hierarchy. */
	private _fileActivityModel?: { readonly source: AgentSessionState['fileActivity']; readonly model: TreeModel[] };

	protected override updated(changedProperties: Map<string, unknown>): void {
		super.updated(changedProperties);

		if (changedProperties.has('session')) {
			this._stickyResolver.prune(this.session != null ? [this.session] : []);
		}

		this.sizeFileActivityTree();
	}

	/** Imperative, not a template `style` binding: the webview CSP blocks style ATTRIBUTES (and
	 *  `styleMap`'s first render commits one), so the tree's required definite height (its
	 *  lit-virtualizer has no intrinsic height — an unsized tree renders zero rows) must be written
	 *  straight to the CSSOM after every render. */
	private sizeFileActivityTree(): void {
		const tree = this.renderRoot.querySelector<HTMLElement>('gl-tree-view');
		if (tree == null) return;

		const model = this._fileActivityModel?.model;
		if (model == null) return;

		const px = this.countVisibleFileActivityNodes(model) * fileActivityRowHeight + 4;
		const value = `${px}px`;
		if (tree.style.height === value) return;

		tree.style.height = value;
		// The virtualizer can finish its FIRST layout after this height lands and then render zero
		// rows without ever re-checking (verified live; its `layoutComplete` promise never settles
		// in that state, so it can't be awaited either). Bounce the height by a pixel so its
		// ResizeObserver re-fires and it recomputes the visible range — twice, timed past the
		// tree's own async render, since a same-frame bounce lands inside the ignored window.
		for (const delay of [150, 600]) {
			setTimeout(() => {
				if (tree.style.height !== value) return;

				// Hold the changed height across real time — a same-frame (or next-frame) restore
				// coalesces into a net-zero resize the observer never reports (verified live).
				tree.style.height = `${px + 1}px`;
				setTimeout(() => {
					if (tree.style.height === `${px + 1}px`) {
						tree.style.height = value;
					}
				}, 100);
			}, delay);
		}
	}

	override render(): unknown {
		const session = this.session;
		const pastSession = this.pastSession;

		return html`<gl-detail-sheet
			esc-managed
			aria-label="Agent session details"
			close-label="Close"
			@gl-detail-sheet-close=${this.handleInnerClose}
		>
			${
				session != null
					? this.renderTitleSlot(session, agentPhaseToCategory[session.phase])
					: pastSession != null
						? this.renderPastTitleSlot(pastSession)
						: nothing
			}
			${
				session != null
					? this.renderSubtitleSlot(session)
					: pastSession != null
						? this.renderPastSubtitleSlot(pastSession)
						: nothing
			}
			${
				session != null
					? this.renderActions(session, agentPhaseToCategory[session.phase])
					: pastSession != null
						? this.renderPastActions(pastSession)
						: nothing
			}
			<div class="content scrollable">
				${
					session != null
						? this.renderContent(session)
						: pastSession != null
							? this.renderPastContent(pastSession)
							: html`<p class="empty">This session is no longer available.</p>`
				}
			</div>
		</gl-detail-sheet>`;
	}

	/** Status zone first (quiet elapsed + phase pill), then the cycle chevrons, then the Open Session
	 *  chip — live, non-ended only; an ended session's body Resume row covers it instead. */
	private renderActions(session: AgentSessionState, category: AgentSessionCategory) {
		const action = category !== 'ended' ? getAgentSessionOpenAction(session) : undefined;
		return html`
			${this.renderStatusZone(session, category)}${this.renderCycleActions()}
			${
				action != null
					? html`<gl-action-chip
							slot="actions"
							icon=${action.icon}
							label=${action.label}
							overlay="tooltip"
							href=${createAgentSessionOpenHref(session)}
						></gl-action-chip>`
					: nothing
			}
		`;
	}

	/** Up/down, not left/right — the cycle order IS the agents section's vertical card order, so the
	 *  arrows mirror the list they walk. Hidden entirely when there's nothing to cycle to. */
	private renderCycleActions() {
		if (this.cycleCount < 2 || this.cycleIndex < 0) return nothing;

		const position = `${this.cycleIndex + 1} of ${this.cycleCount}`;
		return html`
			<gl-action-chip
				slot="actions"
				icon="chevron-up"
				label="Previous Agent Session (${position})"
				overlay="tooltip"
				@click=${() => this.cycleSession(-1)}
			></gl-action-chip>
			<gl-action-chip
				slot="actions"
				icon="chevron-down"
				label="Next Agent Session (${position})"
				overlay="tooltip"
				@click=${() => this.cycleSession(1)}
			></gl-action-chip>
		`;
	}

	private cycleSession(direction: -1 | 1): void {
		this.dispatchEvent(
			new CustomEvent('gl-agent-session-cycle', {
				detail: { direction: direction },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Past sessions carry the status zone and cycle chevrons into the actions slot — no Open chip,
	 *  close only; the body's Resume row covers opening. */
	private renderPastActions(pastSession: PastAgentSessionState) {
		return html`${this.renderPastStatusZone(pastSession)}${this.renderCycleActions()}`;
	}

	private renderContent(session: AgentSessionState) {
		const category = agentPhaseToCategory[session.phase];

		return html`${this.renderHero(session, category)} ${this.renderBody(session)}`;
	}

	/* ---------- Header: title slot ---------- */

	private renderTitleSlot(session: AgentSessionState, category: AgentSessionCategory) {
		return html`
			<div class="title-row" slot="title">
				<span class="avatar">
					<code-icon icon=${agentProviderIcon(session.providerId)}></code-icon>
					<gl-agent-mark
						class="avatar__badge avatar__badge--${category}"
						category=${category}
						variant="badge"
						aria-hidden="true"
					></gl-agent-mark>
				</span>
				<h3 class="title-row__name">${session.displayName}</h3>
			</div>
		`;
	}

	private renderPastTitleSlot(pastSession: PastAgentSessionState) {
		const detail = this.pastDetail;
		const titles = detail?.titles;
		const displayName = titles?.custom ?? titles?.ai ?? pastSession.displayName;

		return html`
			<div class="title-row" slot="title">
				<span class="avatar">
					<code-icon icon=${agentProviderIcon(pastSession.providerId)}></code-icon>
					<gl-agent-mark
						class="avatar__badge avatar__badge--ended"
						category="ended"
						variant="badge"
						aria-hidden="true"
					></gl-agent-mark>
				</span>
				<h3 class="title-row__name">${displayName}</h3>
			</div>
		`;
	}

	/* ---------- Header: subtitle slot ---------- */

	private renderSubtitleSlot(session: AgentSessionState) {
		return html`
			<div class="subtitle" slot="subtitle">
				<div class="meta-row">${this.renderMetaLine(session)} ${this.renderLocationChips(session)}</div>
			</div>
		`;
	}

	private renderPastSubtitleSlot(pastSession: PastAgentSessionState) {
		return html`
			<div class="subtitle" slot="subtitle">
				<div class="meta-row">
					${this.renderPastMetaLine(pastSession)} ${this.renderPastLocationChips(pastSession)}
				</div>
			</div>
		`;
	}

	/** Names the coding harness FIRST — the avatar's glyph alone can't carry identity, since most
	 *  providers fall through to the generic robot glyph — then the model, then a subagent
	 *  glyph+count (the word lives in the count's title tooltip). */
	private renderMetaLine(session: AgentSessionState) {
		return html`
			<p class="meta">
				<span>${session.providerName}</span>
				${session.model ? html`<span class="meta__dot">·</span><span>${session.model}</span>` : nothing}
				${
					session.subagentCount > 0
						? html`<span class="meta__dot">·</span
								><span class="subs" title=${pluralize('subagent', session.subagentCount)}>
									<code-icon icon="type-hierarchy-sub"></code-icon>${session.subagentCount}
								</span>`
						: nothing
				}
			</p>
		`;
	}

	/** Past sessions carry only a `providerId`, no `providerName`/`model`/subagent count — see
	 *  {@link getAgentProviderLabel}. */
	private renderPastMetaLine(pastSession: PastAgentSessionState) {
		const label = getAgentProviderLabel(pastSession.providerId);
		if (!label) return nothing;

		return html`<p class="meta"><span>${label}</span></p>`;
	}

	/** Elapsed source varies by category — see fix "one time, one meaning": needs-input/working read
	 *  `phaseSince` (how long in this state); idle has no phase clock worth surfacing, so it reads
	 *  `lastActivity` (same clock the old idle hero used, now unified here); ended prefers the real
	 *  `endedAt` stamp, falling back to `phaseSince` for sessions that predate that field. */
	private renderStatusZone(session: AgentSessionState, category: AgentSessionCategory) {
		const elapsedSource =
			category === 'idle'
				? session.lastActivity
				: category === 'ended'
					? (session.endedAt ?? session.phaseSince)
					: session.phaseSince;
		const elapsed = formatAgentElapsed(elapsedSource);
		const phaseLabel = getAgentPhaseLabel(category, session.pendingPermission);
		const longTitle = this.describeStatusLongForm(category, elapsed);

		return html`
			<span class="status-zone" slot="actions">
				${
					elapsed != null
						? html`<gl-tooltip content=${longTitle}
								><span class="status-zone__time">${elapsed}</span></gl-tooltip
							>`
						: nothing
				}
				<gl-tooltip content=${longTitle}><span class="chip chip--${category}">${phaseLabel}</span></gl-tooltip>
			</span>
		`;
	}

	private renderPastStatusZone(pastSession: PastAgentSessionState) {
		const elapsed = formatAgentElapsed(pastSession.lastActivity);
		const verb = pastSession.disposition === 'archived' ? 'Archived' : 'Ended';
		const longTitle = elapsed != null ? `${verb} ${elapsed} ago` : verb;

		return html`
			<span class="status-zone" slot="actions">
				${
					elapsed != null
						? html`<gl-tooltip content=${longTitle}
								><span class="status-zone__time">${elapsed}</span></gl-tooltip
							>`
						: nothing
				}
				<gl-tooltip content=${longTitle}
					><span class="chip chip--ended">${getAgentCategoryLabel('ended')}</span></gl-tooltip
				>
			</span>
		`;
	}

	/** Short tooltip sentence for the status-zone elements — the pill/elapsed themselves stay
	 *  quiet, this is where the reader confirms what the phase and elapsed actually mean. */
	private describeStatusLongForm(category: AgentSessionCategory, elapsed: string | undefined): string {
		switch (category) {
			case 'needs-input':
				return elapsed != null ? `Waiting for your input for ${elapsed}` : 'Waiting for your input';
			case 'working':
				return elapsed != null ? `Working for ${elapsed}` : 'Working';
			case 'idle':
				return elapsed != null ? `Last active ${elapsed} ago` : 'Idle';
			case 'ended':
				return elapsed != null ? `Ended ${elapsed} ago` : 'Ended';
		}
	}

	private revealLocation(detail: { worktreePath?: string; branchName?: string; upstreamName?: string }): void {
		this.dispatchEvent(
			new CustomEvent('gl-graph-reveal-location', { detail: detail, bubbles: true, composed: true }),
		);
	}

	/** The session's CURRENT location, right side of the subtitle's meta row — a single colorized
	 *  worktree chip when the branch and worktree names collapse to the same thing (or there's no
	 *  branch at all, just a worktree), a branch chip PLUS a muted worktree chip when they differ, or
	 *  a static (non-clickable) folder chip when no worktree resolved at all. History
	 *  (previously-visited worktrees) is a separate "Also worked in" body section — this row only
	 *  ever shows where the session IS. */
	private renderLocationChips(session: AgentSessionState) {
		const worktree = session.worktree;
		if (worktree == null) {
			if (session.cwd == null) return nothing;

			return html`
				<div class="loc-chips">
					<span class="loc-chip-static">
						<code-icon icon="folder"></code-icon>
						<span>${basename(session.cwd)}</span>
					</span>
				</div>
			`;
		}

		const branchName = worktree.branch?.name;
		const worktreeName = worktree.name ?? basename(worktree.path);

		// No branch (detached/bare worktree) or the branch and worktree names collapse to the same
		// thing — one chip is enough, and it jumps to the worktree's WIP row.
		if (branchName == null || branchName === worktreeName) {
			return html`<div class="loc-chips">${this.renderWorktreeChip(worktree, false)}</div>`;
		}

		return html`
			<div class="loc-chips">
				${this.renderBranchChip(worktree, branchName)} ${this.renderWorktreeChip(worktree, true)}
			</div>
		`;
	}

	/** Jumps to the BRANCH tip — deliberately omits `worktreePath`, since `gl-graph-app`'s reveal
	 *  handler prefers a worktree target over a branch one when both are present. */
	private renderBranchChip(worktree: AgentSessionWorktreeState, branchName: string) {
		const upstreamName = worktree.branch?.upstreamName;

		return html`
			<gl-tooltip content=${branchName} class="loc-chip__tooltip">
				<button
					type="button"
					class="loc-chip-btn loc-chip-btn--branch"
					@click=${() => this.revealLocation({ branchName: branchName, upstreamName: upstreamName })}
				>
					<gl-branch-name .name=${branchName} .size=${12}></gl-branch-name>
				</button>
			</gl-tooltip>
		`;
	}

	private renderWorktreeChip(worktree: AgentSessionWorktreeState, muted: boolean) {
		const worktreePath = worktree.path;
		const label = worktree.name ?? basename(worktree.path);

		return html`
			<gl-tooltip content=${worktreePath} class="loc-chip__tooltip">
				<button
					type="button"
					class="loc-chip-btn ${muted ? 'loc-chip-btn--muted' : 'loc-chip-btn--branch'}"
					@click=${() => this.revealLocation({ worktreePath: worktreePath })}
				>
					<gl-branch-name worktree .name=${label} .size=${12}></gl-branch-name>
				</button>
			</gl-tooltip>
		`;
	}

	/** Past sessions carry only a resolved `worktreePath`, no branch metadata — always the single
	 *  colorized worktree chip. */
	private renderPastLocationChips(pastSession: PastAgentSessionState) {
		const worktreePath = pastSession.worktreePath;
		const label = basename(worktreePath);

		return html`
			<div class="loc-chips">
				<gl-tooltip content=${label} class="loc-chip__tooltip">
					<button
						type="button"
						class="loc-chip-btn loc-chip-btn--branch"
						@click=${() => this.revealLocation({ worktreePath: worktreePath })}
					>
						<gl-branch-name worktree .name=${label} .size=${12}></gl-branch-name>
					</button>
				</gl-tooltip>
			</div>
		`;
	}

	/* ---------- Hero (varies by phase) ---------- */

	private renderHero(session: AgentSessionState, category: AgentSessionCategory) {
		switch (category) {
			case 'needs-input':
				return this.renderHeroNeedsInput(session);
			case 'working':
				return this.renderHeroWorking(session);
			case 'idle':
				// No hero — the status zone's "Last active Nm ago" already carries this, off the same
				// `lastActivity` clock (see "one time, one meaning").
				return nothing;
			case 'ended':
				return this.renderHeroEnded(session);
		}
	}

	private renderHeroNeedsInput(session: AgentSessionState) {
		const permission = session.pendingPermission;
		if (permission == null) return nothing;

		// Evict any prior working-phase sticky tool entry — see `createStickyDetailResolver`'s
		// `evict` doc for why bypassing `resolveLiveTool` would otherwise leak the pre-permission
		// tool detail back once the session returns to `working`.
		this._stickyResolver.evict(session);

		return html`
			<div class="hero">
				<gl-agent-prompt-detail .permission=${permission} expanded></gl-agent-prompt-detail>
				<div class="hero__actions">${this.renderAskActions(session, permission)}</div>
			</div>
		`;
	}

	/** Mirrors `gl-details-agent-status.ts`'s `renderCardActions` recipe (hrefs, labels, gating) —
	 *  View Plan / Copy Plan Path already live inside the composite's caption row, so this row
	 *  carries only resolution actions. */
	private renderAskActions(
		session: AgentSessionState,
		permission: NonNullable<AgentSessionState['pendingPermission']>,
	) {
		const openAction = getAgentSessionOpenAction(session);
		const openHref = createAgentSessionOpenHref(session);

		if (!canResolvePermission('needs-input', permission)) {
			return html`
				<div class="hero__unresolvable">
					<p class="hero__hint">This request must be answered in the agent's session</p>
					<gl-button href=${openHref}>
						<code-icon icon=${openAction.icon} slot="prefix"></code-icon>
						${openAction.label}
					</gl-button>
				</div>
			`;
		}

		if (permission.kind === 'question') {
			return html`<gl-button href=${openHref}>Answer in Session</gl-button>`;
		}

		const allowHref = createCommandLink('gitlens.agents.resolvePermission', {
			sessionId: session.id,
			providerId: session.providerId,
			decision: 'allow' as const,
		});
		const denyHref = createCommandLink('gitlens.agents.resolvePermission', {
			sessionId: session.id,
			providerId: session.providerId,
			decision: 'deny' as const,
		});
		const showAlwaysAllow =
			permission.kind === 'tool' && permission.suggestions != null && permission.suggestions.length > 0;
		const alwaysAllowHref = showAlwaysAllow
			? createCommandLink('gitlens.agents.resolvePermission', {
					sessionId: session.id,
					providerId: session.providerId,
					decision: 'allow' as const,
					alwaysAllow: true,
				})
			: undefined;
		const allowLabel = permission.kind === 'plan' ? 'Approve Plan' : 'Allow';
		const denyLabel = permission.kind === 'plan' ? 'Reject Plan' : 'Deny';

		return html`
			<gl-button href=${allowHref}>
				<code-icon icon="check" slot="prefix"></code-icon>
				${allowLabel}
			</gl-button>
			${
				showAlwaysAllow && alwaysAllowHref != null
					? html`<gl-button appearance="secondary" href=${alwaysAllowHref}>
							<code-icon icon="check-all" slot="prefix"></code-icon>
							Always Allow
						</gl-button>`
					: nothing
			}
			<gl-button appearance="secondary" href=${denyHref}>
				<code-icon icon="x" slot="prefix"></code-icon>
				${denyLabel}
			</gl-button>
		`;
	}

	/** Sticky-aware — see `createStickyDetailResolver` — so the tool composite survives the brief
	 *  gaps between tool calls instead of flickering to the `describeAgentSession` fallback. */
	private renderHeroWorking(session: AgentSessionState) {
		const stickyTool = this._stickyResolver.resolveLiveTool(session);
		if (stickyTool != null) {
			return html`
				<div class="hero">
					<div class="tool-block">
						<div class="tool-block__code">${stickyTool}</div>
						<div class="tool-block__caption">Running · ${formatAgentElapsed(session.lastActivity)}</div>
					</div>
				</div>
			`;
		}

		const line = describeAgentSession(session, 'working', { idleFallback: 'lastActive' });
		if (!line) return nothing;

		return html`<div class="hero"><p class="hero__line">${line}</p></div>`;
	}

	private renderHeroEnded(session: AgentSessionState) {
		const endReasonLine = this.describeEndReason(session.endReason);
		const openHref = createAgentSessionOpenHref(session);
		const archiveHref = createAgentSessionArchiveHref(session);

		return html`
			<div class="endrow">
				<span class="endrow__reason">${endReasonLine ?? nothing}</span>
				<span class="endrow__actions">
					<gl-button href=${openHref}>
						<code-icon icon="debug-restart" slot="prefix"></code-icon>
						Resume
					</gl-button>
					${
						archiveHref != null
							? html`<gl-button
									appearance="toolbar"
									tooltip="Archive"
									aria-label="Archive"
									href=${archiveHref}
								>
									<code-icon icon="archive"></code-icon>
								</gl-button>`
							: nothing
					}
				</span>
			</div>
		`;
	}

	/** Humanizes the real `endReason` values worth surfacing; every other reason (`rotated`,
	 *  `stale`, `dead-pid`, `pid-zero-idle`) is internal bookkeeping, not user-facing copy. */
	private describeEndReason(reason: string | undefined): string | undefined {
		switch (reason) {
			case 'session-end':
				return 'Ended normally';
			case 'archived':
				return 'Archived';
			default:
				return undefined;
		}
	}

	/* ---------- Constant body ---------- */

	private renderBody(session: AgentSessionState) {
		return html`${this.renderActivitySection(session)}${this.renderLastPromptSection(session)}${this.renderFirstPromptSection(session)}${this.renderVisitedWorktreesSection(session)}`;
	}

	private renderActivitySection(session: AgentSessionState) {
		const entries = session.fileActivity;
		if (!entries?.length) return nothing;

		const model = this.getFileActivityModel(session, entries);

		// The tree gets its required definite height imperatively after render — see
		// {@link sizeFileActivityTree} for why (no virtualizer intrinsic height + the CSP).
		return html`
			<div class="sec">
				<div class="sec__head">
					<h4 class="sec__title">File Activity</h4>
					<span class="sec__count">${pluralize('file', entries.length)}</span>
				</div>
				<gl-tree-view
					.model=${model}
					guides="onHover"
					@gl-tree-generated-item-selected=${this.onFileActivityItemSelected}
					@gl-tree-expansion-changed=${this.onFileActivityExpansionChanged}
				></gl-tree-view>
			</div>
		`;
	}

	/** Paths the user has collapsed in the File Activity tree — drives the explicit tree height. */
	private readonly _fileActivityCollapsed = new Set<string>();

	private readonly onFileActivityExpansionChanged = (
		e: CustomEvent<{ path: string; key?: string; expanded: boolean }>,
	): void => {
		if (e.detail.expanded) {
			this._fileActivityCollapsed.delete(e.detail.path);
		} else {
			this._fileActivityCollapsed.add(e.detail.path);
		}

		this.requestUpdate();
	};

	/** Nodes the tree will actually lay out: every node, minus the subtrees under collapsed folders. */
	private countVisibleFileActivityNodes(model: readonly TreeModel[]): number {
		let count = 0;
		for (const node of model) {
			count++;
			if (node.children?.length && !this._fileActivityCollapsed.has(node.path)) {
				count += this.countVisibleFileActivityNodes(node.children);
			}
		}

		return count;
	}

	/** `readAt`/`editedAt` are RELATIVE ms (elapsed since the last matching tool call, stamped by
	 *  the host at serialization time) — NOT epoch. Feeding `Date.now() - ms` into
	 *  {@link formatAgentElapsed} (which expects an epoch value and subtracts it from `now`)
	 *  reuses its bucketing without reimplementing it. Edit wins over read when a file has both:
	 *  it's the more significant action. */
	private toFileActivityRow(entry: FileActivityEntry): FileActivityRow {
		const editing = entry.editing === true;
		const reading = entry.reading === true;

		if (editing || entry.editedAt != null) {
			const ms = entry.editedAt ?? 0;
			return {
				path: entry.path,
				kind: 'edit',
				live: editing,
				ageMs: editing ? 0 : ms,
				verb: editing ? 'editing' : 'edited',
				ageLabel: editing ? 'now' : (formatAgentElapsed(Date.now() - ms) ?? 'now'),
			};
		}

		const ms = entry.readAt ?? 0;
		return {
			path: entry.path,
			kind: 'read',
			live: reading,
			ageMs: reading ? 0 : ms,
			verb: reading ? 'reading' : 'read',
			ageLabel: reading ? 'now' : (formatAgentElapsed(Date.now() - ms) ?? 'now'),
		};
	}

	/** Memoized against `fileActivity`'s array identity, so re-renders from unrelated state (elapsed
	 *  ticks, hero phase changes) don't re-walk the hierarchy. */
	private getFileActivityModel(
		session: AgentSessionState,
		entries: NonNullable<AgentSessionState['fileActivity']>,
	): TreeModel[] {
		if (this._fileActivityModel?.source === entries) return this._fileActivityModel.model;

		const model = this.buildFileActivityModel(session, entries);
		this._fileActivityModel = { source: entries, model: model };
		return model;
	}

	/** Relativizes every entry against the session's family roots (worktree, then repo root),
	 *  longest-first so the more specific root wins when both happen to match, then walks the
	 *  resulting hierarchy into a `TreeModel[]` — same shape `makeHierarchical` + a folder/file walk
	 *  produce for the patch-details file tree (`gl-tree-base.ts`), just for file-activity rows
	 *  instead of `GitFileChangeShape`s (which this entry type doesn't satisfy). */
	private buildFileActivityModel(
		session: AgentSessionState,
		entries: NonNullable<AgentSessionState['fileActivity']>,
	): TreeModel[] {
		// Visited worktrees included: a session that edited files in a previously-visited sibling
		// worktree still gets those rows resolved (and openable) against the right root.
		const roots = [
			...new Set([session.worktree?.path, session.commonPath, ...(session.visitedWorktreePaths ?? [])]),
		]
			.filter((root): root is string => root != null)
			.sort((a, b) => b.length - a.length);

		const rows = entries
			.map(entry => this.toFileActivityRow(entry))
			.map(row => this.resolveFileActivityRow(row, roots));

		const hierarchy = makeHierarchical(
			rows,
			row => row.treePath.split('/'),
			(...parts: string[]) => parts.join('/'),
			true,
		);

		const children: TreeModel[] = [];
		if (hierarchy.children != null) {
			for (const child of hierarchy.children.values()) {
				children.push(this.walkFileActivityTree(child));
			}
		}
		return children;
	}

	private resolveFileActivityRow(row: FileActivityRow, roots: readonly string[]): ResolvedFileActivityRow {
		for (const root of roots) {
			const rel = relativizeToRoot(root, row.path);
			if (rel != null) return { ...row, rootPath: root, treePath: rel };
		}

		return { ...row, rootPath: undefined, treePath: row.path };
	}

	private walkFileActivityTree(
		item: HierarchicalItem<ResolvedFileActivityRow>,
		options: Partial<TreeItemBase> = { level: 1 },
	): TreeModel {
		options.level ??= 1;

		const model =
			item.value == null
				? folderToTreeModel(item.name, item.relativePath, options)
				: this.fileActivityRowToTreeModel(item.value, options);

		if (item.children != null) {
			const children: TreeModel[] = [];
			for (const child of item.children.values()) {
				children.push(this.walkFileActivityTree(child, { ...options, level: options.level + 1 }));
			}

			if (children.length > 0) {
				sortTreeChildren(children);
				model.branch = true;
				model.children = children;
			}
		}

		return model;
	}

	private fileActivityRowToTreeModel(row: ResolvedFileActivityRow, options: Partial<TreeItemBase>): TreeModel {
		const fileName = basename(row.path);

		return {
			branch: false,
			expanded: true,
			path: row.treePath,
			level: 1,
			checkable: false,
			checked: false,
			icon: { type: 'file-icon', filename: fileName },
			label: fileName,
			tooltip: row.path,
			tooltipWrap: 'break-all',
			decorations: [
				{ type: 'text', label: row.verb, kind: row.live ? 'modified' : 'muted', position: 'after' },
				{ type: 'text', label: row.ageLabel, kind: 'muted', position: 'after' },
			],
			context: [row],
			...options,
		};
	}

	/** Leaf click opens the file — mirrors the treemap's pipeline (`gl-graph-treemap.ts`'s
	 *  `sendFileAction` + `graphWebview.ts`'s `openTreemapFile`): send the repo-relative path plus
	 *  the root it belongs to, and let the host rehydrate the file's URI through that repo's own
	 *  Uri so virtual-workspace schemes survive. A row outside every known root has no `rootPath`
	 *  and is a no-op. The generic tree event types `context` for the drafts tree
	 *  (`DraftPatchFileChange[]`) — override it to this consumer's actual payload, same as
	 *  `sidebar-panel.ts`'s `handleTreeItemSelected`. */
	private readonly onFileActivityItemSelected = (
		e: CustomEvent<TreeItemSelectionDetail & { context?: [ResolvedFileActivityRow] }>,
	): void => {
		if (e.detail.node.branch) return;

		const row = e.detail.context?.[0];
		if (row?.rootPath == null) return;

		const services = this.services;
		if (services == null) return;

		notifyService(services.rowActions, 'rowActions/agentFileActivity', svc =>
			svc.openTreemapFile('open', row.rootPath!, row.treePath),
		);
	};

	private renderLastPromptSection(session: AgentSessionState) {
		if (!session.lastPrompt) return nothing;

		return html`
			<div class="sec">
				<div class="sec__head"><h4 class="sec__title">Last prompt</h4></div>
				<p class="prompt prompt--clamped" title=${session.lastPrompt}>${session.lastPrompt}</p>
			</div>
		`;
	}

	private renderFirstPromptSection(session: AgentSessionState) {
		const firstPrompt = session.firstPrompt;
		if (!firstPrompt || firstPrompt === session.lastPrompt) return nothing;

		return html`
			<div class="sec">
				<div class="sec__head"><h4 class="sec__title">First prompt</h4></div>
				<p class="prompt prompt--clamped" title=${firstPrompt}>${firstPrompt}</p>
			</div>
		`;
	}

	/** History — every OTHER worktree root this session has been observed in, most-recently-seen
	 *  first. The current location already leads the header, so this sits at the very end of the
	 *  body and is omitted entirely for a single-location session. */
	private renderVisitedWorktreesSection(session: AgentSessionState) {
		const previous = (session.visitedWorktreePaths ?? []).filter(path => path !== session.worktreePath);
		if (previous.length === 0) return nothing;

		const rows = previous.reverse();

		return html`
			<div class="sec">
				<div class="sec__head">
					<h4 class="sec__title">Also worked in</h4>
					<span class="sec__count">${rows.length}</span>
				</div>
				<div class="loc">
					${rows.map(
						path => html`
							<button
								type="button"
								class="loc__row"
								@click=${() => this.revealLocation({ worktreePath: path })}
							>
								<code-icon icon="gl-worktree"></code-icon>
								<span class="loc__val">${basename(path)}</span>
								<span class="loc__meta">worktree</span>
							</button>
						`,
					)}
				</div>
			</div>
		`;
	}

	/* ---------- Past session (sparse) ---------- */

	private renderPastContent(pastSession: PastAgentSessionState) {
		return html`${this.renderPastHero(pastSession)} ${this.renderPastBody(pastSession)}`;
	}

	private renderPastHero(pastSession: PastAgentSessionState) {
		const resume = pastSession.actions.resume;
		const archiveHref = createAgentSessionArchiveHref(pastSession);

		return html`
			<div class="endrow">
				<span class="endrow__reason"></span>
				<span class="endrow__actions">
					${
						resume != null
							? html`<gl-button
									href=${createCommandLink('gitlens.agents.resumeSession', {
										sessionId: pastSession.id,
										providerId: pastSession.providerId,
										cwd: resume.cwd,
									})}
								>
									<code-icon icon="debug-restart" slot="prefix"></code-icon>
									Resume
								</gl-button>`
							: html`<gl-button
									disabled
									tooltip="Can't resume — Claude Code's transcript for this session is no longer on disk"
								>
									<code-icon icon="debug-restart" slot="prefix"></code-icon>
									Resume
								</gl-button>`
					}
					${
						archiveHref != null
							? html`<gl-button
									appearance="toolbar"
									tooltip="Archive"
									aria-label="Archive"
									href=${archiveHref}
								>
									<code-icon icon="archive"></code-icon>
								</gl-button>`
							: nothing
					}
				</span>
			</div>
		`;
	}

	private renderPastBody(pastSession: PastAgentSessionState) {
		return html`${this.renderPastLastPromptSection(pastSession)}${this.renderPastFirstPromptSection(pastSession)}`;
	}

	private renderPastLastPromptSection(pastSession: PastAgentSessionState) {
		const lastPrompt = this.pastDetail?.lastPrompt ?? pastSession.lastPrompt;
		if (!lastPrompt) return nothing;

		return html`
			<div class="sec">
				<div class="sec__head"><h4 class="sec__title">Last prompt</h4></div>
				<p class="prompt prompt--clamped" title=${lastPrompt}>${lastPrompt}</p>
			</div>
		`;
	}

	private renderPastFirstPromptSection(pastSession: PastAgentSessionState) {
		const firstPrompt = this.pastDetail?.firstPrompt;
		const lastPrompt = this.pastDetail?.lastPrompt ?? pastSession.lastPrompt;
		if (!firstPrompt || firstPrompt === lastPrompt) return nothing;

		return html`
			<div class="sec">
				<div class="sec__head"><h4 class="sec__title">First prompt</h4></div>
				<p class="prompt prompt--clamped" title=${firstPrompt}>${firstPrompt}</p>
			</div>
		`;
	}
}
