import { html, nothing } from 'lit';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GraphBranchesVisibility } from '../../../../config.js';
import type { GraphFiltersService } from '../../../plus/graph/graphService.js';
import type { GraphComponentConfig } from '../../../plus/graph/protocol.js';
import { noop } from '../../shared/actions/rpc.js';
import type { CustomEventType } from '../../shared/components/element.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import type { GraphJumpToastKind } from './components/gl-graph-jump-toast.js';
import type { AppState } from './context.js';
import type { GlGraphHeader } from './graph-header.js';
import type { GraphRowHiddenReason } from './graph-wrapper/gl-lit-graph.js';
import type {
	GlGraphWrapper,
	GraphNavigationFailureReason,
	GraphNavigationSource,
} from './graph-wrapper/graph-wrapper.js';

/** What the single jump-feedback toast (see `<gl-graph-jump-toast>`) is currently showing. `sha` is
 *  the wrapper's pending-navigation id to disarm on dismissal (see `cancelNavigationFeedback`) —
 *  undefined for a host-initiated reveal failure, which never armed one. `onAction` is undefined for a
 *  message-only (dismiss-only) toast. */
type GraphJumpToastState = {
	kind: GraphJumpToastKind;
	message: TemplateResult;
	actionLabel?: string;
	sha?: string;
	onAction?: () => void;
};

/** User-facing name for a "branches visibility" mode, for the jump-feedback toast's hidden-by-view
 *  message. Mirrors the labels the scope popover's mode menu renders for the same values. */
function branchesVisibilityLabel(visibility: GraphBranchesVisibility | undefined): string {
	switch (visibility) {
		case 'smart':
			return 'Smart Branches';
		case 'current':
			return 'Current Branch';
		case 'favorited':
			return 'Favorited Branches';
		case 'agents':
			return 'Agent Branches';
		case 'all':
		case undefined:
			return 'current';
	}
}

/** The jump-feedback toast's inline rendering of the jump target: a ref name reads as a name
 *  (`<strong>`), a bare short sha reads as code (`<code>`) — the toast's styles key on the tags. */
function jumpTargetLabel(ref: string | undefined, label: string): TemplateResult {
	return ref != null ? html`<strong>${label}</strong>` : html`<code>${label}</code>`;
}

/** One-time-bound view of the host state the jump-feedback toast reads. Built ONCE by
 *  `<gl-graph-app>` as closures over itself; none of these run on a hot path. */
export type JumpToastHostDeps = {
	graph(): GlGraphWrapper | undefined;
	graphState(): AppState;
	updateGraphConfig(changes: Partial<GraphComponentConfig>): Promise<void>;
	getFiltersService(): Promise<GraphFiltersService | undefined>;
	graphHeader(): GlGraphHeader | undefined;
	waitForState(predicate: () => boolean, timeoutMs?: number): Promise<void>;
};
/**
 * The jump feedback toast (issue #5699).
 *
 * A jump that can't land (hidden by a filter, or gone entirely) used to fail silently — the graph
 * just didn't move. `gl-graph-wrapper` classifies why and reports it via
 * `gl-graph-navigation-loading`/`gl-graph-navigation-failed`; this controller owns the single toast
 * instance that turns that classification into an actionable message, and the remedies that clear
 * the blocker and re-run the jump.
 *
 * Owns the three mutually-prioritized toast slots (settled failure > edge-nav search > derived
 * "searching" state), their timers, and the remedy-builder switch over hidden reasons.
 */
export class JumpToastController implements ReactiveController {
	/** The still-in-flight host row load a jump is waiting on, if any — rendered as a "searching" toast
	 *  only while `graphState.ensureLoading` is ALSO true (see {@link render}), so a load that
	 *  lands with a hit clears the toast with nothing here having to notice — the wrapper fires no
	 *  "succeeded" event, only a failed one. */
	private _loadingJumpNav?: { sha: string; ref?: string };

	/** A settled, reportable jump failure (or a host-initiated reveal failure) — takes priority over
	 *  {@link _loadingJumpNav} once set. */
	private _failedJumpToast?: GraphJumpToastState;

