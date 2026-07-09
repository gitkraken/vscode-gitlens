import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { classifyConflictAction } from '@gitlens/git/utils/conflictResolution.utils.js';
import type { ConflictKind } from '@gitlens/git/utils/conflictResolution.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type {
	ConflictSide,
	ResolvedFileSummary,
	ResolveFileError,
	ResolveSkippedFile,
} from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { GlAiInput } from '../../../shared/components/ai-input.js';
import { cspStyleMap } from '../../../shared/components/csp-style-map.directive.js';
import { scrollableBase, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemCheckedDetail } from '../../../shared/components/tree/base.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { prunePathsToFiles } from './aiExclusion.js';
import { confidenceLevel, renderConfidence, resolveDisplayStyles, strategyDisplay } from './resolveDisplay.js';
import { renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import { panelErrorStyles, panelHostStyles, panelLoadingStageStyles, panelLoadingStyles } from './shared-panel.css.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/button.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import './gl-converging-loading-animation.js';

export type ResolveModeStatus = 'idle' | 'loading' | 'ready' | 'error' | 'applying';

export interface ResolveViewDiffDetail {
	filePath: string;
}

export interface ResolveOpenFileDetail {
	filePath: string;
}

/** Short badge label + a distinct icon per conflict kind for the "needs your input" rows. The badge
 *  stays terse — the one-line explanation is carried by the row's message
 *  (`getConflictKindLabel(...).description`, computed host-side). A per-kind icon replaces a uniform
 *  warning glyph so the list is scannable; the amber tone + section already signal "needs you". */
const conflictKindDisplay: Record<ConflictKind, { label: string; icon: string }> = {
	text: { label: 'Text', icon: 'diff' },
	binary: { label: 'Binary', icon: 'file-binary' },
	symlink: { label: 'Symlink', icon: 'file-symlink-file' },
	submodule: { label: 'Submodule', icon: 'repo' },
	'mode-only': { label: 'File mode', icon: 'settings-gear' },
	'add-add': { label: 'Both added', icon: 'diff-added' },
	'delete-modify': { label: 'Modified & deleted', icon: 'diff-modified' },
	'both-deleted': { label: 'Both deleted', icon: 'trash' },
	'rename-rename': { label: 'Both renamed', icon: 'arrow-swap' },
	'rename-delete': { label: 'Renamed & deleted', icon: 'diff-renamed' },
	'rename-modify': { label: 'Renamed & modified', icon: 'diff-renamed' },
	unknown: { label: 'Conflict', icon: 'warning' },
};

/** Badge display for a still-conflicted (skipped/errored) row; falls back to a generic warning when
 *  the kind couldn't be determined. add/add is refined by status: git splits a real add/add into two
 *  one-sided paths (AU/UA), so only a true AA is "Both added" — AU/UA are labelled by their side. */
function kindDisplay(kind: ConflictKind | undefined, status?: GitFileConflictStatus): { label: string; icon: string } {
	if (kind === 'add-add') {
		if (status === 'AU') return { label: 'Added (current)', icon: 'diff-added' };
		if (status === 'UA') return { label: 'Added (incoming)', icon: 'diff-added' };
		return { label: 'Both added', icon: 'diff-added' };
	}
	return kind != null ? conflictKindDisplay[kind] : { label: 'Needs review', icon: 'warning' };
}

/** Drop the trailing action hint ("… — choose a side to keep") from a conflict description — the row's
 *  buttons already say what to do. */
function conflictWhat(message: string): string {
	const i = message.indexOf(' — ');
	return i === -1 ? message : message.slice(0, i);
}

/**
 * AI conflict-resolution mode panel for the graph WIP details. A third AI mode alongside compose
 * and review — like compose, it curates a checkable file set (here the paused op's conflicted
 * files) rather than a commit scope, and has no Back/Resume (apply is terminal). States: `idle`
 * (a checkable tree of the conflicted files + a Resolve button), `loading` (streamed progress),
 * `ready` (per-file resolutions with an Apply / Refine posture gate), `applying` (uncancellable
 * overlay), and `error`.
 */
@customElement('gl-details-resolve-mode-panel')
export class GlDetailsResolveModePanel extends LitElement {
	static override styles = [
		panelHostStyles,
		panelLoadingStyles,
		panelLoadingStageStyles,
		panelErrorStyles,
		scrollableBase,
		subPanelEnterStyles,
		resolveDisplayStyles,
		css`
			/* Matches the fade+slide-up entrance used by compose/review so resolve mode animates in
			   instead of popping. The @keyframes comes from subPanelEnterStyles; overflow is gated to
			   the animation's lifetime there, reverting to the panelHostStyles :host overflow-y: auto. */
			:host {
				animation: sub-panel-enter var(--gl-duration-medium) var(--gl-ease-out);
			}

			@media (prefers-reduced-motion: reduce) {
				:host {
					animation: none;
				}
			}

			.resolve-panel {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
			}

			.resolve-intro {
				margin: var(--gl-space-8) var(--gl-space-12) var(--gl-space-4);
				color: var(--vscode-descriptionForeground);
			}

			/* Scroll container for the whole ready-state result list (progress + both sections). */
			.resolve-results {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
				overflow-y: auto;
			}

			.resolve-files {
				margin: 0;
				padding: 0;
				list-style: none;
			}

			/* Progress summary above the sections — orientation before detail. */
			.resolve-progress {
				display: flex;
				flex: none;
				flex-direction: column;
				gap: var(--gl-space-6);
				padding: var(--gl-space-10) var(--gl-space-12);
				border-bottom: var(--gl-border-width) solid var(--vscode-panel-border);
			}

			.resolve-progress__text {
				display: flex;
				gap: var(--gl-space-6);
				align-items: baseline;
			}

			.resolve-progress__done {
				font-weight: 600;
			}

			.resolve-progress__sep {
				color: var(--vscode-descriptionForeground);
			}

			.resolve-progress__need {
				color: var(--vscode-editorWarning-foreground, #cca700);
				font-weight: 600;
			}

			.resolve-progress__bar {
				display: flex;
				height: 0.4rem;
				overflow: hidden;
				border-radius: 999px;
				background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
			}

			/* Two-tone fill: green = resolved fraction, amber = still-needs-input fraction, so the bar reads
			   as a split rather than "complete". Segments size by flex-grow = their file count. */
			.resolve-progress__bar-seg {
				height: 100%;
				flex-basis: 0;
			}

			.resolve-progress__bar-seg--done {
				background: var(--vscode-charts-green, var(--vscode-testing-iconPassed, currentColor));
			}

			.resolve-progress__bar-seg--need {
				background: var(--vscode-editorWarning-foreground, #cca700);
			}

			/* Counted, collapsible result-group headers (Resolved / Needs your input). */
			.resolve-section {
				margin: 0;
				font: inherit;
			}

			/* Sticky so the group you're scrolled into stays labelled at the top of the list. */
			.resolve-section__head {
				position: sticky;
				top: 0;
				z-index: 1;
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				width: 100%;
				padding: var(--gl-space-8) var(--gl-space-12) var(--gl-space-6);
				color: var(--vscode-descriptionForeground);
				font: inherit;
				text-align: left;
				background: var(--vscode-sideBar-background, var(--vscode-editor-background));
				border: none;
				cursor: pointer;
			}

			.resolve-section__chevron {
				flex: none;
				transition: transform 0.15s ease;
			}

			.resolve-section__head[aria-expanded='false'] .resolve-section__chevron {
				transform: rotate(-90deg);
			}

			.resolve-section__status {
				flex: none;
			}

			.resolve-section__head--resolved .resolve-section__status {
				color: var(--vscode-charts-green, var(--vscode-testing-iconPassed));
			}

			.resolve-section__head--needs,
			.resolve-section__head--needs .resolve-section__status {
				color: var(--vscode-editorWarning-foreground, #cca700);
			}

			.resolve-section__label {
				font-size: var(--gl-font-sm);
				font-weight: 700;
				letter-spacing: 0.05em;
				text-transform: uppercase;
			}

			.resolve-section__count {
				padding: 0.05rem 0.5rem;
				font-size: var(--gl-font-sm);
				font-weight: 700;
				color: var(--vscode-badge-foreground);
				background: var(--vscode-badge-background);
				border-radius: 999px;
			}

			.resolve-section__head--needs .resolve-section__count {
				color: var(--vscode-editorWarning-foreground, #cca700);
				background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 22%, transparent);
			}

			.resolve-file {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
				padding: 0.5rem 1.2rem;
				border-top: var(--gl-border-width) solid var(--vscode-panel-border);
			}

			.resolve-file__head {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
			}

			.resolve-file__path {
				flex: 1;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
				white-space: nowrap;
			}

			/* Idle-state checkable conflict tree — fills the space between the intro and the run input. */
			.resolve-tree {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
				overflow: hidden;
			}

			/* The pane group is a flex child with no intrinsic grow — without this it stays at content
			   height and the inner gl-file-tree-pane (flex:1; min-height:0; overflow:hidden) collapses its
			   tree to ~0 and clips every row. Mirrors the .scope-files__tree webview-pane-group rule in
			   shared-panel.css.ts (compose's file curation). */
			.resolve-tree webview-pane-group {
				flex: 1;
				min-height: 0;
				overflow: hidden;
			}

			/* Badge + confidence-pip styles are shared with the auto-rebase summary sheet — see
			   resolveDisplayStyles (resolveDisplay.ts) in the styles array above. */

			.resolve-file__reasoning {
				margin: 0;
				color: var(--vscode-descriptionForeground);
				white-space: pre-wrap;
			}

			.resolve-file__error {
				color: var(--vscode-errorForeground);
			}

			/* Rename/rename decision: the two candidate names shown as indented side rows under the header. */
			.resolve-file__sides {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				margin: var(--gl-space-6) 0 var(--gl-space-2) var(--gl-space-6);
				padding-left: var(--gl-space-8);
				border-left: var(--gl-border-width) solid var(--vscode-panel-border);
			}

			.resolve-file__side {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.resolve-file__side-tag {
				flex: none;
				min-width: 5rem;
				font-size: var(--gl-font-sm);
				font-variant: all-small-caps;
				letter-spacing: 0.02em;
				color: var(--vscode-descriptionForeground);
			}

			.resolve-file__side-path {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				font-weight: 600;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			/* Prominent "View changes" — a labelled toolbar button rather than a bare diff icon. */
			.resolve-file__view {
				flex: none;
			}

			.resolve-file__view-label,
			.resolve-file__action-label {
				margin-left: 0.3rem;
			}

			/* Collapsible "Why this resolution" disclosure for each resolution's reasoning. */
			.resolve-file__why {
				display: inline-flex;
				gap: 0.3rem;
				align-items: center;
				align-self: flex-start;
				padding: var(--gl-space-2) 0;
				color: var(--vscode-descriptionForeground);
				font: inherit;
				font-size: var(--gl-font-sm);
				background: transparent;
				border: none;
				cursor: pointer;
			}

			.resolve-file__why:hover {
				color: var(--vscode-foreground);
			}

			.resolve-file__why-chevron {
				transition: transform 0.15s ease;
			}

			.resolve-file__why[aria-expanded='true'] .resolve-file__why-chevron {
				transform: rotate(90deg);
			}

			/* Ready-state action zone: the Refine gate on top, then either the Apply row (Apply posture)
			   or the detached refine input (Refine posture) — mirrors compose-plan__actions. The container
			   query below keeps the gate label and the right-anchored model tab from colliding when narrow. */
			.resolve-ready-actions {
				container: resolve-ready / inline-size;
				display: flex;
				flex: none;
				flex-direction: column;
				gap: var(--gl-space-8);
				padding: var(--gl-space-8) var(--gl-space-12) var(--gl-space-10);
				border-top: var(--gl-border-width) solid var(--vscode-panel-border);
			}

			.resolve-gate {
				align-self: flex-start;
			}

			/* Once wide enough that the gate label and the model tab can't collide, drop the gate's bottom
			   margin to pull the input up tight; narrower, keep it so the tab drops clear below the gate. */
			@container resolve-ready (min-width: 44rem) {
				.resolve-gate {
					margin-bottom: 0;
				}
			}

			/* Apply fills the row (primary, full-width treatment) with Discard inline on the right. */
			.resolve-apply-row {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.resolve-apply {
				flex: 1;
				min-width: 0;
			}

			/* aria-disabled (not native) keeps Apply hoverable so its "why" tooltip shows; dim it ourselves
			   since gl-button only styles the native disabled state. */
			.resolve-apply[aria-disabled='true'] {
				cursor: default;
				opacity: 0.4;
			}

			/* The detached refine input self-insets/-centres; inside the already-padded zone that doubles
			   the inset, so pin it flush to the zone's content box (mirrors compose's override). Orange-tint
			   the Refine submit with the SAME recompose accent compose uses (blue stays reserved for Apply);
			   the custom props pierce gl-ai-input's shadow boundary. */
			.resolve-ready-actions > gl-ai-input.resolve-refine-input {
				width: 100%;
				max-width: none;
				margin: 0;
				--gl-resolve-refine-accent: oklch(0.6 0.13 62);
				--gl-ai-submit-bg: var(--gl-resolve-refine-accent);
				--gl-ai-submit-hover-bg: color-mix(in srgb, #000 15%, var(--gl-resolve-refine-accent));
			}

			/* The per-row "Retry with feedback" button is a toggle — show the standard active-toggle
			   background while its feedback input is open (keyed off the existing aria-expanded). */
			.resolve-file__head gl-button[aria-expanded='true'] {
				--button-background: var(--vscode-inputOption-activeBackground);
				--button-foreground: var(--vscode-inputOption-activeForeground);
				--button-border: var(--vscode-inputOption-activeBorder);
			}

			.resolve-actions {
				display: flex;
				flex: none;
				flex-direction: column;
				gap: var(--gl-space-4);
				padding: var(--gl-space-6) var(--gl-space-12);
			}

			/* Match compose/review loading spacing: breathing room above + below the Cancel button. */
			.resolve-cancel {
				align-self: center;
				margin-top: var(--gl-space-10);
				margin-bottom: var(--gl-space-12);
			}

			/* Per-row feedback input, indented under its file. */
			.resolve-file__feedback {
				display: block;
				margin-top: var(--gl-space-4);
			}
		`,
	];

	@property({ attribute: 'status' }) status: ResolveModeStatus = 'idle';
	@property() errorMessage?: string;
	@property({ type: Array }) resolutions?: readonly ResolvedFileSummary[];
	@property({ type: Array }) errors?: readonly ResolveFileError[];
	@property({ type: Array }) skipped?: readonly ResolveSkippedFile[];
	@property({ type: Array }) conflictedFiles?: readonly GitFileChangeShape[];
	/** Drives the per-conflict DEFAULT checked state (per-file/multi-select entry defaults just these
	 *  on; undefined = all on). The live run scope is the user-editable {@link includedFiles}, NOT this. */
	@property({ type: Array }) focusedPaths?: readonly string[];
	@property() progressMessage?: string;
	@property({ type: Object }) aiModel?: AiModelInfo;
	/** Engaged anchor's repo path — part of the seed identity so following selection to another WIP
	 *  anchor reseeds (the panel element is reused across anchor switches, not re-mounted). */
	@property() repoPath?: string;
	/** Persisted file-tree layout preference, threaded to the idle `gl-file-tree-pane`. */
	@property() fileLayout: ViewFilesLayout = 'auto';
	/** Paths currently being re-resolved with feedback — drives the per-row busy state. */
	@property({ type: Object }) retryingFiles?: ReadonlySet<string>;
	/** Paths currently being manually resolved via a take-side fallback — drives the per-row busy state. */
	@property({ type: Object }) stagingFiles?: ReadonlySet<string>;
	/** The whole-run prompt, recalled into the "Refine" input (ArrowUp). */
	@property() lastPrompt?: string;
	/** Seed source for the ready-state "Refine Resolutions" posture. Pushed from the engaged resolve
	 *  entry's `refineMode` (captured on mode-leave), so toggling the resolve chip off/on or switching
	 *  rows restores the posture. Seeds {@link _refineMode} once per mount / anchor switch. */
	@property({ type: Boolean }) refineMode = false;
	/** Seed source for the ready-state Refine input's unsubmitted text. Pushed from the engaged resolve
	 *  entry's `refineDraft`. Seeds the refine `gl-ai-input`'s one-shot `.value`, remounted via
	 *  `keyed(repoPath)` so an anchor switch reseeds. */
	@property() refineDraft?: string;

	/** Rows whose per-file feedback input is expanded. Panel-local UI state. */
	@state() private _expandedRetry = new Set<string>();
	/** Rows whose "Why this resolution" reasoning is expanded. Seeded with low-confidence rows on
	 *  ready-entry (they warrant scrutiny); user toggles override. */
	@state() private _openReasons = new Set<string>();
	/** Collapsed result sections (`'resolved'` | `'needs'`) — both expanded by default. */
	@state() private _collapsedSections = new Set<string>();
	/** Ready-state posture: false = Apply (default), true = Refine. Toggled by the "Refine Resolutions"
	 *  gate checkbox — Apply and Refine are mutually-exclusive postures (compose's gate model), so the
	 *  refine input never shares the zone with Apply. Reset to Apply on each ready-entry (see willUpdate). */
	@state() private _refineMode = false;
	/** User check/uncheck DELTAS against the per-anchor default (resolve-all → all checked; focused
	 *  entry → just the focused paths). The effective checked set is DERIVED from the current conflicts
	 *  plus these deltas (see {@link includedFiles}/{@link isChecked}), so it always reflects the live
	 *  conflicts — a conflict resolved away drops out, a new one appears under the default — with no
	 *  stale stored set to reconcile. Reset when the anchor/focus identity changes. */
	@state() private _userChecked = new Set<string>();
	@state() private _userUnchecked = new Set<string>();
	/** Anchor+focus identity the deltas belong to. The panel element is REUSED when following selection
	 *  to another WIP anchor (hide→restore collapses to one render), so deltas must reset on identity
	 *  change here rather than relying on a fresh instance; `repoPath` is in the key so two resolve-all
	 *  anchors don't share key 'all' and leak deltas. */
	private _seedKey: string | undefined;

	/** The live checked set, read by the host's `resolve-run` handler to scope the run. Derived from
	 *  the CURRENT conflicts so it never includes a path that is no longer conflicted. */
	get includedFiles(): ReadonlySet<string> {
		const checked = new Set<string>();
		for (const f of this.conflictedFiles ?? []) {
			if (this.isChecked(f.path)) {
				checked.add(f.path);
			}
		}
		return checked;
	}

	/** Live Refine posture, read by the host on mode-leave to persist onto the engaged entry. Only
	 *  meaningful in the ready state (the gate/refine input only exist there); other states report the
	 *  default so a non-ready leave can't clobber a captured posture. */
	get refineModeLive(): boolean {
		return this.status === 'ready' ? this._refineMode : false;
	}

	/** Live unsubmitted Refine text, read by the host on mode-leave. Empty unless the refine input is
	 *  actually mounted (ready + refine posture). */
	get refineDraftLive(): string {
		if (this.status !== 'ready' || !this._refineMode) return '';
		return this.renderRoot.querySelector<GlAiInput>('gl-ai-input.resolve-refine-input')?.currentValue ?? '';
	}

	/** Default-checked state for a conflict: resolve-all entry checks everything; a focused entry
	 *  (single/multi-file) checks only its paths. */
	private isCheckedByDefault(path: string): boolean {
		return this.focusedPaths == null || this.focusedPaths.length === 0 || this.focusedPaths.includes(path);
	}

	/** Effective checked state = the default, overridden by the user's explicit check/uncheck delta. */
	private isChecked(path: string): boolean {
		if (this._userChecked.has(path)) return true;
		if (this._userUnchecked.has(path)) return false;
		return this.isCheckedByDefault(path);
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		// Ready always opens in Apply posture. A refine (or per-row retry) re-run returns through
		// loading→ready, so resetting here means the refreshed resolutions show Apply — not a still-ticked
		// gate hiding it. Placed before the early-returning identity block so it can't be skipped.
		if (changedProperties.has('status') && this.status === 'ready') {
			this._refineMode = false;
			// Auto-expand the reasoning of low-confidence resolutions so the risky ones get scrutiny.
			this._openReasons = new Set(
				(this.resolutions ?? [])
					.filter(r => r.reasoning && confidenceLevel(r.confidence) === 'low')
					.map(r => r.filePath),
			);
		}

		// Seed the live posture from the persisted `refineMode` on mount and on an anchor switch (the
		// element is reused across WIP-row switches). Gated on the property changing — the entry only
		// writes it on mode-leave, so it's stable during a session and never fights the local toggle.
		// Placed AFTER the status→ready reset so a completed refine still lands in Apply posture (that
		// transition doesn't change `refineMode`) and BEFORE the early-returning identity block below.
		if (changedProperties.has('refineMode')) {
			this._refineMode = this.refineMode;
		}

		// Reset the user deltas when the anchor/focus identity changes (fresh entry, or following
		// selection to another WIP). Gated to the identity inputs so the sort+join isn't recomputed on
		// unrelated reactive updates (progressMessage, retryingFiles, …).
		if (changedProperties.has('focusedPaths') || changedProperties.has('repoPath')) {
			const focusKey = this.focusedPaths != null ? `focus:${this.focusedPaths.toSorted().join('\n')}` : 'all';
			const seedKey = `${this.repoPath ?? ''}|${focusKey}`;
			if (this._seedKey !== seedKey) {
				this._seedKey = seedKey;
				this._userChecked = new Set();
				this._userUnchecked = new Set();
				return;
			}
		}

		// Drop deltas for paths no longer conflicted so a stale uncheck can't resurrect to suppress a
		// path that drops then re-conflicts in the same session (and the sets don't grow unbounded).
		// `prunePathsToFiles` skips the transient empty/undefined `conflictedFiles` during refetch.
		if (changedProperties.has('conflictedFiles')) {
			const checked = prunePathsToFiles(this._userChecked, this.conflictedFiles);
			if (checked != null) {
				this._userChecked = checked;
			}
			const unchecked = prunePathsToFiles(this._userUnchecked, this.conflictedFiles);
			if (unchecked != null) {
				this._userUnchecked = unchecked;
			}
		}
	}

	override render(): unknown {
		return html`<div class="resolve-panel" role="region" aria-label="Resolve conflicts">
			${this.renderContent()}
		</div>`;
	}

	private renderContent(): unknown {
		switch (this.status) {
			case 'loading':
				return this.renderLoading();
			case 'applying':
				return renderLoadingState('Applying resolutions…');
			case 'error':
				return renderErrorState(
					this.errorMessage,
					'An error occurred while resolving conflicts.',
					'resolve-error-retry',
					'resolve-error-back',
				);
			case 'ready':
				return this.renderReady();
			default:
				return this.renderIdle();
		}
	}

	private renderLoading(): unknown {
		// Converging-streams animation sits behind the spinner + progress + cancel as decoration;
		// it self-disables under prefers-reduced-motion.
		return html`
			<div class="panel-loading-stage">
				<gl-converging-loading-animation class="panel-loading-stage__anim"></gl-converging-loading-animation>
				<div class="panel-loading-stage__foreground">
					${renderLoadingState(this.progressMessage ?? 'Resolving conflicts…')}
					<gl-button
						class="resolve-cancel"
						appearance="secondary"
						@click=${() => this.emit('resolve-cancel')}
					>
						Cancel
					</gl-button>
				</div>
			</div>
		`;
	}

	private renderIdle(): unknown {
		const files = this.conflictedFiles ?? [];

		// Only checked files carry a state entry; the rest default to unchecked.
		let checkedCount = 0;
		const checkableStates = new Map<string, { state?: 'checked' }>();
		for (const f of files) {
			if (this.isChecked(f.path)) {
				checkableStates.set(f.path, { state: 'checked' });
				checkedCount++;
			}
		}

		return html`
			<p class="resolve-intro">
				Choose the conflicts to resolve with AI, then review each resolution before applying.
			</p>
			<div class="resolve-tree">
				<webview-pane-group flexible>
					<gl-file-tree-pane
						.files=${files}
						?checkable=${true}
						?multi-selectable=${true}
						?show-file-icons=${true}
						.collapsable=${false}
						.filesLayout=${{ layout: this.fileLayout }}
						.checkableStates=${checkableStates}
						selection-action="file-open"
						check-verb="Resolve"
						uncheck-verb="Skip"
						empty-text="No conflicted files"
						@file-checked=${this.onFileChecked}
						@gl-check-all=${this.onToggleCheckAll}
						@file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
							this.emit('resolve-open-file', { filePath: e.detail.path })}
					></gl-file-tree-pane>
				</webview-pane-group>
			</div>
			<div class="resolve-actions">
				<gl-ai-input
					multiline
					active
					rows="2"
					button-label="Resolve"
					busy-label="Resolving conflicts…"
					event-name="resolve-run"
					placeholder='Optional guidance — e.g. "prefer incoming for generated files"'
					?disabled=${checkedCount === 0}
					disabled-reason="Select Conflicts to Resolve"
					.value=${this.lastPrompt}
				>
					<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
				</gl-ai-input>
			</div>
		`;
	}

	/** Toggle a single conflicted file in/out of the resolve set. */
	private onFileChecked(e: CustomEvent<TreeItemCheckedDetail>): void {
		if (!e.detail.context) return;

		const [file] = e.detail.context as unknown as GitFileChangeShape[];
		if (!file) return;

		const checked = new Set(this._userChecked);
		const unchecked = new Set(this._userUnchecked);
		this.applyChecked(file.path, e.detail.checked, checked, unchecked);
		this._userChecked = checked;
		this._userUnchecked = unchecked;
	}

	/** Check/uncheck-all from the tree header — applies to all conflicted paths (the resolve tree has
	 *  no search box, so `gl-check-all` carries every conflict, not a filtered subset). */
	private onToggleCheckAll(e: CustomEvent<{ checked: boolean; paths: readonly string[] }>): void {
		const checked = new Set(this._userChecked);
		const unchecked = new Set(this._userUnchecked);
		for (const path of e.detail.paths) {
			this.applyChecked(path, e.detail.checked, checked, unchecked);
		}
		this._userChecked = checked;
		this._userUnchecked = unchecked;
	}

	/** Record `path`'s new checked state as a delta from its default — clearing the delta when the
	 *  state matches the default so the sets stay minimal and keep tracking future default changes. */
	private applyChecked(path: string, checked: boolean, userChecked: Set<string>, userUnchecked: Set<string>): void {
		userChecked.delete(path);
		userUnchecked.delete(path);
		if (checked !== this.isCheckedByDefault(path)) {
			(checked ? userChecked : userUnchecked).add(path);
		}
	}

	/** Toggle the ready-state Apply/Refine posture from the "Refine Resolutions" gate checkbox. */
	private handleToggleRefineMode(e: Event): void {
		this._refineMode = (e.target as { checked?: boolean }).checked ?? !this._refineMode;
	}

	private renderReady(): unknown {
		const resolutions = this.resolutions ?? [];
		const errors = this.errors ?? [];
		const skipped = this.skipped ?? [];
		const applicable = resolutions.filter(r => r.strategy !== 'skipped').length;
		// Always show the count when there's something to apply ("Apply 1 Resolution" / "Apply 3
		// Resolutions"); the disabled/none case reads the plain noun so it never says "0" or "all".
		const applyLabel = applicable > 0 ? `Apply ${pluralize('Resolution', applicable)}` : 'Apply Resolutions';

		const resolvedCount = resolutions.length;
		const needCount = skipped.length + errors.length;
		const total = resolvedCount + needCount;

		return html`
			${total > 0
				? html`<div class="resolve-progress">
						<span class="resolve-progress__text">
							<span class="resolve-progress__done">${resolvedCount} of ${total} resolved</span>
							${needCount > 0
								? html`<span class="resolve-progress__sep">·</span
										><span class="resolve-progress__need">${needCount} need your input</span>`
								: nothing}
						</span>
						<span class="resolve-progress__bar" aria-hidden="true">
							<span
								class="resolve-progress__bar-seg resolve-progress__bar-seg--done"
								style=${cspStyleMap({ 'flex-grow': String(resolvedCount) })}
							></span>
							<span
								class="resolve-progress__bar-seg resolve-progress__bar-seg--need"
								style=${cspStyleMap({ 'flex-grow': String(needCount) })}
							></span>
						</span>
					</div>`
				: nothing}
			<div class="resolve-results scrollable">
				${resolvedCount > 0
					? this.renderSection(
							'resolved',
							'Resolved',
							resolvedCount,
							'pass',
							repeat(
								resolutions,
								r => r.filePath,
								r => this.renderResolution(r),
							),
						)
					: nothing}
				${needCount > 0
					? this.renderSection(
							'needs',
							'Needs your input',
							needCount,
							'warning',
							this.renderNeedsBody(skipped, errors),
						)
					: nothing}
			</div>
			<div class="resolve-ready-actions">
				<gl-checkbox
					class="resolve-gate"
					?checked=${this._refineMode}
					@gl-change-value=${this.handleToggleRefineMode}
				>
					<code-icon icon="wand"></code-icon> Refine Resolutions
				</gl-checkbox>
				${this._refineMode
					? keyed(
							this.repoPath,
							html`<gl-ai-input
								appearance="detached"
								class="resolve-refine-input"
								multiline
								rows="2"
								button-label="Refine Resolutions"
								busy-label="Re-resolving…"
								event-name="resolve-refine"
								placeholder='Refine all — e.g. "prefer incoming for generated files"'
								.recall=${this.lastPrompt}
								.value=${this.refineDraft}
							>
								<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
								<gl-button
									slot="actions"
									appearance="secondary"
									@click=${() => this.emit('resolve-discard')}
									>Discard</gl-button
								>
							</gl-ai-input>`,
						)
					: html`<div class="resolve-apply-row">
							<gl-button
								class="resolve-apply"
								full
								aria-disabled=${applicable === 0 ? 'true' : nothing}
								tooltip=${applicable === 0 ? 'No resolutions ready to apply' : nothing}
								@click=${() => {
									if (applicable === 0) return;

									this.emit('resolve-apply-all');
								}}
								>${applyLabel}</gl-button
							>
							<gl-button appearance="secondary" @click=${() => this.emit('resolve-discard')}
								>Discard</gl-button
							>
						</div>`}
			</div>
		`;
	}

	/** A collapsible, counted result group (Resolved / Needs your input). Uses an `h3` with the toggle
	 *  as its button so assistive tech gets real section headings. */
	private renderSection(
		key: 'resolved' | 'needs',
		label: string,
		count: number,
		icon: string,
		body: unknown,
	): unknown {
		const expanded = !this._collapsedSections.has(key);
		// Header + rows share one group so the sticky header has room to stick while its rows scroll —
		// a header sticky inside a header-height wrapper has nowhere to travel.
		return html`<div class="resolve-section" role="group" aria-label=${label}>
			<button
				class="resolve-section__head resolve-section__head--${key}"
				aria-expanded=${expanded}
				@click=${() => this.toggleSection(key)}
			>
				<code-icon class="resolve-section__chevron" icon="chevron-down"></code-icon>
				<code-icon class="resolve-section__status" icon=${icon}></code-icon>
				<span class="resolve-section__label">${label}</span>
				<span class="resolve-section__count">${count}</span>
			</button>
			${expanded
				? html`<ul class="resolve-files">
						${body}
					</ul>`
				: nothing}
		</div>`;
	}

	private toggleSection(key: string): void {
		const next = new Set(this._collapsedSections);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		this._collapsedSections = next;
	}

	private toggleReason(filePath: string): void {
		const next = new Set(this._openReasons);
		if (next.has(filePath)) {
			next.delete(filePath);
		} else {
			next.add(filePath);
		}
		this._openReasons = next;
	}

	private renderResolution(r: ResolvedFileSummary): unknown {
		const display = strategyDisplay[r.strategy];
		const canViewDiff = r.virtualRef != null;
		const retrying = this.retryingFiles?.has(r.filePath) ?? false;
		const expanded = this._expandedRetry.has(r.filePath);
		const reasonOpen = this._openReasons.has(r.filePath);
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span
					class="resolve-file__badge ${display.warn ? 'resolve-file__badge--warn' : ''}"
					title="Resolution strategy"
				>
					<code-icon icon=${display.icon} size="11"></code-icon
					><span class="resolve-file__badge-text">${display.label}</span>
				</span>
				<span class="resolve-file__path">${r.filePath}</span>
				${renderConfidence(confidenceLevel(r.confidence))}
				${canViewDiff
					? html`<gl-button
							appearance="toolbar"
							class="resolve-file__view"
							aria-label="View resolved changes for ${r.filePath}"
							@click=${() => this.emit('resolve-view-diff', { filePath: r.filePath })}
						>
							<code-icon icon="diff"></code-icon
							><span class="resolve-file__view-label">View Changes</span>
						</gl-button>`
					: nothing}
				<gl-tooltip content=${retrying ? 'Re-resolving…' : 'Retry with feedback'}>
					<gl-button
						appearance="toolbar"
						aria-label=${retrying ? `Re-resolving ${r.filePath}…` : `Retry ${r.filePath} with feedback`}
						aria-expanded=${expanded}
						?disabled=${retrying}
						@click=${() => this.toggleRetry(r.filePath)}
					>
						<code-icon
							icon=${retrying ? 'loading' : 'feedback'}
							modifier=${retrying ? 'spin' : ''}
						></code-icon>
					</gl-button>
				</gl-tooltip>
			</div>
			${r.reasoning
				? html`<button
							class="resolve-file__why"
							aria-expanded=${reasonOpen}
							@click=${() => this.toggleReason(r.filePath)}
						>
							<code-icon class="resolve-file__why-chevron" icon="chevron-right"></code-icon>Why this
							resolution
						</button>
						${reasonOpen ? html`<p class="resolve-file__reasoning">${r.reasoning}</p>` : nothing}`
				: nothing}
			${expanded
				? html`<gl-ai-input
						class="resolve-file__feedback"
						multiline
						active
						floating-footer
						rows="1"
						button-label="Retry"
						busy-label="Re-resolving…"
						event-name="resolve-row-retry"
						placeholder='What was wrong? e.g. "keep the new import, drop the old one"'
						.busy=${retrying}
						@resolve-row-retry=${(e: CustomEvent<{ prompt?: string }>) => this.onRowRetry(r.filePath, e)}
					>
						<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
					</gl-ai-input>`
				: nothing}
		</li>`;
	}

	private toggleRetry(filePath: string): void {
		const next = new Set(this._expandedRetry);
		if (next.has(filePath)) {
			next.delete(filePath);
		} else {
			next.add(filePath);
		}
		this._expandedRetry = next;
	}

	/** Re-emit the row's `gl-ai-input` submit as `resolve-retry-file` carrying the file path (the
	 *  input only knows the prompt). Stop the inner event so it doesn't reach the host directly. */
	private onRowRetry(filePath: string, e: CustomEvent<{ prompt?: string }>): void {
		e.stopPropagation();
		const prompt = e.detail?.prompt;
		if (!prompt) return;

		// Collapse the feedback input on submit — while the retry is in flight, the row's feedback
		// toggle shows a spinner instead.
		const next = new Set(this._expandedRetry);
		next.delete(filePath);
		this._expandedRetry = next;

		this.emit('resolve-retry-file', { filePath: filePath, prompt: prompt });
	}

	/** Builds the "Needs your input" list. Each rename/rename pair (both target paths share the same
	 *  original `renameOf`) is collapsed into a single decision row so the user sees both candidate names
	 *  and their side together — instead of two disconnected half-rows each with one take-side button. */
	private renderNeedsBody(skipped: readonly ResolveSkippedFile[], errors: readonly ResolveFileError[]): unknown {
		const renameGroups = new Map<string, ResolveSkippedFile[]>();
		const singles: ResolveSkippedFile[] = [];
		for (const s of skipped) {
			if (s.kind === 'rename-rename' && s.renameOf != null) {
				const group = renameGroups.get(s.renameOf);
				if (group != null) {
					group.push(s);
				} else {
					renameGroups.set(s.renameOf, [s]);
				}
			} else {
				singles.push(s);
			}
		}

		return html`${repeat(
			singles,
			s => s.filePath,
			s => this.renderSkipped(s),
		)}${repeat(
			[...renameGroups],
			([renameOf]) => renameOf,
			([renameOf, group]) => this.renderRenameGroup(renameOf, group),
		)}${repeat(
			errors,
			e => e.filePath,
			e => this.renderError(e),
		)}`;
	}

	/** A rename/rename decision: the original file was renamed to a different name on each side. Shows
	 *  both candidate names with their side + a take-side button, so the user can pick which name to
	 *  keep — taking a side keeps that name and deletes the other (the host resolves the pair). */
	private renderRenameGroup(renameOf: string, group: readonly ResolveSkippedFile[]): unknown {
		// Current side first, then incoming, so the order is stable regardless of how git listed them.
		const ordered = [...group].sort((a, b) => (a.canStageCurrent ? 0 : 1) - (b.canStageCurrent ? 0 : 1));
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span class="resolve-file__badge resolve-file__badge--warn" title="Needs manual resolution">
					<code-icon icon="arrow-swap" size="11"></code-icon
					><span class="resolve-file__badge-text">Both renamed</span>
				</span>
				<span class="resolve-file__path">${renameOf}</span>
			</div>
			<p class="resolve-file__reasoning">“${renameOf}” was renamed differently on each side</p>
			<div class="resolve-file__sides">${ordered.map(entry => this.renderRenameSide(entry))}</div>
		</li>`;
	}

	/** One side of a rename/rename decision: the candidate name + which side it came from + its take-side
	 *  and open actions. */
	private renderRenameSide(entry: ResolveSkippedFile): unknown {
		const status = entry.conflictStatus;
		const staging = this.stagingFiles?.has(entry.filePath) ?? false;
		const side: ConflictSide = entry.canStageCurrent ? 'current' : 'incoming';
		return html`<div class="resolve-file__side">
			<span class="resolve-file__side-tag">${side === 'current' ? 'Current' : 'Incoming'}</span>
			<span class="resolve-file__side-path">${entry.filePath}</span>
			${status != null ? this.renderTakeSideButton(entry.filePath, side, status, staging) : nothing}
			<gl-tooltip content="Open in the merge editor">
				<gl-button
					appearance="toolbar"
					aria-label="Open ${entry.filePath} in the merge editor"
					@click=${() => this.emit('resolve-open-file', { filePath: entry.filePath })}
				>
					<code-icon icon="go-to-file"></code-icon>
				</gl-button>
			</gl-tooltip>
		</div>`;
	}

	/** A still-conflicted file the resolver couldn't auto-resolve (no parseable markers — binary,
	 *  symlink, mode, rename, …). Not retryable with AI, but the user can take a side manually. */
	private renderSkipped(s: ResolveSkippedFile): unknown {
		const badge = kindDisplay(s.kind, s.conflictStatus);
		// Keep the message interpolation flush inside the <p> — `.resolve-file__reasoning` is `pre-wrap`,
		// so any newline/indent around it would render as literal blank space before the text.
		const message = s.conflictStatus == null ? 'This file is no longer conflicted.' : conflictWhat(s.message);
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span class="resolve-file__badge resolve-file__badge--warn" title="Needs manual resolution">
					<code-icon icon=${badge.icon} size="11"></code-icon
					><span class="resolve-file__badge-text">${badge.label}</span>
				</span>
				<span class="resolve-file__path">${s.filePath}</span>
				${this.renderFallbackActions(s)}
			</div>
			<p class="resolve-file__reasoning">${message}</p>
		</li>`;
	}

	/** A file the AI resolver errored on. Offer the same manual take-side fallback so the user isn't
	 *  dead-ended — taking a side doesn't depend on the AI succeeding. When the conflict type is known
	 *  (binary/symlink/rename/…), label it so a non-text conflict doesn't read as a generic failure. */
	private renderError(e: ResolveFileError): unknown {
		const badge = e.kind != null ? kindDisplay(e.kind, e.conflictStatus) : undefined;
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<code-icon class="resolve-file__error" icon="error"></code-icon>
				${badge != null
					? html`<span class="resolve-file__badge resolve-file__badge--warn" title="Conflict type"
							><code-icon icon=${badge.icon} size="11"></code-icon
							><span class="resolve-file__badge-text">${badge.label}</span></span
						>`
					: nothing}
				<span class="resolve-file__path">${e.filePath}</span>
				${this.renderFallbackActions(e)}
			</div>
			<p class="resolve-file__reasoning resolve-file__error">${e.message}</p>
		</li>`;
	}

	/** Manual take-side actions for a skipped/errored row, rendered as right-aligned toolbar icons in the
	 *  row head (mirroring the resolved rows). Gated by which sides have content to take; renders nothing
	 *  when the file is no longer conflicted. */
	private renderFallbackActions(file: ResolveSkippedFile | ResolveFileError): unknown {
		const status = file.conflictStatus;
		if (status == null) return nothing;

		const staging = this.stagingFiles?.has(file.filePath) ?? false;

		const buttons: unknown[] = [];
		if (file.canStageCurrent) {
			buttons.push(this.renderTakeSideButton(file.filePath, 'current', status, staging));
		}
		if (file.canStageIncoming) {
			buttons.push(this.renderTakeSideButton(file.filePath, 'incoming', status, staging));
		}
		// both-deleted (DD): neither side has content — the only resolution is to confirm the deletion.
		if (!file.canStageCurrent && !file.canStageIncoming && file.kind === 'both-deleted') {
			buttons.push(this.renderTakeSideButton(file.filePath, 'delete', status, staging));
		}

		// Open the conflicted file in the 3-way merge editor to inspect both sides before choosing. A
		// both-deleted file has no working-tree content to open, so skip it there.
		if (file.kind !== 'both-deleted') {
			buttons.push(html`<gl-tooltip content="Open in the merge editor">
				<gl-button
					appearance="toolbar"
					aria-label="Open ${file.filePath} in the merge editor"
					@click=${() => this.emit('resolve-open-file', { filePath: file.filePath })}
				>
					<code-icon icon="go-to-file"></code-icon>
				</gl-button>
			</gl-tooltip>`);
		}

		return buttons.length > 0 ? buttons : nothing;
	}

	/** A take-side action as a right-aligned toolbar button (icon + label), mirroring the resolved rows.
	 *  Uses GitLens' accept-side glyphs — gl-accept-left = current/ours, gl-accept-right = incoming/theirs
	 *  (the same icons the WIP conflict tree uses) — or trash when the side resolves to a deletion. */
	private renderTakeSideButton(
		filePath: string,
		side: ConflictSide,
		status: GitFileConflictStatus,
		staging: boolean,
	): unknown {
		const isDelete = side === 'delete' ? true : classifyConflictAction(status, side) === 'delete';
		const icon = isDelete ? 'trash' : side === 'current' ? 'gl-accept-left' : 'gl-accept-right';
		const label = isDelete ? 'Delete File' : side === 'current' ? 'Take Current' : 'Take Incoming';
		return html`<gl-button
			appearance="toolbar"
			aria-label="${label} for ${filePath}"
			?disabled=${staging}
			@click=${() => this.emit('resolve-take-side', { filePath: filePath, side: side })}
		>
			<code-icon icon=${staging ? 'loading' : icon} modifier=${staging ? 'spin' : ''}></code-icon
			><span class="resolve-file__action-label">${label}</span>
		</gl-button>`;
	}

	private emit(name: string, detail?: unknown): void {
		this.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-resolve-mode-panel': GlDetailsResolveModePanel;
	}
}
