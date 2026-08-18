import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { GitHealthFinding, GitHealthLever, GitHealthReport } from '@gitlens/git/gitHealth.js';
// Derives from the live threshold so tuning it can't strand stale numbers in the UI.
import { trackedFilesThreshold } from '@gitlens/git/gitHealth.js';
import type { GitHealthDetails, GitOptimizationId } from '@gitlens/git/providers/maintenance.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Unsubscribe } from '../../../../rpc/services/types.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import { srOnly } from '../../../shared/components/styles/lit/a11y.css.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import './gl-graph-visualizations-switcher.js';

type LeverDetails = { mechanics: string; considerations?: string };

/**
 * The suggestion card's always-visible "Enabling sets `key = value`…" line — `code` renders as an inline
 * config chip. Cards only render for `suggested` levers, so this fixed tense reads correctly there; the
 * ledger reuses this same copy verbatim for its own `suggested`/`available` rows (see
 * {@link GlGraphGitHealth.renderKeyedChangesPhrase}), and builds its own wording for every other status from
 * {@link LeverConfigChange} instead.
 */
type LeverChanges = { before: string; code?: string; after?: string };

/** The Git config key/value the ledger's status-aware "Changes"/consequence lines template from for statuses
 *  other than `suggested`/`available`. Omitted for levers with no single key (`backgroundMaintenance`),
 *  which gets its phrasing spelled out per status instead. */
type LeverConfigChange = { key: string; value: string };

type LeverCopy = {
	label: string;
	blurb: string;
	/** Value-prop line for the ledger row — what the lever is FOR, distinct from the card's mechanics-flavored blurb. */
	benefit: string;
	changes: LeverChanges;
	configChange?: LeverConfigChange;
	/** Compatibility/safety consequence — consent material, so it renders always-visible, never behind the twistie. */
	warning?: string;
	details: LeverDetails;
};

/** Display copy per lever — deliberately named for what the person gets, not for the config key. */
const leverCopy: Record<GitOptimizationId, LeverCopy> = {
	untrackedCache: {
		label: 'Untracked cache',
		blurb: 'Lets Git skip re-scanning untracked files it has already seen.',
		benefit: 'Speeds up status checks by skipping unchanged directories.',
		changes: {
			before: 'Enabling sets ',
			code: 'core.untrackedCache = true',
			after: ' in the Git config for this repository.',
		},
		configChange: { key: 'core.untrackedCache', value: 'true' },
		details: {
			mechanics: `Git remembers each directory's modification time and skips re-scanning directories that haven't changed when looking for new files, so status checks stop re-walking the whole tree.`,
			considerations:
				'Requires reliable directory timestamps. On some network drives, containers, or repositories shared between Windows and WSL, unreliable timestamps can make Git miss newly created files. GitLens runs Git’s own file-system test before enabling it.',
		},
	},
	fsmonitor: {
		label: 'File system monitor',
		blurb: 'Runs a background daemon so Git stops scanning every file on each status check.',
		benefit: 'Near-instant status checks via a background file monitor.',
		changes: {
			before: 'Enabling sets ',
			code: 'core.fsmonitor = true',
			after: ' in the Git config for this repository. This also starts Git’s built-in monitor.',
		},
		configChange: { key: 'core.fsmonitor', value: 'true' },
		details: {
			mechanics: `Git's built-in daemon watches for file changes as they happen, so a status check reads a small change journal instead of scanning the working tree — near-instant status even on huge repositories.`,
			considerations:
				'Runs one background Git process while this repository is in use. It is unsupported on some network and virtual file systems.',
		},
	},
	manyFiles: {
		label: 'Large-repository index',
		blurb: 'Speeds up index reads and writes for repositories with tens of thousands of files.',
		benefit: 'Faster index reads and writes in large repositories.',
		changes: {
			before: 'Enabling sets ',
			code: 'feature.manyFiles = true',
			after: ' in the Git config for this repository. This defaults the repository to index v4 and the untracked cache.',
		},
		configChange: { key: 'feature.manyFiles', value: 'true' },
		warning: 'Git before 2.13 and older external tools that read the Git index directly cannot read index v4.',
		details: {
			mechanics: `Switches Git's index to a compressed format and uses Git's large-repository defaults — together making status, add, and checkout faster when the index is large.`,
		},
	},
	sparseIndex: {
		label: 'Sparse index',
		blurb: 'Keeps paths outside this sparse checkout collapsed into directory entries.',
		benefit: 'Speeds up status, add, checkout, and other index-heavy commands in sparse worktrees.',
		changes: {
			before: 'Enabling runs ',
			code: 'git sparse-checkout reapply --sparse-index',
			after: ' for this worktree. It reapplies the existing sparse pattern and can remove clean out-of-cone files that Git had temporarily materialized.',
		},
		details: {
			mechanics: `Git replaces paths outside the sparse cone with one directory entry each, so commands can operate on the populated working set instead of loading every tracked path into the index.`,
			considerations:
				'Use Git 2.34 or later and compatible external tools with this worktree. Older index readers may not understand sparse-directory entries.',
		},
	},
	backgroundMaintenance: {
		label: 'Scheduled maintenance',
		blurb: 'Lets Git maintain this repository on a schedule, including while VS Code is closed.',
		benefit:
			'Runs Git’s own object, history, and reference maintenance on a schedule, even while VS Code is closed.',
		changes: {
			before: 'Enabling registers hourly prefetch that runs even when VS Code is closed, writing global Git config and a system scheduler entry (launchd, schtasks, or a systemd timer).',
		},
		details: {
			mechanics: `Registers this repository with your operating system's scheduler so Git runs its own maintenance — prefetching, commit-graph updates, and packing — hourly and daily.`,
		},
	},
};

/** Details copy for the pinned commit-graph ledger row — not a lever, so kept out of {@link leverCopy}. */
const commitGraphDetails: LeverDetails = {
	mechanics: `A standard Git cache of the commit history's shape that can also carry per-commit file-change filters. Git consults it instead of unpacking commits for dramatically faster graph loads and history walks; filters additionally accelerate file history. It is safe to delete at any time because Git can rebuild it.`,
	considerations:
		'Uses a small amount of disk inside .git and a little background CPU after history changes. Disable it here for this repository, or everywhere via the gitlens.gitOptimizations.enabled setting, if another tool owns your repository maintenance.',
};

/** Matches a GitLens setting id embedded in copy — git config keys like `core.commitGraph` don't start with `gitlens.` and are left as plain text. */
const gitlensSettingIdPattern = /gitlens\.[a-zA-Z.]+/g;