	/** An in-flight edge-nav search (Alt+`↑`/`↓`, `[`/`]` paging past the loaded end) — between
	 *  {@link _failedJumpToast} and {@link _loadingJumpNav} in priority (see {@link render}). */
	private _edgeSearchToast?: GraphJumpToastState;

	private _jumpToastTimer?: ReturnType<typeof setTimeout>;

	/** The toast object last handed to `<gl-graph-jump-toast>` (see {@link render}) — its
	 *  action/dismiss handlers fire DOM events with no payload, so they read this rather than
	 *  re-deriving what's currently shown. */
	private _renderedJumpToast?: GraphJumpToastState;

	/** Arming delay before the edge-search toast shows, so a page that lands quickly never flashes a
	 *  card — same rationale as the jump toast's searching interim state. */
	private _edgeSearchToastArmTimer?: ReturnType<typeof setTimeout>;

	private readonly _host: ReactiveControllerHost & EventTarget;
	private readonly deps: JumpToastHostDeps;

	constructor(controllerHost: ReactiveControllerHost & EventTarget, deps: JumpToastHostDeps) {
		this._host = controllerHost;
		this.deps = deps;
		controllerHost.addController(this);
	}

	hostDisconnected(): void {
		this.clearJumpToastTimer();
		this.clearEdgeSearchToastArmTimer();
	}

	onNavigationLoading = (e: CustomEventType<'gl-graph-navigation-loading'>): void => {
		// A newer target supersedes whatever's currently shown, a still-visible failure included. An
		// opted-out load (search stepping has its own progress UI) shows nothing, but still clears —
		// it holds `ensureLoading` too, and a stale `_loadingJumpNav` would resurface under it with the
		// wrong target.
		this.clearToast();
		this._loadingJumpNav = e.detail.feedback ? { sha: e.detail.sha, ref: e.detail.ref } : undefined;
		this._host.requestUpdate();
	};

	onNavigationFailed = (e: CustomEventType<'gl-graph-navigation-failed'>): void => {
		this.clearToast();

		const { sha, source, ref, reason } = e.detail;
		const label = ref ?? sha.slice(0, 7);
		const toast = this.buildJumpFailureToast(sha, ref, label, source, reason);
		this._failedJumpToast = toast;
		this.armJumpToastTimer(toast.actionLabel == null ? 6000 : 10000);
		this._host.requestUpdate();

		emitTelemetrySentEvent<'graph/jump/failed'>(this._host, {
			name: 'graph/jump/failed',
			data: {
				reason: reason?.kind === 'hidden' ? reason.hidden : (reason?.kind ?? 'not-found'),
				source: source ?? 'unknown',
			},
		});
	};

	onEdgeSearch = (e: CustomEventType<'gl-graph-edge-search'>): void => {
		const { kind, status } = e.detail;
		const label = kind === 'forkPoint' ? 'fork point' : 'ref';
		if (status === 'started') {
			this.clearToast();
			this._edgeSearchToastArmTimer = setTimeout(() => {
				this._edgeSearchToastArmTimer = undefined;
				this._edgeSearchToast = {
					kind: 'searching',
					message: html`Looking for the next ${label} in older history…`,
					actionLabel: 'Cancel',
					onAction: () => this.deps.graph()?.cancelEdgeSearch(),
				};
				this._host.requestUpdate();
			}, 250);
			return;
		}

		// A dismissed or superseded search settling late has nothing left to clear — `clearToast`
		// disarms both the shown card and the arming timer, so either one still standing means this
		// search's feedback is live.
		if (this._edgeSearchToastArmTimer == null && this._edgeSearchToast == null) return;

		this.clearEdgeSearchToastArmTimer();
		this._edgeSearchToast = undefined;
		// A dead end deserves its card even when the search settled before the arming delay — that
		// message is the answer, not interim progress.
		if (status === 'exhausted') {
			this._failedJumpToast = { kind: 'terminal', message: html`No further ${label} in this history` };
			this.armJumpToastTimer(6000);
		}
		this._host.requestUpdate();
	};

