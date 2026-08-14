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
import { graphServicesContext, graphStateContext } from '../context.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import './gl-graph-visualizations-switcher.js';

type LeverDetails = { what: string; tradeoffs: string };

/** Display copy per lever — deliberately named for what the person gets, not for the config key. */
const leverCopy: Record<GitOptimizationId, { label: string; blurb: string; details: LeverDetails }> = {
	untrackedCache: {
		label: 'Untracked cache',
		blurb: 'Lets Git skip re-scanning untracked files it has already seen.',
		details: {
			what: `Git remembers each directory's modification time and skips re-scanning directories that haven't changed when looking for new files, so status checks stop re-walking the whole tree.`,
			tradeoffs: `Requires reliable directory timestamps. On some network drives, containers, or repos shared between Windows and WSL, timestamps can be untrustworthy and Git could miss newly created files — so GitLens runs Git's own filesystem test before enabling it, and never re-suggests it where that test failed.`,
		},
	},
	fsmonitor: {
		label: 'File system monitor',
		blurb: 'Runs a background daemon so Git stops scanning every file on each status check.',
		details: {
			what: `Git's built-in daemon watches for file changes as they happen, so a status check reads a small change journal instead of scanning the working tree — near-instant status even on huge repositories.`,
			tradeoffs: `Runs one background process per repository for as long as Git is in use there. Unsupported on some filesystems (network shares, some virtual filesystems). Requires Git 2.37 on Windows/macOS, 2.55 on Linux.`,
		},
	},
	manyFiles: {
		label: 'Large-repository index',
		blurb: 'Speeds up index reads and writes for repositories with tens of thousands of files.',
		details: {
			what: `Switches Git's index to a compressed format, skips the index checksum on writes, and enables the untracked cache — together making status, add, and checkout faster when the index is large.`,
			tradeoffs: `Git versions older than 2.13 cannot read the compressed index at all, and fsck before 2.40 reports it as corrupted — this matters if other tools on this machine bundle an old Git. The checksum skip trades a small integrity check for write speed.`,
		},
	},
	backgroundMaintenance: {
		label: 'Scheduled maintenance',
		blurb: 'Lets Git maintain this repository on a schedule, including while VS Code is closed.',
		details: {
			what: `Registers this repository with your operating system's scheduler so Git runs its own maintenance — prefetching, commit-graph updates, packing — hourly and daily, even while VS Code is closed.`,
			tradeoffs: `Adds a system-level scheduled task and a global Git config entry. Undo unregisters this repository but leaves the scheduler itself in place. On shared or managed machines a background task may be unwanted.`,
		},
	},
};