/**
 * Wraps every `gitlens.*` setting id found in `text` as a link that opens VS Code's Settings UI filtered to
 * it — `command:` links work here because the graph webview already enables command URIs. Applied wherever
 * details/considerations copy renders, so a future lever's copy links up without a call-site change.
 */
function linkifySettingIds(text: string): unknown {
	const matches = [...text.matchAll(gitlensSettingIdPattern)];
	if (matches.length === 0) return text;

	const parts: unknown[] = [];
	let cursor = 0;
	for (const match of matches) {
		// `matchAll` types `index` as optional even though it's always set for its own results.
		const index = match.index ?? 0;
		// The character class also matches a sentence-ending period right after the id — trim it back out so
		// the link text is the bare setting id and the period reads as normal punctuation, not part of it.
		let id = match[0];
		if (id.endsWith('.')) {
			id = id.slice(0, -1);
		}

		if (index > cursor) {
			parts.push(text.slice(cursor, index));
		}

		parts.push(
			html`<a href="command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify(`@id:${id}`))}"
				>${id}</a
			>`,
		);
		cursor = index + id.length;
	}

	if (cursor < text.length) {
		parts.push(text.slice(cursor));
	}

	return parts;
}

/** Formats a byte count as `84 MB` / `1.9 GB` — one decimal for GB, none for MB/KB. */
function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;

	return `${bytes} B`;
}

/**
 * Repository Health visualization. Renders the per-lever rows the host computes (`computeLevers`) — the
 * ownership and eligibility rules stay host-side so this view can't disagree with the auto tier about
 * what's enabled or who enabled it.
 *
 * The distinction this surface exists to make: a lever GitLens applied offers Undo, because the exact
 * prior value was recorded; a lever the user enabled themselves offers no control at all.
 */