	/** Routed from {@link GraphAppHost} for the host's `reveal/didFail` notification — a host-initiated
	 *  reveal (deep link, terminal link, "Open in Commit Graph") whose ref never resolved. No wrapper
	 *  navigation was ever armed for it, so the toast carries no `sha` to disarm on dismissal. */
	revealFailed(id: string): void {
		this.clearToast();

		this._failedJumpToast = {
			kind: 'terminal',
			message: html`'<strong>${id}</strong>' wasn't found in this repository`,
		};
		this.armJumpToastTimer(6000);
		this._host.requestUpdate();

		emitTelemetrySentEvent<'graph/jump/failed'>(this._host, {
			name: 'graph/jump/failed',
			data: { reason: 'invalid-ref', source: 'host' },
		});
	}

	private readonly handleJumpToastAction = (): void => {
		this._renderedJumpToast?.onAction?.();
	};

	private readonly handleJumpToastDismiss = (): void => this.clearToast();

	private armJumpToastTimer(ms: number): void {
		this._jumpToastTimer = setTimeout(() => this.clearToast(), ms);
	}

	private clearJumpToastTimer(): void {
		if (this._jumpToastTimer == null) return;

		clearTimeout(this._jumpToastTimer);
		this._jumpToastTimer = undefined;
	}

	private clearEdgeSearchToastArmTimer(): void {
		if (this._edgeSearchToastArmTimer == null) return;

		clearTimeout(this._edgeSearchToastArmTimer);
		this._edgeSearchToastArmTimer = undefined;
	}

	/** Hides whatever toast is showing. A settled failure disarms the reveal the wrapper left armed for
	 *  it (`GlGraphWrapper.cancelNavigationFeedback`); a still-loading one does NOT — dismissing the
	 *  "looking for…" card is a different ask than its own Cancel action, which goes through
	 *  `GlGraphWrapper.cancelNavigation` instead. */
	private clearToast(): void {
		this.clearJumpToastTimer();

		const sha = this._failedJumpToast?.sha;
		this._failedJumpToast = undefined;
		this._loadingJumpNav = undefined;
		this._edgeSearchToast = undefined;
		this.clearEdgeSearchToastArmTimer();
		if (sha != null) {
			this.deps.graph()?.cancelNavigationFeedback(sha);
		}
		this._host.requestUpdate();
	}

	/** The toast to render this pass, or `nothing`. A failure always wins, an edge-nav search comes next,
	 *  and the "searching" jump state is otherwise DERIVED (not stored) from the still-pending load and
	 *  `ensureLoading`, per {@link _loadingJumpNav}'s doc comment. */
	render(): TemplateResult | typeof nothing {
		// Read unconditionally (not behind `&&`) so `SignalWatcher` always re-subscribes to it on this
		// render, even while `_loadingJumpNav` is unset — otherwise the FIRST render after a loading nav
		// arrives (the one where the signal read would matter) is the one short-circuit skips it on.
		const ensureLoading = this.deps.graphState().ensureLoading;

		let toast = this._failedJumpToast ?? this._edgeSearchToast;
		if (toast == null && this._loadingJumpNav != null && ensureLoading) {
			const { sha, ref } = this._loadingJumpNav;
			const label = ref ?? sha.slice(0, 7);
			toast = {
				kind: 'searching',
				message: html`Looking for ${jumpTargetLabel(ref, label)} in older history…`,
				actionLabel: 'Cancel',
				sha: sha,
				onAction: () => this.deps.graph()?.cancelNavigation(sha),
			};
		}

		this._renderedJumpToast = toast;
		if (toast == null) return nothing;

		return html`<gl-graph-jump-toast
			.kind=${toast.kind}
			.message=${toast.message}
			action-label=${ifDefined(toast.actionLabel)}
			@gl-jump-toast-action=${this.handleJumpToastAction}
			@gl-jump-toast-dismiss=${this.handleJumpToastDismiss}
		></gl-graph-jump-toast>`;
	}