/** Details copy for the pinned commit-graph ledger row — not a lever, so kept out of {@link leverCopy}. */
const commitGraphDetails: LeverDetails = {
	what: `A standard Git cache of the commit history's shape, plus per-commit file-change filters, that Git consults instead of unpacking commits — dramatically faster graph loads, history walks, and file history. Safe to delete at any time; Git rebuilds it.`,
	tradeoffs: `Uses a small amount of disk inside .git and a little background CPU after history changes. Disable it here for this repository, or everywhere via the gitlens.gitOptimizations.enabled setting, if another tool owns your repository maintenance.`,
};

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
	static override styles = css`
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
			/* The fixed name column starves the why column at side-bar width, clipping the state/owner
			   info to a character — wrap it onto its own line under the name instead. */
			.ledger-row {
				flex-wrap: wrap;
				row-gap: var(--gl-space-2);
			}
			.ledger-row .ledger-name {
				width: auto;
			}
			.ledger-row .ledger-action {
				margin-inline-start: auto;
			}
			.ledger-row .ledger-why {
				order: 4;
				flex-basis: 100%;
				min-width: 0;
				padding-inline-start: 2.6rem;
			}
		}

		.body {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
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
			padding: var(--gl-space-12) var(--gl-space-16);
			background: var(--vscode-editorWidget-background);
			border: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
			border-radius: var(--gl-radius-sm);
		}
		.card-head {
			display: flex;
			align-items: center;
			gap: var(--gl-space-10);
		}
		.card-title {
			font-size: var(--gl-font-lg);
			font-weight: 600;
		}
		.card-action {
			margin-inline-start: auto;
		}
		.card-blurb-row {
			display: flex;
			align-items: flex-start;
			gap: var(--gl-space-4);
		}
		.card-blurb {
			font-size: var(--gl-font-base);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
			max-width: 54rem;
		}

		.details-toggle {
			flex: none;
			font-size: var(--gl-font-sm);
		}
		.lever-details {
			font-size: var(--gl-font-md);
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
			max-width: 54rem;
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-4);
		}
		.lever-details b {
			color: var(--vscode-foreground);
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

		.card-note {
			display: flex;
			gap: var(--gl-space-6);
			align-items: baseline;
			font-size: var(--gl-font-md);
			color: var(--vscode-descriptionForeground);
			line-height: 1.45;
			max-width: 54rem;
		}
		.card-note code-icon {
			flex: none;
			color: var(--vscode-editorWarning-foreground);
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

		/* ── Repository profile: evidence base, quiet. */
		.anatomy {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-6);
		}
		.anatomy-bar {
			display: flex;
			height: 0.6rem;
			border-radius: var(--gl-radius-xs);
			overflow: hidden;
			background: var(--vscode-editorWidget-background);
		}
		.anatomy-bar .packed {
			background: var(--vscode-charts-blue);
		}
		.anatomy-bar .loose {
			background: var(--vscode-charts-orange);
		}
		.anatomy-facts {
			display: flex;
			flex-wrap: wrap;
			column-gap: var(--gl-space-6);
			row-gap: var(--gl-space-2);
			font-size: var(--gl-font-md);
			color: var(--vscode-descriptionForeground);
		}
		.anatomy-facts b {
			color: var(--vscode-foreground);
			font-weight: 600;
			font-variant-numeric: tabular-nums;
		}
		.anatomy-facts .fact.warn,
		.anatomy-facts .fact.warn b {
			color: var(--vscode-editorWarning-foreground);
		}
		.anatomy-facts .sep {
			color: var(--vscode-descriptionForeground);
			opacity: 0.6;
		}
		.anatomy-facts .key {
			display: inline-block;
			width: 0.8rem;
			height: 0.8rem;
			border-radius: var(--gl-radius-xs);
			margin-inline-end: var(--gl-space-4);
		}
		.anatomy-facts .key--packed {
			background: var(--vscode-charts-blue);
		}
		.anatomy-facts .key--loose {
			background: var(--vscode-charts-orange);
		}

		/* ── Ledger: everything not needing attention. One quiet line each; detail stays one line. */
		.ledger {
			display: flex;
			flex-direction: column;
		}
		.ledger-row {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: var(--gl-space-10);
			padding: var(--gl-space-6) var(--gl-space-2);
			font-size: var(--gl-font-base);
		}
		.ledger-row .lever-details {
			order: 5;
			flex-basis: 100%;
			padding-inline-start: 2.6rem;
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
		.ledger-why {
			display: flex;
			align-items: baseline;
			gap: var(--gl-space-4);
			flex: 1;
			min-width: 0;
			color: var(--vscode-descriptionForeground);
			font-size: var(--gl-font-md);
		}
		.ledger-why-text {
			min-width: 0;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.ledger-why .details-toggle {
			flex: none;
		}
		.ledger-action {
			flex: none;
		}
		.owner-gl {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
		}
	`;

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
	): Promise<void> {
		// Captured synchronously, before any await — the value a click targets can never drift out from
		// under it even if the displayed repo changes while the action is in flight.
		const repoPath = this._loadedRepoPath;
		if (repoPath == null) return;

		const busyKey = `${repoPath}\0${key}`;
		this._busy = new Set(this._busy).add(busyKey);
		this._error = undefined;
		try {
			await action(repoPath);
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
			await this.refresh();
		}
	}

	/** `~48,200` when the count is an estimate, `48,200` when the report says it's exact. */
	private formatTrackedFiles(report: GitHealthReport): string {
		return `${report.trackedFilesExact ? '' : '~'}${report.estimatedTrackedFiles.toLocaleString()}`;
	}

	private renderVerdict(suggestedCount: number, incomplete: boolean) {
		const report = this._report;
		if (report == null) {
			if (this._loading) {
				return html`<div class="verdict-placeholder">Checking repository health…</div>`;
			}

			return nothing;
		}

		if (suggestedCount > 0) {
			const caveat = incomplete ? ` Some checks couldn't be completed.` : '';
			const sub = report.clearlyLarge
				? `This is a large repository — Git has features that help at this size but doesn't enable on its own. GitLens already handles routine upkeep automatically.${caveat}`
				: `GitLens already handles routine upkeep automatically.${caveat}`;

			return html`<div class="verdict" data-tone="attn">
				<code-icon icon="sparkle"></code-icon>
				<div class="verdict-text">
					<span class="verdict-title">${pluralize('optimization', suggestedCount)} suggested</span>
					<span class="verdict-sub">${sub}</span>
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
				const files = this.formatTrackedFiles(report);
				valueLabel = html`<b>${files}</b> tracked files`;
				thresholdLabel = `helps above ${threshold.toLocaleString()}`;
				ariaValueText = `${files} tracked files; ${thresholdLabel}`;
				break;
			}
			case 'largePacks': {
				const bytes = formatBytes(value);
				valueLabel = html`<b>${bytes}</b> of pack data`;
				thresholdLabel = `suggested above ${formatBytes(threshold)}`;
				ariaValueText = `${bytes} of pack data; ${thresholdLabel}`;
				break;
			}
			case 'slowness': {
				const seconds = (value / 1000).toFixed(1);
				return html`<div class="meter">
					<div class="meter-labels">
						<span>slow Git commands observed (up to <b>${seconds}s</b>)</span>
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

	/** Small quiet disclosure control — shared by suggestion cards and ledger rows. */
	private renderDetailsToggle(key: GitOptimizationId | 'commitGraph') {
		const expanded = this._expanded.has(key);

		return html`<gl-button
			class="details-toggle"
			appearance="toolbar"
			aria-expanded=${expanded}
			aria-label="Details"
			@click=${() => this.onToggleDetails(key)}
		>
			<code-icon icon=${expanded ? 'chevron-up' : 'chevron-down'}></code-icon>
		</gl-button>`;
	}

	private renderLeverDetails(key: GitOptimizationId | 'commitGraph', details: LeverDetails) {
		if (!this._expanded.has(key)) return nothing;

		return html`<div class="lever-details">
			<span><b>What it does:</b> ${details.what}</span>
			<span><b>Trade-offs:</b> ${details.tradeoffs}</span>
		</div>`;
	}

	private renderSuggestionCard(lever: GitHealthLever) {
		const copy = leverCopy[lever.id];
		const busy = this.isBusy(lever.id);
		const report = this._report;
		const finding = report?.findings.find(f => f.action.kind === 'optimization' && f.action.id === lever.id);

		return html`<div class="card">
			<div class="card-head">
				<span class="card-title">${copy.label}</span>
				<gl-button
					class="card-action"
					appearance="primary"
					?disabled=${busy || this.switching}
					@click=${() =>
						void this.run(lever.id, async repoPath =>
							(await this.services!.graphHealth).applyFix(repoPath, lever.id),
						)}
					>${busy ? 'Enabling…' : 'Enable'}</gl-button
				>
			</div>
			<div class="card-blurb-row">
				<span class="card-blurb">${copy.blurb}</span>
				${this.renderDetailsToggle(lever.id)}
			</div>
			${this.renderLeverDetails(lever.id, copy.details)}
			${finding != null && report != null ? this.renderMeter(finding, report) : nothing}
			${
				lever.id === 'backgroundMaintenance' && lever.note
					? html`<div class="card-note">
							<code-icon icon="warning"></code-icon><span>${lever.note}</span>
						</div>`
					: nothing
			}
		</div>`;
	}

	private renderProfile(report: GitHealthReport) {
		const details = this._details;
		const countObjects = details?.countObjects;

		const packBytes = countObjects?.sizePack ?? report.packBytes;
		const packCount = countObjects?.packs ?? report.packCount;

		let loosePct: number;
		let looseText: string;
		let looseCount: number;
		if (countObjects != null) {
			const total = countObjects.count + countObjects.inPack;
			loosePct = total > 0 ? (countObjects.count / total) * 100 : 0;
			looseText = countObjects.count.toLocaleString();
			looseCount = countObjects.count;
		} else {
			const estimated = report.estimatedLooseObjects;
			looseCount = estimated;
			loosePct = Math.min(0.35, estimated / (estimated + 50_000)) * 100;
			looseText = `~${(Math.round(estimated / 100) * 100).toLocaleString()}`;
		}

		const packedPct = 100 - loosePct;

		const filesText = this.formatTrackedFiles(report);
		const looseFinding = report.findings.some(
			f => f.action.kind === 'maintenance' && f.action.task === 'loose-objects',
		);

		return html`<div class="section">
			<span class="section-label">Repository profile</span>
			<div class="anatomy">
				<div class="anatomy-bar">
					<span class="packed" style=${cspStyleMap({ width: `${packedPct}%` })}></span>
					<span class="loose" style=${cspStyleMap({ width: `${loosePct}%` })}></span>
				</div>
				<div class="anatomy-facts">
					<span class="fact"
						><span class="key key--packed"></span><b>${formatBytes(packBytes)}</b> packed in
						<b>${packCount.toLocaleString()}</b> ${pluralize('pack', packCount, { only: true })}</span
					>
					<span class="sep">·</span>
					<span class="fact${looseFinding ? ' warn' : ''}"
						><span class="key key--loose"></span><b>${looseText}</b> loose
						${pluralize('object', looseCount, { only: true })}</span
					>
					<span class="sep">·</span>
					<span class="fact"><b>${filesText}</b> tracked files</span>
					${
						details?.commitCount != null
							? html`<span class="sep">·</span>
									<span class="fact"
										><b>${details.commitCount.toLocaleString()}</b> ${pluralize(
											'commit',
											details.commitCount,
											{ only: true },
										)}</span
									>`
							: nothing
					}
				</div>
				${
					looseFinding
						? html`<div class="anatomy-facts">
								<span class="fact">Loose objects will be packed on the next automatic pass</span>
							</div>`
						: nothing
				}
			</div>
		</div>`;
	}

	/** Shared ledger-row shell — state icon, name, why (with its Details toggle), action, and disclosure. */
	private renderRow(
		key: GitOptimizationId | 'commitGraph',
		icon: string,
		tone: string,
		name: string,
		why: unknown,
		action: unknown,
		details: LeverDetails,
	) {
		return html`<div class="ledger-row">
			<code-icon class="ledger-state" data-tone=${tone} icon=${icon}></code-icon>
			<span class="ledger-name">${name}</span>
			<span class="ledger-why">
				<span class="ledger-why-text">${why}</span>
				${this.renderDetailsToggle(key)}
			</span>
			<span class="ledger-action">${action}</span>
			${this.renderLeverDetails(key, details)}
		</div>`;
	}

	/** Pinned ledger row for the commit-graph cache — the only lever with an on/off action of its own. */
	private renderCommitGraphRow(report: GitHealthReport) {
		const cg = report.commitGraph;
		const busy = this.isBusy('commitGraph');

		const setEnabled = (enabled: boolean) => () =>
			void this.run('commitGraph', async repoPath =>
				(await this.services!.graphHealth).setCommitGraphEnabled(repoPath, enabled),
			);

		let icon: string;
		let tone: string;
		let why: unknown;
		let action: unknown = nothing;
		if (cg.readDisabled) {
			// `core.commitGraph=false` in the user's own git config: git won't read the cache, and
			// `ensureCommitGraph` honors the same setting as a write opt-out — so no toggle is offered
			// here. Like a user-enabled lever, an explicit git-config choice is theirs alone to change.
			icon = 'circle-slash';
			tone = 'off';
			why = 'Off · disabled in your Git config (core.commitGraph) — GitLens leaves it alone';
		} else if (cg.disabled === true) {
			icon = 'circle-slash';
			tone = 'off';
			why = 'Off · disabled for this repository';
			action = html`<gl-button appearance="toolbar" ?disabled=${busy || this.switching} @click=${setEnabled(true)}
				>${busy ? 'Enabling…' : 'Enable'}</gl-button
			>`;
		} else {
			if (cg.present) {
				icon = 'check';
				tone = 'on';
				// A git without changed-paths support can't write file-history filters — don't promise them.
				const filtersBuilding =
					!cg.changedPaths && cg.changedPathsSupported ? ' · file-history filters build over time' : '';
				why = html`On · <span class="owner-gl">maintained by GitLens</span> — accelerates history walks and file
					history${filtersBuilding}`;
			} else {
				icon = 'circle-large-outline';
				tone = 'off';
				why = 'Will be built automatically after the next Commit Graph load';
			}

			action = html`<gl-button
				appearance="toolbar"
				?disabled=${busy || this.switching}
				@click=${setEnabled(false)}
				>${busy ? 'Disabling…' : 'Disable'}</gl-button
			>`;
		}

		return this.renderRow('commitGraph', icon, tone, 'Commit-graph cache', why, action, commitGraphDetails);
	}

	private renderLedgerRow(lever: GitHealthLever) {
		const copy = leverCopy[lever.id];
		const busy = this.isBusy(lever.id);
		const report = this._report;

		let icon: string;
		let tone: string;
		let why: unknown;
		let action: unknown = nothing;
		switch (lever.status) {
			case 'applied':
				icon = 'check';
				tone = 'on';
				why = html`On · <span class="owner-gl">enabled by GitLens</span>`;
				action = html`<gl-button
					appearance="toolbar"
					?disabled=${busy || this.switching}
					@click=${() =>
						void this.run(lever.id, async repoPath =>
							(await this.services!.graphHealth).revertFix(repoPath, lever.id),
						)}
					>${busy ? 'Undoing…' : 'Undo'}</gl-button
				>`;
				break;
			case 'userEnabled':
				icon = 'check';
				tone = 'on';
				why = 'On · enabled in your Git config — GitLens leaves it alone';
				break;
			case 'available': {
				icon = 'circle-large-outline';
				tone = 'off';
				const evidence =
					lever.id === 'backgroundMaintenance'
						? 'for large or chronically slow repositories'
						: `helps above ${trackedFilesThreshold.toLocaleString()} tracked files; this repository has ${
								report != null ? this.formatTrackedFiles(report) : 'fewer'
							}`;
				why = `Off · not needed — ${evidence}`;
				break;
			}
			default:
				icon = 'circle-slash';
				tone = 'off';
				why = `Unavailable — ${lever.reason ?? ''}`;
				break;
		}

		return this.renderRow(lever.id, icon, tone, copy.label, why, action, copy.details);
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
		const ledgerLabel =
			suggested.length > 0 && available.length === 0 && unavailable.length === 0
				? 'Already handled'
				: 'Optimizations';

		return html`
			<div class="header-row">
				<gl-graph-visualizations-switcher></gl-graph-visualizations-switcher>
				<span class="header-row__title">Repository Health</span>
				<div class="header-row__right">
					<gl-button
						appearance="toolbar"
						?disabled=${maintenanceBusy || this.switching}
						tooltip="Run Maintenance Now"
						aria-label="Run Maintenance Now"
						@click=${() =>
							void this.run('maintenance', async repoPath =>
								(await this.services!.graphHealth).runMaintenance(repoPath),
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
			<div class="body">
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
				${this._report != null ? this.renderProfile(this._report) : nothing}
				${
					ledgerLevers.length || this._report != null
						? html`<div class="section">
								<span class="section-label">${ledgerLabel}</span>
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