@customElement('gl-graph-git-health')
export class GlGraphGitHealth extends SignalWatcher(LitElement) {
	private static readonly componentStyles = css`
		:host {
			display: flex;
			flex-direction: column;
			height: 100%;
			overflow: hidden;
			font-size: var(--gl-font-base);
			container-type: inline-size;
		}

		.header-row {
			display: flex;
			align-items: center;
			gap: var(--gl-space-6);
			min-width: 0;
			min-height: 3.2rem;
			padding: var(--gl-space-4) var(--gl-space-6);
			border-bottom: var(--gl-border-width) solid var(--vscode-editorWidget-border, transparent);
		}
		.header-row gl-graph-visualizations-switcher {
			flex: none;
		}
		.header-row__title {
			flex: 0 1 auto;
			min-width: 0;
			font-size: var(--gl-font-sm);
			font-weight: 600;
			text-transform: uppercase;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.header-row__right {
			display: flex;
			flex: none;
			gap: var(--gl-space-8);
			align-items: center;
			margin-inline-start: auto;
		}
		@container (max-width: 44rem) {
			.run-label {
				display: none;
			}
			/* A one-character ellipsis is worse than no title — the active switcher tab already names
			   the view at this width. */
			.header-row__title {
				display: none;
			}
			/* The fixed name column starves the status column at side-bar width, clipping the state/owner
			   info to a character — wrap it onto its own line under the name instead. */
			.ledger-row .ledger-name {
				width: auto;
			}
			.ledger-row .ledger-action {
				margin-inline-start: auto;
			}
			.ledger-row .ledger-status {
				order: 4;
				flex-basis: 100%;
				min-width: 0;
				/* Aligns under .ledger-name: twistie (2.4rem) + gap (1rem) + state icon (1.6rem) + gap (1rem). */
				padding-inline-start: 6rem;
			}
		}

		.body {
			flex: 1;
			min-height: 0;
			overflow: hidden auto;
			padding: var(--gl-space-16) var(--gl-space-16) var(--gl-space-20);
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-20);
		}

		.error {
			font-size: var(--gl-font-sm);
			color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
			background: var(--vscode-inputValidation-errorBackground);
			border: var(--gl-border-width) solid var(--vscode-inputValidation-errorBorder, transparent);
			border-radius: 0.2rem;
			padding: var(--gl-space-4) var(--gl-space-6);
		}

		/* ── Verdict: the panel's answer, read first. */
		.verdict {
			display: flex;
			gap: var(--gl-space-10);
		}
		.verdict code-icon {
			flex: none;
			font-size: 1.8rem;
			line-height: 2.4rem;
		}
		.verdict[data-tone='attn'] code-icon {
			color: var(--vscode-editorWarning-foreground);
		}
		.verdict[data-tone='ok'] code-icon {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
		}
		.verdict[data-tone='incomplete'] code-icon {
			color: var(--vscode-descriptionForeground);
		}
		.verdict-text {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-4);
		}
		.verdict-title {
			font-size: 1.6rem;
			font-weight: 600;
			line-height: 2.4rem;
		}
		.verdict-sub {
			font-size: var(--gl-font-base);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
			max-width: 56rem;
		}
		.verdict-facts {
			display: flex;
			flex-wrap: wrap;
			column-gap: var(--gl-space-6);
			row-gap: var(--gl-space-2);
			font-size: var(--gl-font-base);
			color: var(--vscode-descriptionForeground);
		}
		.verdict-facts b {
			color: var(--vscode-foreground);
			font-weight: 600;
			font-variant-numeric: tabular-nums;
		}
		.verdict-facts .fact.warn,
		.verdict-facts .fact.warn b {
			color: var(--vscode-editorWarning-foreground);
		}
		.verdict-facts .sep {
			color: var(--vscode-descriptionForeground);
			opacity: 0.6;
		}
		.verdict-placeholder {
			font-size: var(--gl-font-base);
			color: var(--vscode-descriptionForeground);
		}

		/* ── Suggestion cards: the actionable core, directly under the verdict. */
		.suggestions {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-10);
		}
		.card {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-8);
			min-width: 0;
			padding: var(--gl-space-12) var(--gl-space-16);
			background: var(--vscode-editorWidget-background);
			border: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
			border-radius: var(--gl-radius-sm);
		}
		.card-head {
			display: flex;
			align-items: center;
			gap: var(--gl-space-10);
			cursor: pointer;
		}
		.card-title {
			font-size: var(--gl-font-lg);
			font-weight: 600;
		}
		.card-action {
			flex: none;
			margin-inline-start: auto;
		}
		.card-blurb {
			font-size: var(--gl-font-base);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
			max-width: 54rem;
		}

		/* Twistie — the sole disclosure control. Toggling appends .lever-details at the card/row's end;
		   nothing above it moves. */
		.twistie {
			flex: none;
		}
		.twistie:focus-visible {
			outline: var(--gl-border-width) solid var(--color-focus-border);
			outline-offset: 0.2rem;
		}

		/* Changes line — always visible; the exact config write, quiet and never behind the twistie. */
		.changes-line {
			font-size: var(--gl-font-md);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
			max-width: 54rem;
		}
		.changes-line code {
			font-family: var(--vscode-editor-font-family);
			font-size: var(--gl-font-sm);
			color: var(--vscode-foreground);
			background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			padding: 0.1rem 0.4rem;
			border-radius: var(--gl-radius-xs);
		}

		/* Warning notes — compatibility/safety consequences; consent material, so always visible. */
		.note {
			display: flex;
			gap: var(--gl-space-6);
			align-items: baseline;
			max-width: 54rem;
			font-size: var(--gl-font-md);
			line-height: 1.5;
			color: var(--vscode-editorWarning-foreground);
		}
		.note code-icon {
			flex: none;
		}

		/* Expansion — appended last; a left-ruled reference block, never above the consent material. */
		.lever-details {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-4);
			max-width: 54rem;
			padding-inline-start: var(--gl-space-12);
			border-inline-start: 0.2rem solid color-mix(in srgb, var(--vscode-foreground) 15%, transparent);
			font-size: var(--gl-font-md);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
		}
		.lever-details[hidden] {
			display: none;
		}
		.lever-details b {
			color: var(--vscode-foreground);
		}
		.lever-details code {
			font-family: var(--vscode-editor-font-family);
			font-size: var(--gl-font-sm);
			color: var(--vscode-foreground);
			background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			padding: 0.1rem 0.4rem;
			border-radius: var(--gl-radius-xs);
		}
		.lever-details a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		.lever-details a:hover {
			text-decoration: underline;
		}
		.lever-details a:focus-visible {
			outline: var(--gl-border-width) solid var(--color-focus-border);
			outline-offset: 0.2rem;
		}

		/* Threshold meter — why THIS repo, visually: measured value against the threshold that triggers
		   the suggestion. Mark = threshold; fill past it is the overshoot, in warning tone. */
		.meter {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-4);
			max-width: 42rem;
		}
		.meter-track {
			position: relative;
			height: 0.6rem;
			border-radius: var(--gl-radius-xs);
			background: var(--vscode-editorWidget-background);
		}
		.meter-base {
			position: absolute;
			inset: 0 auto 0 0;
			border-radius: var(--gl-radius-xs);
			background: color-mix(in srgb, var(--vscode-descriptionForeground) 55%, transparent);
		}
		.meter-over {
			position: absolute;
			inset: 0 auto 0 auto;
			background: var(--vscode-editorWarning-foreground);
		}
		.meter-mark {
			position: absolute;
			top: -0.2rem;
			bottom: -0.2rem;
			width: 0.2rem;
			background: var(--vscode-foreground);
		}
		.meter-labels {
			display: flex;
			justify-content: space-between;
			font-size: var(--gl-font-sm);
			color: var(--vscode-descriptionForeground);
		}
		.meter-labels b {
			color: var(--vscode-foreground);
			font-weight: 600;
			font-variant-numeric: tabular-nums;
		}

		/* ── Section eyebrows */
		.section {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-8);
		}
		.section-label {
			font-size: var(--gl-font-sm);
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: var(--vscode-descriptionForeground);
		}

		/* ── Ledger: everything not needing attention. Repository-specific state stays readable. */
		.ledger {
			display: flex;
			flex-direction: column;
		}
		.ledger-row {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: var(--gl-space-10);
			/* Benefit/consequence always wrap onto their own line below row one — tighter than the row's
			   horizontal gap so they read as attached to the row they extend. */
			row-gap: var(--gl-space-2);
			padding: var(--gl-space-6) var(--gl-space-2);
			font-size: var(--gl-font-base);
			cursor: pointer;
		}
		.ledger-row .lever-details {
			order: 5;
			/* Forces the block onto its own flex line: the base max-width would otherwise cap the flex
			   line-breaking's hypothetical size, letting wide rows seat it beside the action instead. The
			   measure cap moves to the children below. Margin (not padding) indents it under .ledger-name —
			   twistie (2.4rem) + gap (1rem) + state icon (1.6rem) + gap (1rem) — so the left rule hugs the
			   text at the indent rather than sitting at the row edge with dead space after it. */
			flex-basis: 100%;
			max-width: none;
			margin-inline-start: 6rem;
		}
		.ledger-row .lever-details > * {
			max-width: 54rem;
		}
		.ledger-row + .ledger-row {
			border-top: var(--gl-border-width) solid var(--vscode-editorWidget-border, transparent);
		}
		.ledger-state {
			flex: none;
			color: var(--vscode-descriptionForeground);
		}
		.ledger-state[data-tone='on'] {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
		}
		.ledger-name {
			flex: none;
			width: 17rem;
			font-weight: 500;
		}
		.ledger-status {
			flex: 1;
			min-width: 0;
			color: var(--vscode-descriptionForeground);
			font-size: var(--gl-font-md);
			line-height: 1.4;
			overflow-wrap: anywhere;
		}
		.ledger-action {
			flex: none;
		}
		/* Benefit/consequence lines — always their own flex line, indented under .ledger-name. A max-width
		   here would cap the size line-breaking uses, letting short rows seat the line beside the action
		   instead of wrapping it — so the measure cap moves to .ledger-line-text below, same pattern as
		   .lever-details. */
		.ledger-row .ledger-line {
			flex-basis: 100%;
			max-width: none;
			min-width: 0;
			/* Aligns under .ledger-name: twistie (2.4rem) + gap (1rem) + state icon (1.6rem) + gap (1rem). */
			padding-inline-start: 6rem;
			font-size: var(--gl-font-md);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
		}
		.ledger-line-text {
			display: inline-block;
			max-width: 54rem;
			overflow-wrap: anywhere;
		}
		.ledger-line-text code {
			font-family: var(--vscode-editor-font-family);
			font-size: var(--gl-font-sm);
			color: var(--vscode-foreground);
			background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			padding: 0.1rem 0.4rem;
			border-radius: var(--gl-radius-xs);
		}
		.owner-gl {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
		}
		.card:focus-visible,
		.ledger-row:focus-visible {
			outline: var(--gl-border-width) solid var(--color-focus-border);
			outline-offset: 0.2rem;
		}
	`;
	static override styles = [scrollableBase, srOnly, GlGraphGitHealth.componentStyles];

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	@state()
	private _report: GitHealthReport | undefined;

	@state()
	private _levers: GitHealthLever[] = [];

	@state()
	private _details: GitHealthDetails | undefined;

	@state()
	private _loading = true;

	/**
	 * Last apply/undo/maintenance failure — the host propagates these deliberately, so they must show.
	 * Tagged with the repo it happened on: a late failure from repo A's action must not banner over repo
	 * B's data after a switch (rendered only while its repo is the one shown).
	 */
	@state()
	private _error: { repoPath: string; message: string } | undefined;