	/**
	 * Applies a remedy, waits for its effect to reach the app's own state (or times out), then re-runs the
	 * jump with the landing flash — the same sequence the WIP bar's scope-clear jump relies on.
	 *
	 * `settled` is not redundant with awaiting `apply`: a write resolves once the host wrote and fired, but
	 * the re-navigation reads `graphState`, which only catches up when the resulting push lands.
	 */
	private applyJumpRemedy(
		sha: string,
		ref: string | undefined,
		source: GraphNavigationSource | undefined,
		apply: () => void | Promise<void>,
		settled: () => boolean,
	): void {
		void (async () => {
			try {
				await apply();
			} catch (ex) {
				// A failed remedy leaves the toast up — no state changed, so there's nothing to wait
				// for or re-navigate against, and the user keeps the retry action instead of losing
				// the recovery UI to a silent failure.
				noop(ex);
				return;
			}
			// Dismiss only once the remedy write actually landed — clearing up front would leave the
			// user with neither feedback nor the action on a failed write.
			this.clearToast();
			await this.deps.waitForState(settled);
			void this.deps.graph()?.navigateToCommit(sha, { source: source ?? 'jump', flash: true, ref: ref });
		})();
	}

	private buildJumpFailureToast(
		sha: string,
		ref: string | undefined,
		label: string,
		source: GraphNavigationSource | undefined,
		reason: GraphNavigationFailureReason | undefined,
	): GraphJumpToastState {
		if (reason == null) {
			return { kind: 'terminal', message: html`Couldn't load ${jumpTargetLabel(ref, label)}`, sha: sha };
		}

		switch (reason.kind) {
			case 'hidden':
				return this.buildHiddenJumpFailureToast(sha, ref, label, source, reason.hidden);
			case 'first-parent':
				return {
					kind: 'hidden',
					message: html`${jumpTargetLabel(ref, label)} is hidden while following only first parents`,
					actionLabel: 'Show All Commits',
					sha: sha,
					onAction: () =>
						this.applyJumpRemedy(
							sha,
							ref,
							source,
							() => this.deps.updateGraphConfig({ onlyFollowFirstParent: false }),
							() => this.deps.graphState().config?.onlyFollowFirstParent !== true,
						),
				};
			case 'not-found':
				return {
					kind: 'terminal',
					message: html`${jumpTargetLabel(ref, label)} wasn't found in this repository`,
					sha: sha,
				};
			case 'invalid-ref':
				return {
					kind: 'terminal',
					message: html`${jumpTargetLabel(ref, label)} wasn't found in this repository`,
					sha: sha,
				};
			case 'timeout':
			case 'error':
				return { kind: 'terminal', message: html`Couldn't load ${jumpTargetLabel(ref, label)}`, sha: sha };
		}
	}