	/**
	 * The repo whose fetched data is actually installed and rendered. Actions capture this — never the live
	 * selection, and never `_pendingRepoPath` — so a click can only ever target the repo the user is looking
	 * at, not one still mid-fetch.
	 */
	@state()
	private _loadedRepoPath: string | undefined;

	/** The repo a fetch is currently in flight for — dedupe/stale-drop bookkeeping only, never read by actions. */
	private _pendingRepoPath: string | undefined;

	/** Aborts the previous refresh's fetches when a newer one supersedes it (or the element disconnects). */
	private _refreshAbort: AbortController | undefined;

	/**
	 * `repoPath\0id` keys with an apply/undo/maintenance call in flight — the control reports progress in
	 * place. Repo-scoped so an action still running for the previous repo can't render the new repo's rows
	 * busy after a switch (see {@link isBusy}).
	 */
	@state()
	private _busy = new Set<string>();

	/** Row/card keys with their Details disclosure open — `'commitGraph'` for the pinned ledger row. */
	@state()
	private _expanded = new Set<GitOptimizationId | 'commitGraph'>();

	/** Polite action result announced after the refreshed state has rendered. */
	@state()
	private _announcement = '';

	private _unsubscribe: Unsubscribe | undefined;

	private get repoPath(): string | undefined {
		return this.graphState?.selectedRepository;
	}

	/** True while a fetch for a different repo than what's rendered is in flight — actions must wait it out. */
	private get switching(): boolean {
		return this._pendingRepoPath != null && this._pendingRepoPath !== this._loadedRepoPath;
	}

	/** Whether an action for `key` is in flight for the repo currently rendered. */
	private isBusy(key: GitOptimizationId | 'maintenance' | 'commitGraph'): boolean {
		return this._loadedRepoPath != null && this._busy.has(`${this._loadedRepoPath}\0${key}`);
	}

	/** Whether the rendered repository has any action in flight; ignores work finishing for a prior repo. */
	private get hasBusyAction(): boolean {
		const repoPath = this._loadedRepoPath;
		return repoPath != null && [...this._busy].some(key => key.startsWith(`${repoPath}\0`));
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		void this.subscribe();
	}

	override disconnectedCallback(): void {
		const unsubscribe = this._unsubscribe;
		this._unsubscribe = undefined;
		// `Unsubscribe` may itself be a promise of the real function — resolve before calling it.
		void Promise.resolve(unsubscribe).then(fn => fn?.());
		this._refreshAbort?.abort();
		this._refreshAbort = undefined;
		super.disconnectedCallback?.();
	}

	/**
	 * Subscribes BEFORE the first fetch. Fetching first meant a single rejected read left the panel with
	 * no subscription at all — permanently dead to live updates rather than merely stale.
	 */
	private async subscribe(): Promise<void> {
		// One subscription covering every repo — the host fires on any probe/apply/revert and `refresh`
		// re-reads only the repo currently shown, so filtering here would just duplicate that.
		let health;
		try {
			health = await this.services?.graphHealth;
		} catch {
			// The RPC surface can reject (channel torn down, service not yet available) — degrade to a
			// static panel rather than leaving an unhandled rejection and the loading placeholder up forever.
			health = undefined;
		}
		// `_unsubscribe == null` guards re-entry: a disconnect/reconnect (e.g. a panel dock move reparenting
		// the webview DOM) while this await is in flight runs a second `subscribe()`, and assigning
		// unconditionally would overwrite — and permanently leak — the first listener.
		if (health != null && this.isConnected && this._unsubscribe == null) {
			this._unsubscribe = health.onHealthChanged(payload => {
				// Unknown/legacy payload (no repoPath) always refreshes; otherwise only when it's about the
				// repo we're showing — other repos' probes are irrelevant here and `getDetails` isn't free.
				if (payload == null || payload.repoPath === (this._pendingRepoPath ?? this._loadedRepoPath)) {
					void this.refresh();
				}
			});
		}

		await this.refresh();
	}

	/**
	 * Re-fetches whenever the shown repository changes. The element is reused across repo switches (the
	 * router returns the same template), so without this the panel would keep displaying the previous
	 * repo's levers while actions targeted the new one.
	 */
	protected override willUpdate(): void {
		const repoPath = this.repoPath;
		if (repoPath != null && repoPath !== (this._pendingRepoPath ?? this._loadedRepoPath)) {
			void this.refresh();
		}
	}

	private async refresh(): Promise<void> {
		const repoPath = this.repoPath;
		let health;
		try {
			health = await this.services?.graphHealth;
		} catch {
			// A rejected RPC surface must not escape as an unhandled rejection from `willUpdate`'s
			// `void this.refresh()` — that would strand the panel on the loading placeholder forever.
			health = undefined;
		}
		if (repoPath == null || health == null) {
			this._loading = false;
			return;
		}

		// Claimed up-front so a re-entrant `willUpdate` during the await can't queue a second fetch; the
		// abort tears down the superseded refresh's fetches (`getDetails` runs real git walks) instead of
		// letting them run to completion just to be dropped.
		this._pendingRepoPath = repoPath;
		this._refreshAbort?.abort();
		const abort = new AbortController();
		this._refreshAbort = abort;
		const [report, levers, details] = await Promise.allSettled([
			health.getReport(repoPath, abort.signal),
			health.getLevers(repoPath, abort.signal),
			health.getDetails(repoPath, abort.signal),
		]);

		// A newer refresh (or a repo switch) during the await makes this response stale — drop it rather
		// than showing repo A's levers under repo B's name, or aborted (empty) results over live ones.
		if (this._pendingRepoPath !== repoPath || this._refreshAbort !== abort) return;

		// Advances only now, in the same tick the fetched data installs — no rendered action button ever
		// targets a repo whose data hasn't loaded yet.
		this._loadedRepoPath = repoPath;
		this._report = getSettledValue(report);
		this._levers = getSettledValue(levers) ?? [];
		this._details = getSettledValue(details);
		this._loading = false;
	}

	private readonly onCloseClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-graph-timeline-close', { bubbles: true, composed: true }));
	};

	private readonly onToggleDetails = (key: GitOptimizationId | 'commitGraph'): void => {
		const expanded = new Set(this._expanded);
		if (expanded.has(key)) {
			expanded.delete(key);
		} else {
			expanded.add(key);
		}

		this._expanded = expanded;
	};

	private async run(
		key: GitOptimizationId | 'maintenance' | 'commitGraph',
		action: (repoPath: string) => Promise<unknown>,
		options?: {
			successMessage?: string;
			notAppliedMessage?: string;
			focusKey?: GitOptimizationId | 'maintenance' | 'commitGraph';
		},
	): Promise<void> {
		// Captured synchronously, before any await — the value a click targets can never drift out from
		// under it even if the displayed repo changes while the action is in flight.
		const repoPath = this._loadedRepoPath;
		if (repoPath == null) return;

		const focusKey = options?.focusKey;
		const initiatingControl =
			focusKey != null
				? this.renderRoot.querySelector<HTMLElement>(`[data-health-action="${focusKey}"]`)
				: undefined;
		const shouldRestoreFocus = initiatingControl != null && this.shadowRoot?.activeElement === initiatingControl;
		let focusMoved = false;
		const onFocusIn = (event: FocusEvent): void => {
			if (initiatingControl != null && !event.composedPath().includes(initiatingControl)) {
				focusMoved = true;
			}
		};
		const onWindowBlur = (): void => {
			focusMoved = true;
		};
		if (shouldRestoreFocus) {
			this.ownerDocument.addEventListener('focusin', onFocusIn, true);
			this.ownerDocument.defaultView?.addEventListener('blur', onWindowBlur);
		}

		const busyKey = `${repoPath}\0${key}`;
		this._busy = new Set(this._busy).add(busyKey);
		this._error = undefined;
		this._announcement = '';
		let announcement: string | undefined;
		try {
			const result = await action(repoPath);
			announcement = result === false ? options?.notAppliedMessage : options?.successMessage;
		} catch (ex) {
			// The host contract propagates genuine git failures precisely so this surface can show them —
			// `void this.run(...)` would otherwise drop them and leave the button silently doing nothing.
			this._error = { repoPath: repoPath, message: ex instanceof Error ? ex.message : String(ex) };
		} finally {
			const busy = new Set(this._busy);
			busy.delete(busyKey);
			this._busy = busy;
			// The host fires `onHealthChanged` after its own re-probe, but refresh here too so the row
			// settles even when the action failed and nothing changed.
			let focusTarget: HTMLElement | null | undefined;
			try {
				await this.refresh();
				await this.updateComplete;
				if (this._loadedRepoPath === repoPath) {
					if (announcement != null) {
						this._announcement = announcement;
					}

					if (focusKey != null && shouldRestoreFocus && !focusMoved) {
						focusTarget = this.renderRoot.querySelector<HTMLElement>(`[data-health-action="${focusKey}"]`);
						focusTarget ??= this.renderRoot
							.querySelector<HTMLElement>(`[data-health-item="${focusKey}"]`)
							?.querySelector<HTMLElement>('.twistie');
					}
				}
			} finally {
				if (shouldRestoreFocus) {
					this.ownerDocument.removeEventListener('focusin', onFocusIn, true);
					this.ownerDocument.defaultView?.removeEventListener('blur', onWindowBlur);
				}
			}

			focusTarget?.focus();
		}
	}

	private getTrackedFilesCopy(report: GitHealthReport): { value: string; label: string } {
		const value = `${report.trackedFilesScope === 'estimate' ? '~' : ''}${report.estimatedTrackedFiles.toLocaleString()}`;
		switch (report.trackedFilesScope) {
			case 'repository':
				return { value: value, label: 'tracked files' };
			case 'sparseWorkingTree':
				return { value: value, label: 'populated index entries in the sparse working set' };
			case 'estimate':
				return { value: value, label: 'estimated tracked files' };
		}
	}

	private renderVerdict(suggestedCount: number, incomplete: boolean) {
		const report = this._report;
		if (report == null) {
			if (this._loading) {
				return html`<div class="verdict-placeholder" role="status" aria-live="polite">
					Checking repository health…
				</div>`;
			}

			return nothing;
		}

		if (suggestedCount > 0) {
			return html`<div class="verdict" data-tone="attn">
				<code-icon icon="sparkle"></code-icon>
				<div class="verdict-text">
					<span class="verdict-title">${pluralize('optimization', suggestedCount)} suggested</span>
					${this.renderFactsStrip(report)}
				</div>
			</div>`;
		}

		if (incomplete) {
			return html`<div class="verdict" data-tone="incomplete">
				<code-icon icon="warning"></code-icon>
				<div class="verdict-text">
					<span class="verdict-title">This repository looks in good shape</span>
					<span class="verdict-sub"
						>Nothing needs your attention, but some checks couldn't be completed — see the levers below for
						details.</span
					>
					${this.renderFactsStrip(report)}
				</div>
			</div>`;
		}

		return html`<div class="verdict" data-tone="ok">
			<code-icon icon="check"></code-icon>
			<div class="verdict-text">
				<span class="verdict-title">This repository is in good shape</span>
				<span class="verdict-sub"
					>Nothing needs your attention. GitLens keeps Git's caches up to date automatically.</span
				>
				${this.renderFactsStrip(report)}
			</div>
		</div>`;
	}

	/** Threshold meter for one finding — mark = threshold, positioned as a fraction of the measured value. */
	private renderMeter(finding: GitHealthFinding, report: GitHealthReport) {
		const { reason, value, threshold } = finding;

		// Labels derive from `finding.threshold` — the thresholds are explicitly tunable, and hardcoded
		// copies here would silently lie the first time one is tuned.
		let valueLabel: unknown;
		let thresholdLabel: string;
		let ariaValueText: string;
		switch (reason) {
			case 'trackedFiles': {
				const files = this.getTrackedFilesCopy(report);
				valueLabel = html`<b>${files.value}</b> ${files.label}`;
				thresholdLabel = `helps above ${threshold.toLocaleString()}`;
				ariaValueText = `${files.value} ${files.label}; ${thresholdLabel}`;
				break;
			}
			case 'largePacks': {
				const bytes = formatBytes(value);
				valueLabel = html`<b>${bytes}</b> of pack data`;
				thresholdLabel = `suggested above ${formatBytes(threshold)}`;
				ariaValueText = `${bytes} of pack data; ${thresholdLabel}`;
				break;
			}
			case 'worktreeSlowness': {
				const seconds = (value / 1000).toFixed(1);
				return html`<div class="meter">
					<div class="meter-labels">
						<span>slow working-tree commands observed (up to <b>${seconds}s</b>)</span>
						<span>threshold ${(threshold / 1000).toLocaleString()}s</span>
					</div>
				</div>`;
			}
			default:
				return nothing;
		}

		const markPct = Math.min(0.92, Math.max(0.08, threshold / value)) * 100;
		const overPct = Math.max(0, 88 - markPct);

		return html`<div class="meter" role="img" aria-label=${ariaValueText}>
			<div class="meter-track">
				<span class="meter-base" style=${cspStyleMap({ width: `${markPct}%` })}></span>
				<span class="meter-over" style=${cspStyleMap({ left: `${markPct}%`, width: `${overPct}%` })}></span>
				<span class="meter-mark" style=${cspStyleMap({ left: `${markPct}%` })}></span>
			</div>
			<div class="meter-labels">
				<span>${valueLabel}</span>
				<span>${thresholdLabel}</span>
			</div>
		</div>`;
	}

	/**
	 * Toggles Details for `key` on a click anywhere in a card head/ledger row, except a control that owns
	 * its own handler (the twistie itself, or `ownHandlerClass` — the Enable/Disable/Undo action).
	 */
	private onDisclosureAreaClick(
		key: GitOptimizationId | 'commitGraph',
		ownHandlerClass: string,
		e: MouseEvent,
	): void {
		const path = e.composedPath();
		if (
			path.some(
				el =>
					el instanceof HTMLElement &&
					(el.classList.contains('twistie') || el.classList.contains(ownHandlerClass)),
			)
		) {
			return;
		}

		this.onToggleDetails(key);
	}

	/** The sole disclosure control — a chevron twistie. Toggling appends `.lever-details` at the card/row's end. */
	private renderTwistie(key: GitOptimizationId | 'commitGraph', label: string) {
		const expanded = this._expanded.has(key);
		const detailsId = `git-health-details-${key}`;

		return html`<gl-button
			class="twistie"
			appearance="toolbar"
			aria-expanded=${expanded}
			aria-controls=${detailsId}
			aria-label=${`${expanded ? 'Hide' : 'Show'} details for ${label}`}
			@click=${() => this.onToggleDetails(key)}
			><code-icon icon=${expanded ? 'chevron-down' : 'chevron-right'}></code-icon
		></gl-button>`;
	}

	/** Renders a {@link LeverChanges} triple as prose — shared by the card's always-visible line and the
	 *  ledger's status-aware `suggested`/`available` phrasing, which uses the identical card copy. */
	private renderKeyedChangesPhrase(changes: LeverChanges) {
		return html`${changes.before}${changes.code != null ? html`<code>${changes.code}</code>` : nothing}${
			changes.after ?? nothing
		}`;
	}

	/** The always-visible "Enabling sets `key = value`…" line — `code` is optional (some levers have no single key). */
	private renderChangesLine(changes: LeverChanges) {
		return html`<span class="changes-line">${this.renderKeyedChangesPhrase(changes)}</span>`;
	}

	/**
	 * Educational layer — appended last, only when expanded. `changesPhrase` is a pre-formatted, status-aware
	 * phrase (see {@link renderLedgerChangesPhrase}) and is included only inside ledger expansions, and only
	 * for rows that didn't already show their consequence visibly (see {@link renderLedgerConsequence}); the
	 * suggestion card's own "Enabling sets…" line is rendered separately, always visible, via
	 * {@link renderChangesLine}.
	 */
	private renderLeverDetails(key: GitOptimizationId | 'commitGraph', details: LeverDetails, changesPhrase?: unknown) {
		return html`<div id=${`git-health-details-${key}`} class="lever-details" ?hidden=${!this._expanded.has(key)}>
			${changesPhrase != null ? html`<span><b>Changes</b> — ${changesPhrase}</span>` : nothing}
			<span><b>How it works</b> — ${linkifySettingIds(details.mechanics)}</span>
			${
				details.considerations != null
					? html`<span><b>Considerations</b> — ${linkifySettingIds(details.considerations)}</span>`
					: nothing
			}
		</div>`;
	}

	/**
	 * Builds the ledger row's labeled "Changes" phrase for rows with no visible consequence line —
	 * `userEnabled`, `available`, `unavailable`, and `notApplicable`. `applied` rows never reach this: their
	 * consequence is already shown visibly by {@link renderLedgerConsequence}, with identical copy, so
	 * showing it again inside the expansion would just repeat it.
	 */
	private renderLedgerChangesPhrase(lever: GitHealthLever): unknown {
		// `applied` rows show their consequence visibly instead — see {@link renderLedgerConsequence}.
		if (lever.status === 'applied') return undefined;

		if (lever.id === 'backgroundMaintenance') {
			switch (lever.status) {
				case 'suggested':
				case 'available':
					return leverCopy.backgroundMaintenance.changes.before;
				case 'userEnabled':
					return 'This repository is already registered for Git’s scheduled maintenance.';
				default:
					return 'Enabling would register scheduled maintenance with your operating system’s scheduler.';
			}
		}
		if (lever.id === 'sparseIndex') {
			switch (lever.status) {
				case 'suggested':
				case 'available':
					return this.renderKeyedChangesPhrase(leverCopy.sparseIndex.changes);
				case 'userEnabled':
					return 'This worktree already uses sparse-directory index entries.';
				default:
					return 'Enabling would convert this worktree’s index to sparse-directory entries.';
			}
		}

		const copy = leverCopy[lever.id];
		const configChange = copy.configChange;
		// `undefined`, not `nothing` — the caller's null-check gates the whole labeled row, and the `nothing`
		// sentinel would pass it and render a dangling "Changes —" label.
		if (configChange == null) return undefined;

		switch (lever.status) {
			case 'suggested':
			case 'available':
				// Identical wording to the suggestion card's always-visible line — one source, reused.
				return this.renderKeyedChangesPhrase(copy.changes);
			case 'userEnabled':
				// Deliberately unscoped to "this repository" — the value may come from global Git config.
				return html`Enabled via <code>${configChange.key}</code> in your Git config.`;
			default:
				return html`Enabling would set <code>${configChange.key} = ${configChange.value}</code> in the Git
					config for this repository.`;
		}
	}

	/**
	 * The visible consequence line for an `applied` ledger row — consent material for its Undo button, so it
	 * renders below the benefit line rather than behind the twistie. Returns `undefined` for every other
	 * status, since only `applied` rows carry that button.
	 */
	private renderLedgerConsequence(lever: GitHealthLever): unknown {
		if (lever.status !== 'applied') return undefined;

		if (lever.id === 'backgroundMaintenance') {
			return 'GitLens registered this repository for scheduled maintenance. Undo unregisters it and restores the prior maintenance configuration.';
		}
		if (lever.id === 'sparseIndex') {
			return 'GitLens converted this worktree to a sparse index. Undo expands the index and reapplies the existing sparse pattern, which can remove clean out-of-cone files.';
		}

		const configChange = leverCopy[lever.id].configChange;
		if (configChange == null) return undefined;

		const { key, value } = configChange;
		if (lever.id === 'fsmonitor') {
			return html`GitLens set <code>${key} = ${value}</code> in the Git config for this repository. Undo restores
				the previous value and stops the monitor.`;
		}

		return html`GitLens set <code>${key} = ${value}</code> in the Git config for this repository. Undo restores the
			previous value.`;
	}

	/**
	 * The ledger row's always-visible benefit line. `available` rows append the same threshold evidence the
	 * suggestion meter shows, except `backgroundMaintenance` — its benefit copy already ends with the
	 * audience clause, so appending the evidence again would just repeat it.
	 */
	private renderLedgerBenefit(lever: GitHealthLever, copy: LeverCopy): unknown {
		if (lever.status !== 'available' || lever.id === 'backgroundMaintenance') return copy.benefit;

		const report = this._report;
		const files = report != null ? this.getTrackedFilesCopy(report) : undefined;
		// A separate sentence, not a dash clause — the benefit copy already ends with a period.
		const evidence =
			files != null
				? `Helps above ${trackedFilesThreshold.toLocaleString()} working-tree entries; this repository has ${
						files.value
					} ${files.label}.`
				: `Helps above ${trackedFilesThreshold.toLocaleString()} tracked files; this repository has fewer.`;

		return `${copy.benefit} ${evidence}`;
	}

	/** The commit-graph row's benefit line — folds in the file-history-filters hint moved off the old status text. */
	private renderCommitGraphBenefit(cg: GitHealthReport['commitGraph']): unknown {
		if (cg.present && cg.changedPathsSupported && !cg.changedPaths) {
			return 'Accelerates history walks and file history. File-history filters are not present; Run Maintenance Now to add them.';
		}

		return 'Accelerates history walks and file history.';
	}

	private renderSuggestionCard(lever: GitHealthLever) {
		const copy = leverCopy[lever.id];
		const busy = this.isBusy(lever.id);
		const report = this._report;
		const finding = report?.findings.find(f => f.action.kind === 'optimization' && f.action.id === lever.id);

		return html`<div class="card" data-health-item=${lever.id} tabindex="-1">
			<div class="card-head" @click=${(e: MouseEvent) => this.onDisclosureAreaClick(lever.id, 'card-action', e)}>
				${this.renderTwistie(lever.id, copy.label)}
				<span class="card-title">${copy.label}</span>
				<gl-button
					class="card-action"
					data-health-action=${lever.id}
					appearance="primary"
					aria-label=${`Enable ${copy.label}`}
					?disabled=${busy || this.switching}
					@click=${() =>
						void this.run(
							lever.id,
							async repoPath => (await this.services!.graphHealth).applyFix(repoPath, lever.id),
							{
								successMessage: `${copy.label} enabled.`,
								notAppliedMessage: `${copy.label} could not be enabled. Review its updated status for details.`,
								focusKey: lever.id,
							},
						)}
					>${busy ? 'Enabling…' : 'Enable'}</gl-button
				>
			</div>
			<span class="card-blurb">${copy.blurb}</span>
			${this.renderChangesLine(copy.changes)}
			${finding != null && report != null ? this.renderMeter(finding, report) : nothing}
			${
				copy.warning != null
					? html`<div class="note"><code-icon icon="warning"></code-icon><span>${copy.warning}</span></div>`
					: nothing
			}
			${
				lever.note != null
					? html`<div class="note"><code-icon icon="warning"></code-icon><span>${lever.note}</span></div>`
					: nothing
			}
			${this.renderLeverDetails(lever.id, copy.details)}
		</div>`;
	}

	/** The verdict's one-line evidence strip — same data resolution `renderProfile` used to show at length. */
	private renderFactsStrip(report: GitHealthReport) {
		const details = this._details;
		const countObjects = details?.countObjects;

		const packBytes = countObjects?.sizePack ?? report.packBytes;
		const packCount = countObjects?.packs ?? report.packCount;

		let looseText: string;
		let looseCount: number;
		if (countObjects != null) {
			looseCount = countObjects.count;
			looseText = looseCount.toLocaleString();
		} else {
			looseCount = report.estimatedLooseObjects;
			looseText = `~${(Math.round(looseCount / 100) * 100).toLocaleString()}`;
		}

		const files = this.getTrackedFilesCopy(report);
		const looseFinding = report.findings.some(
			f => f.action.kind === 'maintenance' && f.action.task === 'loose-objects',
		);

		return html`<span class="verdict-facts">
			<span class="fact"
				><b>${formatBytes(packBytes)}</b> in ${packCount.toLocaleString()}
				${pluralize('pack', packCount, {
					only: true,
				})}</span
			>
			<span class="sep">·</span>
			<span class="fact"><b>${files.value}</b> ${files.label}</span>
			${
				details?.commitCount != null
					? html`<span class="sep">·</span>
							<span class="fact"
								><b>${details.commitCount.toLocaleString()}</b> ${pluralize(
									'commit',
									details.commitCount,
									{
										only: true,
									},
								)}</span
							>`
					: nothing
			}
			<span class="sep">·</span>
			<span class="fact${looseFinding ? ' warn' : ''}"
				><b>${looseText}</b> loose ${pluralize('object', looseCount, { only: true })}</span
			>
		</span>`;
	}

	/**
	 * Shared ledger-row shell — twistie, state icon, name, status text, and action on the first line;
	 * benefit always follows on its own line, consequence only for rows with a visible action to explain,
	 * and the appended disclosure last. `changesPhrase` is included in the disclosure only when `consequence`
	 * is absent — a row that already showed its consequence has nothing left for Changes to add.
	 */
	private renderRow(
		key: GitOptimizationId | 'commitGraph',
		icon: string,
		tone: string,
		name: string,
		status: unknown,
		action: unknown,
		benefit: unknown,
		consequence: unknown,
		details: LeverDetails,
		changesPhrase?: unknown,
	) {
		return html`<div
			class="ledger-row"
			data-health-item=${key}
			tabindex="-1"
			@click=${(e: MouseEvent) => this.onDisclosureAreaClick(key, 'ledger-action', e)}
		>
			${this.renderTwistie(key, name)}
			<code-icon class="ledger-state" data-tone=${tone} icon=${icon}></code-icon>
			<span class="ledger-name">${name}</span>
			<span class="ledger-status">${status}</span>
			<span class="ledger-action">${action}</span>
			<span class="ledger-line"><span class="ledger-line-text">${benefit}</span></span>
			${
				consequence != null
					? html`<span class="ledger-line"><span class="ledger-line-text">${consequence}</span></span>`
					: nothing
			}
			${this.renderLeverDetails(key, details, consequence == null ? changesPhrase : undefined)}
		</div>`;
	}

	/** Pinned ledger row for the commit-graph cache — the only lever with an on/off action of its own. */
	private renderCommitGraphRow(report: GitHealthReport) {
		const cg = report.commitGraph;
		const busy = this.isBusy('commitGraph');

		const setEnabled = (enabled: boolean) => () =>
			void this.run(
				'commitGraph',
				async repoPath => (await this.services!.graphHealth).setCommitGraphEnabled(repoPath, enabled),
				{
					successMessage: `Commit-graph cache ${enabled ? 'enabled' : 'disabled'}.`,
					focusKey: 'commitGraph',
				},
			);

		let icon: string;
		let tone: string;
		let status: unknown;
		let action: unknown = nothing;
		if (cg.readDisabled) {
			// `core.commitGraph=false` in the user's own git config: git won't read the cache, and
			// `ensureCommitGraph` honors the same setting as a write opt-out — so no toggle is offered
			// here. Like a user-enabled lever, an explicit git-config choice is theirs alone to change.
			icon = 'circle-slash';
			tone = 'off';
			status = 'Off · disabled via Git config (core.commitGraph)';
		} else if (cg.disabled === true) {
			icon = 'circle-slash';
			tone = 'off';
			status = 'Off · disabled for this repository';
			action = html`<gl-button
				data-health-action="commitGraph"
				appearance="toolbar"
				?disabled=${busy || this.switching}
				@click=${setEnabled(true)}
				>${busy ? 'Enabling…' : 'Enable'}</gl-button
			>`;
		} else {
			if (cg.present) {
				icon = 'check';
				tone = 'on';
				status = html`On · <span class="owner-gl">maintained by GitLens</span>`;
			} else {
				icon = 'circle-large-outline';
				tone = 'off';
				status = 'Will be built automatically after the next Commit Graph load';
			}

			action = html`<gl-button
				data-health-action="commitGraph"
				appearance="toolbar"
				?disabled=${busy || this.switching}
				@click=${setEnabled(false)}
				>${busy ? 'Disabling…' : 'Disable'}</gl-button
			>`;
		}

		return this.renderRow(
			'commitGraph',
			icon,
			tone,
			'Commit-graph cache',
			status,
			action,
			this.renderCommitGraphBenefit(cg),
			undefined,
			commitGraphDetails,
		);
	}

	private renderLedgerRow(lever: GitHealthLever) {
		const copy = leverCopy[lever.id];
		const busy = this.isBusy(lever.id);

		let icon: string;
		let tone: string;
		let status: unknown;
		let action: unknown = nothing;
		switch (lever.status) {
			case 'applied':
				icon = 'check';
				tone = 'on';
				status = html`On · <span class="owner-gl">enabled by GitLens</span>`;
				action = html`<gl-button
					data-health-action=${lever.id}
					appearance="toolbar"
					aria-label=${`Undo ${copy.label}`}
					?disabled=${busy || this.switching}
					@click=${() =>
						void this.run(
							lever.id,
							async repoPath => (await this.services!.graphHealth).revertFix(repoPath, lever.id),
							{
								successMessage: `${copy.label} restored to its previous setting.`,
								focusKey: lever.id,
							},
						)}
					>${busy ? 'Undoing…' : 'Undo'}</gl-button
				>`;
				break;
			case 'userEnabled':
				icon = 'check';
				tone = 'on';
				// `backgroundMaintenance` runs on Git's own scheduler, not the browser's git-config lookup —
				// worded as ownership, not as GitLens deferring.
				status =
					lever.id === 'backgroundMaintenance' ? 'On · maintained by Git' : 'On · enabled via Git config';
				break;
			case 'available':
				icon = 'circle-large-outline';
				tone = 'off';
				status = 'Off · not needed';
				break;
			default:
				icon = 'circle-slash';
				tone = 'off';
				status = `Unavailable — ${lever.reason ?? ''}`;
				break;
		}

		return this.renderRow(
			lever.id,
			icon,
			tone,
			copy.label,
			status,
			action,
			this.renderLedgerBenefit(lever, copy),
			this.renderLedgerConsequence(lever),
			copy.details,
			this.renderLedgerChangesPhrase(lever),
		);
	}

	override render(): unknown {
		const maintenanceBusy = this.isBusy('maintenance');
		const suggested = this._levers.filter(l => l.status === 'suggested');
		const applied = this._levers.filter(l => l.status === 'applied');
		const userEnabled = this._levers.filter(l => l.status === 'userEnabled');
		const available = this._levers.filter(l => l.status === 'available');
		const unavailable = this._levers.filter(l => l.status === 'unavailable' || l.status === 'notApplicable');
		const ledgerLevers = [...applied, ...userEnabled, ...available, ...unavailable];
		const incomplete = this._levers.some(l => l.checkFailed === true);

		return html`
			<div class="header-row">
				<gl-graph-visualizations-switcher></gl-graph-visualizations-switcher>
				<span class="header-row__title">Repository Health</span>
				<div class="header-row__right">
					<gl-button
						data-health-action="maintenance"
						appearance="toolbar"
						?disabled=${maintenanceBusy || this.switching}
						tooltip="Run Maintenance Now"
						aria-label="Run Maintenance Now"
						@click=${() =>
							void this.run(
								'maintenance',
								async repoPath => (await this.services!.graphHealth).runMaintenance(repoPath),
								{
									successMessage: 'Repository maintenance finished.',
									focusKey: 'maintenance',
								},
							)}
						><code-icon icon="tools"></code-icon
						><span class="run-label"
							>${maintenanceBusy ? 'Running…' : 'Run Maintenance Now'}</span
						></gl-button
					>
					<gl-button
						appearance="toolbar"
						tooltip="Close Visualizations"
						aria-label="Close Visualizations"
						@click=${this.onCloseClick}
					>
						<code-icon icon="close"></code-icon>
					</gl-button>
				</div>
			</div>
			<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this._announcement}</span>
			<div class="body scrollable" aria-busy=${this._loading || this.hasBusyAction}>
				${
					// Only the shown repo's failure banners here — a late error from the previous repo's
					// action must not misattribute itself to the repo now on screen.
					this._error != null && this._error.repoPath === this._loadedRepoPath
						? html`<div class="error" role="alert">${this._error.message}</div>`
						: nothing
				}
				${this.renderVerdict(suggested.length, incomplete)}
				${
					suggested.length
						? html`<div class="suggestions">${suggested.map(l => this.renderSuggestionCard(l))}</div>`
						: nothing
				}
				${
					ledgerLevers.length || this._report != null
						? html`<div class="section">
								<span class="section-label">Optimizations</span>
								<div class="ledger">
									${this._report != null ? this.renderCommitGraphRow(this._report) : nothing}
									${ledgerLevers.map(l => this.renderLedgerRow(l))}
								</div>
							</div>`
						: nothing
				}
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-git-health': GlGraphGitHealth;
	}
}