	private buildHiddenJumpFailureToast(
		sha: string,
		ref: string | undefined,
		label: string,
		source: GraphNavigationSource | undefined,
		hidden: GraphRowHiddenReason,
	): GraphJumpToastState {
		switch (hidden) {
			case 'excluded-ref': {
				const entry =
					ref != null
						? Object.values(this.deps.graphState().excludeRefs ?? {}).find(r => r.name === ref)
						: undefined;
				if (entry != null) {
					return {
						kind: 'hidden',
						message: html`<strong>${ref}</strong> is hidden on the graph`,
						actionLabel: 'Show Branch',
						sha: sha,
						onAction: () =>
							this.applyJumpRemedy(
								sha,
								ref,
								source,
								async () => {
									await (await this.deps.getFiltersService())?.setRefsVisibility([entry], true);
								},
								() => !(entry.id in (this.deps.graphState().excludeRefs ?? {})),
							),
					};
				}
				return this.buildShowHiddenRefsJumpToast(sha, ref, label, source);
			}
			case 'excluded-type': {
				const row = this.deps.graphState().rows?.find(r => r.sha === sha);
				if (row?.kind === 'stash') {
					return {
						kind: 'hidden',
						message: html`${jumpTargetLabel(ref, label)} is hidden on the graph`,
						actionLabel: 'Show Hidden Refs',
						sha: sha,
						onAction: () =>
							this.applyJumpRemedy(
								sha,
								ref,
								source,
								async () => {
									await (await this.deps.getFiltersService())?.setExcludeType('stashes', false);
								},
								() => this.deps.graphState().excludeTypes?.stashes !== true,
							),
					};
				}
				// The row's kind isn't knowable (not currently paged in) — no single exclude-type flag to
				// flip with confidence, so degrade to the same generic remedy the bare-sha excluded-ref
				// case uses below.
				return this.buildShowHiddenRefsJumpToast(sha, ref, label, source);
			}
			case 'visibility': {
				const modeLabel = branchesVisibilityLabel(this.deps.graphState().branchesVisibility);
				return {
					kind: 'hidden',
					message: html`${jumpTargetLabel(ref, label)} isn't shown in the ${modeLabel} view`,
					actionLabel: 'Show All Branches',
					sha: sha,
					onAction: () =>
						this.applyJumpRemedy(
							sha,
							ref,
							source,
							async () => {
								await (await this.deps.getFiltersService())?.setIncludedRefs('all', undefined);
							},
							() => this.deps.graphState().branchesVisibility === 'all',
						),
				};
			}
			case 'scope':
				return {
					kind: 'hidden',
					message: html`${jumpTargetLabel(ref, label)} is outside the current scope`,
					actionLabel: 'Clear Scope',
					sha: sha,
					onAction: () =>
						this.applyJumpRemedy(
							sha,
							ref,
							source,
							() => this.deps.graphState().clearScope(),
							() => this.deps.graphState().scope == null,
						),
				};
			case 'search-filter':
				return {
					kind: 'hidden',
					message: html`${jumpTargetLabel(ref, label)} is hidden by the search filter`,
					actionLabel: 'Exit Filter View',
					sha: sha,
					onAction: () =>
						this.applyJumpRemedy(
							sha,
							ref,
							source,
							() =>
								this.deps.graphHeader()?.handleSearchModeChanged(
									new CustomEvent('gl-search-modechange', {
										detail: {
											searchMode: 'normal',
											useNaturalLanguage:
												this.deps.graphState().useNaturalLanguageSearch === true,
											explicitMode: true,
										},
									}),
								),
							() => this.deps.graphState().searchMode !== 'filter',
						),
				};
			case 'collapsed':
			case 'unknown':
				return {
					kind: 'hidden',
					message: html`${jumpTargetLabel(ref, label)} can't be shown on the graph right now`,
					sha: sha,
				};
		}
	}

	/** Fallback remedy for a hidden target whose specific blocker can't be targeted directly (a
	 *  bare-sha excluded ref with no name to match, or an excluded-type row whose kind isn't known) —
	 *  the hidden-refs popover's own "Show All" precedent: clear every currently-excluded ref. */
	private buildShowHiddenRefsJumpToast(
		sha: string,
		ref: string | undefined,
		label: string,
		source: GraphNavigationSource | undefined,
	): GraphJumpToastState {
		const excludeRefs = this.deps.graphState().excludeRefs;
		const refs = excludeRefs != null ? Object.values(excludeRefs) : [];
		if (refs.length === 0) {
			return { kind: 'hidden', message: html`${jumpTargetLabel(ref, label)} is hidden on the graph`, sha: sha };
		}

		return {
			kind: 'hidden',
			message: html`${jumpTargetLabel(ref, label)} is hidden on the graph`,
			actionLabel: 'Show Hidden Refs',
			sha: sha,
			onAction: () =>
				this.applyJumpRemedy(
					sha,
					ref,
					source,
					async () => {
						await (await this.deps.getFiltersService())?.setRefsVisibility(refs, true);
					},
					() => Object.keys(this.deps.graphState().excludeRefs ?? {}).length === 0,
				),
		};
	}
}
