import type { PropertyValueMap, TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
import { isActiveAgentPhase } from '@gitlens/agents/types.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { canStageCurrent, canStageIncoming } from '@gitlens/git/utils/conflictResolution.utils.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { isDescendant, normalizePath, relative } from '@gitlens/utils/path.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { AgentSessionState } from '../../../../agents/models/agentSessionState.js';
import type { Draft } from '../../../../plus/drafts/models/drafts.js';
import { createCommandLink } from '../../../../system/commands.js';
import { serializeWebviewItemContext } from '../../../../system/webview.js';
import type { DetailsItemTypedContext, DraftState, Wip } from '../../../commitDetails/protocol.js';
import { buildFolderContext } from '../../../commitDetails/protocol.js';
import type { ComposerCommandArgs } from '../../../plus/composer/registration.js';
import type { Change } from '../../../plus/patchDetails/protocol.js';
import type { TreeItemAction, TreeItemBase, TreeItemCheckedDetail } from '../../shared/components/tree/base.js';
import { detailsBaseStyles } from './gl-details-base.css.js';
import type { File } from './gl-details-base.js';
import { GlDetailsBase } from './gl-details-base.js';
import { detailsWipPanelStyles } from './gl-details-wip-panel.css.js';
import type { CreatePatchState, GenerateState } from './gl-inspect-patch.js';
import '../../shared/components/button.js';
import '../../shared/components/button-container.js';
import '../../shared/components/branch-name.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/panes/pane-group.js';
import '../../shared/components/avatar/avatar.js';
import '../../shared/components/chips/action-chip.js';
import '../../shared/components/commit/commit-stats.js';
import '../../shared/components/pills/tracking.js';
import '../../shared/components/tree/gl-wip-tree-pane.js';
import '../../plus/shared/components/merge-rebase-status.js';
import '../../plus/graph/components/gl-details-wip-empty-pane.js';
import './gl-inspect-patch.js';

// Stable references for the inline tree-item actions so each render reuses the same objects
// instead of allocating fresh ones per file. Lit's array diffing in gl-tree-item is identity-
// based, so reusing these also avoids spurious re-renders downstream.
// `single`: conflict-specific diffs (current/incoming side) only make sense for the clicked conflicted
// row — fanning them out to non-conflicted selected files would open wrong/empty content.
const openCurrentChangesAction: TreeItemAction = {
	icon: 'gl-diff-left',
	label: 'Open Current Changes',
	action: 'file-open-current',
	multiBehavior: 'single',
};
const openIncomingChangesAction: TreeItemAction = {
	icon: 'gl-diff-right',
	label: 'Open Incoming Changes',
	action: 'file-open-incoming',
	multiBehavior: 'single',
};
const stageConflictAction: TreeItemAction = {
	icon: 'add',
	label: 'Stage',
	action: 'file-stage',
	multiBehavior: 'batch',
};
// `batch`: an inline stage/unstage on a multi-selection fires ONE event carrying the whole set
// (detail.files) so the host runs a single atomic `git add`/`git reset` — N concurrent single-file
// ops would collide on the index lock and leave some files behind.
const stageAction: TreeItemAction = {
	icon: 'plus',
	label: 'Stage Changes',
	action: 'file-stage',
	multiBehavior: 'batch',
};
const unstageAction: TreeItemAction = {
	icon: 'remove',
	label: 'Unstage Changes',
	action: 'file-unstage',
	multiBehavior: 'batch',
};
// `batch`: discarding an inline button on a multi-selection fires ONE `file-discard` carrying the
// whole set (detail.files) so the host shows a single combined confirm, not one per file.
const discardAction: TreeItemAction = {
	icon: 'discard',
	label: 'Discard Changes...',
	action: 'file-discard',
	multiBehavior: 'batch',
};
// Mixed rows (both staged + unstaged) discard only the unstaged portion on the first click — the
// staged content survives until a second discard. Same `file-discard` action (the host detects
// mixed and applies the partial semantics); only the label differs so it matches that behavior and
// the bulk toolbar button.
const discardUnstagedAction: TreeItemAction = {
	icon: 'discard',
	label: 'Discard Unstaged Changes...',
	action: 'file-discard',
	multiBehavior: 'batch',
};
const openFileAction: TreeItemAction = { icon: 'go-to-file', label: 'Open File', action: 'file-open' };
// `file-compare-wip-staged` is bridged by gl-wip-tree-pane into `file-compare-wip` with
// `staged: true` overridden so the diff resolves to staged ↔ HEAD even though the deduped
// row carries `staged: false` (preferred-unstaged precedence from the tree pane dedup).
// `single`: a specific "staged side" diff for the clicked mixed row; fanning it out to selected files
// without staged changes would open an empty/wrong diff.
const openStagedChangesAction: TreeItemAction = {
	icon: 'diff-single',
	label: 'Open Staged Changes',
	action: 'file-compare-wip-staged',
	multiBehavior: 'single',
};
const stashAction: TreeItemAction = {
	icon: 'gl-stash-save',
	label: 'Stash Changes...',
	action: 'file-stash',
	multiBehavior: 'batch',
};

const conflictedCheckboxActions: TreeItemAction[] = [
	openFileAction,
	openCurrentChangesAction,
	openIncomingChangesAction,
];
const conflictedActions: TreeItemAction[] = [...conflictedCheckboxActions, stageConflictAction];
const checkboxDiscardOnly: TreeItemAction[] = [openFileAction, stashAction, discardAction];
const checkboxMixedActions: TreeItemAction[] = [
	openFileAction,
	openStagedChangesAction,
	stashAction,
	discardUnstagedAction,
];
const stagedActions: TreeItemAction[] = [openFileAction, unstageAction, stashAction, discardAction];
const unstagedActions: TreeItemAction[] = [openFileAction, stageAction, stashAction, discardAction];

/** Grace period after `editing` flips off during which a file stays marked. The host's
 *  `editing === true` window is the literal in-flight refcount window — milliseconds for
 *  Edit/Write tool calls — so without grace the mark flashes and is gone before the eye can
 *  register it. The grace is preempted the moment any *other* file becomes `editing === true`
 *  (see {@link GlDetailsWipPanel.computeAgentTouchedFiles}); the indicator follows the agent. */
const agentTouchedGraceMs = 5000;

@customElement('gl-details-wip-panel')
export class GlDetailsWipPanel extends GlDetailsBase {
	static override styles = [
		...detailsBaseStyles,
		detailsWipPanelStyles,
		css`
			:host {
				--gl-avatar-size: 1.6rem;
			}
		`,
	];

	@property({ type: Object })
	wip?: Wip;

	@property({ type: Object })
	pullRequest?: PullRequestShape;

	@property({ type: Array })
	codeSuggestions?: Omit<Draft, 'changesets'>[];

	@property({ type: Object })
	draftState?: DraftState;

	@property({ type: Object })
	generate?: GenerateState;

	@property({ type: String, attribute: 'worktree-path' })
	worktreePath?: string;

	@property({ type: Boolean, attribute: 'checkbox-mode' })
	checkboxMode = false;

	/** Opt-in for the bulk "Stage Current/Incoming for All Conflicts" toolbar buttons.
	 * Set true only by hosts that wire the `resolve-all-current/incoming` events AND can
	 * vouch that bulk resolve is supported (currently graph WIP + paused rebase). */
	@property({ type: Boolean, attribute: 'bulk-conflict-actions' })
	bulkConflictActions = false;

	/** Active agent sessions matched to this worktree (already filtered by the graph host).
	 *  Used to compute per-file editing decorations — see {@link _agentTouchedFiles}. */
	@property({ attribute: false })
	agentSessions?: AgentSessionState[];

	/** Repo-relative normalized paths the connected agent(s) are actively editing right now (or
	 *  within {@link agentTouchedGraceMs} of last edit, see {@link computeAgentTouchedFiles}),
	 *  mapped to the most-active phase. Recomputed in {@link willUpdate} when {@link agentSessions}
	 *  or {@link wip} changes, AND on a one-shot timer for the earliest grace expiry so the mark
	 *  drops cleanly without waiting for the next host snapshot. */
	@state()
	private _agentTouchedFiles?: ReadonlyMap<string, AgentSessionPhase>;

	/** `performance.now()` at which the current `agentSessions` snapshot was received. Used to
	 *  age `editedAt` locally — the wire value only advances when the host fires a new snapshot,
	 *  which stops when the agent goes idle. Without local aging a grace mark would persist until
	 *  the next event (or until the host's full `activityDecayMs` eviction, minutes later). */
	private _agentSnapshotReceivedAt = 0;

	/** Per-session structural signatures (id + per-path read/edit flags, NOT timestamps) behind the
	 *  last `_agentSnapshotReceivedAt` stamp. The aging baseline must only reset when the host actually
	 *  re-stamps `editedAt` (solely on a file-tool sync, in lockstep with a structural change) — NOT on
	 *  the far more frequent `agentSessions` fires for status/lastActivity/other sessions, which leave
	 *  `editedAt` frozen. The `fileActivity` array reference can't be the key: postMessage recreates it
	 *  on every push, so reference comparison always reports a change and would pin `effectiveAge` near
	 *  zero, so the grace mark would never expire while the agent runs non-file tools. */
	private _lastFileActivitySigs = new Set<string>();

	/** Timer that fires when the earliest grace tail expires so we drop the mark on schedule
	 *  even with no fresh host snapshot. Replaced on each recompute; cleared on disconnect. */
	private _agentGraceTimer: ReturnType<typeof setTimeout> | undefined;

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		if (this._agentGraceTimer != null) {
			clearTimeout(this._agentGraceTimer);
			this._agentGraceTimer = undefined;
		}
	}

	/** Strict realtime with a small grace tail: a file is marked when an agent is *editing* it
	 *  right now, OR — only while nothing else is currently being edited — for a short
	 *  {@link agentTouchedGraceMs} window after its last edit so the user actually sees it. The
	 *  moment any other file becomes `editing === true`, the global "active" gate kicks in and
	 *  every grace-only mark drops, so the indicator follows the agent rather than accumulating.
	 *
	 *  Aging is local: `editedAt` on the wire is host-ms at serialization time and doesn't advance
	 *  between snapshots, so we add `(performance.now() - _agentSnapshotReceivedAt)` to compute
	 *  the live age. A one-shot timer (re-armed here) triggers a re-render at the earliest grace
	 *  expiry so the drop happens on schedule even when the agent goes idle. */
	private computeAgentTouchedFiles(): ReadonlyMap<string, AgentSessionPhase> | undefined {
		const sessions = this.agentSessions;
		const repoPath = this.wip?.repo?.path;
		if (!sessions?.length || repoPath == null) return undefined;

		// First pass: any actively-editing file across all sessions? When true, the grace branch
		// is skipped — current activity preempts any tail from a previous edit.
		let hasAnyActive = false;
		for (const s of sessions) {
			if (!isActiveAgentPhase(s.phase)) continue;
			if (s.fileActivity?.some(e => e.editing === true)) {
				hasAnyActive = true;
				break;
			}
		}

		const elapsedSinceSnapshot = Math.max(0, performance.now() - this._agentSnapshotReceivedAt);
		let touched: Map<string, AgentSessionPhase> | undefined;
		let earliestGraceRemainingMs = Infinity;

		for (const s of sessions) {
			if (!isActiveAgentPhase(s.phase)) continue;

			const entries = s.fileActivity;
			if (!entries?.length) continue;

			for (const entry of entries) {
				const isLive = entry.editing === true;
				let inGrace = false;
				let graceRemainingMs = Infinity;
				if (!isLive && !hasAnyActive && entry.editedAt != null) {
					const effectiveAge = entry.editedAt + elapsedSinceSnapshot;
					if (effectiveAge < agentTouchedGraceMs) {
						inGrace = true;
						graceRemainingMs = agentTouchedGraceMs - effectiveAge;
					}
				}
				if (!isLive && !inGrace) continue;

				const normalized = normalizePath(entry.path);
				if (!isDescendant(normalized, repoPath)) continue;

				const rel = relative(repoPath, normalized);
				if (!rel || rel === normalized) continue;

				touched ??= new Map();
				// 'working' wins over 'waiting' if multiple sessions claim the same file.
				const existing = touched.get(rel);
				if (existing !== 'working') {
					touched.set(rel, s.phase);
				}
				if (inGrace && graceRemainingMs < earliestGraceRemainingMs) {
					earliestGraceRemainingMs = graceRemainingMs;
				}
			}
		}

		// Re-arm the one-shot timer for the earliest grace expiry. Adding a small slack (50ms) so
		// the re-render lands just past the boundary and the file definitively drops on this pass.
		if (this._agentGraceTimer != null) {
			clearTimeout(this._agentGraceTimer);
			this._agentGraceTimer = undefined;
		}
		if (Number.isFinite(earliestGraceRemainingMs)) {
			this._agentGraceTimer = setTimeout(() => {
				this._agentGraceTimer = undefined;
				this._agentTouchedFiles = this.computeAgentTouchedFiles();
			}, earliestGraceRemainingMs + 50);
		}

		return touched;
	}

	/** True when the per-session `fileActivity` STRUCTURE (paths + read/edit flags, ignoring the
	 *  editedAt/readAt timestamps) differs from the last stamp — i.e. the host actually re-synced file
	 *  activity (the only event that refreshes `editedAt`, in lockstep with a structural change).
	 *  Order-independent; updates the stored set as a side effect. Keyed on structure rather than the
	 *  `fileActivity` reference because postMessage recreates that reference on every push. */
	private fileActivityStructureChanged(): boolean {
		const current = new Set<string>();
		for (const s of this.agentSessions ?? []) {
			const fa = s.fileActivity;
			if (fa == null) continue;

			let sig = s.id;
			for (const e of fa) {
				sig += `\u0001${e.path}:${e.reading ? 'r' : ''}${e.editing ? 'e' : ''}`;
			}
			current.add(sig);
		}
		let changed = current.size !== this._lastFileActivitySigs.size;
		if (!changed) {
			for (const sig of current) {
				if (!this._lastFileActivitySigs.has(sig)) {
					changed = true;
					break;
				}
			}
		}
		this._lastFileActivitySigs = current;
		return changed;
	}

	protected override willUpdate(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.willUpdate?.(changedProperties);

		if (changedProperties.has('agentSessions') || changedProperties.has('wip')) {
			// Stamp the local receipt time so `editedAt` (host-ms-at-serialization) can be aged
			// locally between snapshots. Only re-stamp when the `fileActivity` STRUCTURE actually
			// changed — that is the only time the host re-stamps `editedAt`. Re-stamping on every
			// `agentSessions` fire (status ticks, lastActivity, other sessions — all of which leave the
			// structure and thus `editedAt` unchanged) would keep `effectiveAge` pinned near zero and the
			// grace mark would never expire while the agent runs non-file tools.
			if (changedProperties.has('agentSessions') && this.fileActivityStructureChanged()) {
				this._agentSnapshotReceivedAt = performance.now();
			}
			this._agentTouchedFiles = this.computeAgentTouchedFiles();
		}
	}

	@state()
	get inReview(): boolean {
		return this.draftState?.inReview ?? false;
	}

	get isUnpublished(): boolean {
		const branch = this.wip?.branch;
		return branch?.upstream == null || branch.upstream.missing === true;
	}

	get draftsEnabled(): boolean {
		return this.orgSettings?.drafts === true;
	}

	get filesCount(): number {
		return this.files?.length ?? 0;
	}

	get branchState() {
		const branch = this.wip?.branch;
		if (branch == null) return undefined;

		return {
			ahead: branch.tracking?.ahead ?? 0,
			behind: branch.tracking?.behind ?? 0,
		};
	}

	@state()
	patchCreateMetadata: { title: string | undefined; description: string | undefined } = {
		title: undefined,
		description: undefined,
	};

	get patchCreateState(): CreatePatchState {
		const wip = this.wip!;
		const key = wip.repo.uri;
		const change: Change = {
			type: 'wip',
			repository: {
				name: wip.repo.name,
				path: wip.repo.path,
				uri: wip.repo.uri,
			},
			revision: { to: uncommitted, from: 'HEAD' },
			files: wip.changes?.files ?? [],
			checked: true,
		};

		return {
			...this.patchCreateMetadata,
			changes: {
				[key]: change,
			},
			creationError: undefined,
			visibility: 'public',
			userSelections: undefined,
		};
	}

	protected override updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		// Guard: wip may be null during mode transitions
		if (this.wip == null) return;

		if (changedProperties.has('generate')) {
			this.patchCreateMetadata = {
				title: this.generate?.title ?? this.patchCreateMetadata.title,
				description: this.generate?.description ?? this.patchCreateMetadata.description,
			};
		}
	}

	protected override renderChangedFilesSlottedContent(): TemplateResult<1> | typeof nothing {
		if (this.variant === 'embedded' || !this.files?.length) return nothing;

		return html`<div slot="before-tree" class="section section--actions">
			<button-container>
				<gl-button
					full
					.href=${createCommandLink<ComposerCommandArgs>('gitlens.composeCommits', {
						repoPath: this.wip?.repo.path,
						source: 'inspect',
					})}
					><code-icon icon="wand" slot="prefix"></code-icon>Compose Commits...<span slot="tooltip"
						><strong>Compose Commits</strong> (Preview)<br /><i
							>Automatically or interactively organize changes into meaningful commits</i
						></span
					></gl-button
				>
				<gl-button appearance="secondary" href="command:workbench.view.scm" tooltip="Commit via SCM"
					><code-icon rotate="45" icon="arrow-up"></code-icon
				></gl-button>
			</button-container>
		</div>`;
	}

	private renderSecondaryAction(hasPrimary = true) {
		if (!this.draftsEnabled || this.inReview) return undefined;

		let label = 'Share as Cloud Patch';
		let action = 'create-patch';
		const pr = this.pullRequest;
		if (pr?.state === 'opened' && equalsIgnoreCase(pr.provider.domain, 'github.com')) {
			// const isMe = pr.author.name.endsWith('(you)');
			// if (isMe) {
			// 	label = 'Share with PR Participants';
			// 	action = 'create-patch';
			// } else {
			// 	label = `Start Review for PR #${pr.id}`;
			// 	action = 'create-patch';
			// }

			if (!this.inReview) {
				label = 'Suggest Changes for PR';
				action = 'start-patch-review';
			} else {
				label = 'Close Suggestion for PR';
				action = 'end-patch-review';
			}

			if ((this.wip?.changes?.files.length ?? 0) === 0) {
				return html`
					<gl-button
						?full=${!hasPrimary}
						appearance="secondary"
						data-action="${action}"
						@click=${() => this.onToggleReviewMode(!this.inReview)}
						.tooltip=${hasPrimary ? label : undefined}
					>
						<code-icon icon="gl-code-suggestion" .slot=${!hasPrimary ? 'prefix' : nothing}></code-icon
						>${!hasPrimary ? label : nothing}
					</gl-button>
				`;
			}

			return html`
				<gl-button
					?full=${!hasPrimary}
					appearance="secondary"
					data-action="${action}"
					.tooltip=${hasPrimary ? label : undefined}
					@click=${() => this.onToggleReviewMode(!this.inReview)}
				>
					<code-icon icon="gl-code-suggestion" .slot=${!hasPrimary ? 'prefix' : nothing}></code-icon
					>${!hasPrimary ? label : nothing}
				</gl-button>
				<gl-button
					appearance="secondary"
					density="compact"
					data-action="create-patch"
					tooltip="Share as Cloud Patch"
					@click=${() => this.onDataActionClick('create-patch')}
				>
					<code-icon icon="gl-cloud-patch-share"></code-icon>
				</gl-button>
			`;
		}

		if ((this.wip?.changes?.files.length ?? 0) === 0) return undefined;

		return html`
			<gl-button
				?full=${!hasPrimary}
				appearance="secondary"
				data-action="${action}"
				.tooltip=${hasPrimary ? label : undefined}
				@click=${() => this.onDataActionClick(action)}
			>
				<code-icon icon="gl-cloud-patch-share" .slot=${!hasPrimary ? 'prefix' : nothing}></code-icon
				>${!hasPrimary ? label : nothing}
			</gl-button>
		`;
	}

	private renderPrimaryAction() {
		if (this.isUnpublished) {
			return html`
				<gl-button full data-action="publish-branch" @click=${() => this.onDataActionClick('publish-branch')}>
					<code-icon icon="cloud-upload" slot="prefix"></code-icon>Publish Branch<span slot="tooltip"
						>Publish (push) <strong>${this.wip?.branch?.name}</strong> to
						${this.wip?.branch?.upstream?.name ?? 'a remote'}</span
					>
				</gl-button>
			`;
		}

		if (this.branchState == null) return undefined;

		const { ahead, behind } = this.branchState;
		if (ahead === 0 && behind === 0) return undefined;

		const fetchLabel = behind > 0 ? 'Pull' : ahead > 0 ? 'Push' : 'Fetch';
		const fetchIcon = behind > 0 ? 'repo-pull' : ahead > 0 ? 'repo-push' : 'repo-fetch';
		const fetchTooltip = behind > 0 ? 'Pull from' : ahead > 0 ? 'Push to' : 'Fetch from';

		return html`
			<gl-button
				full
				data-action="${fetchLabel.toLowerCase()}"
				@click=${() => this.onDataActionClick(fetchLabel.toLowerCase())}
			>
				<code-icon icon="${fetchIcon}" slot="prefix"></code-icon> ${fetchLabel}
				<gl-tracking-pill .ahead=${ahead} .behind=${behind} slot="suffix"></gl-tracking-pill>
				<span slot="tooltip">${fetchTooltip} <strong>${this.wip?.branch?.upstream?.name}</strong></span>
			</gl-button>
		`;
	}

	private renderActions() {
		const primaryAction = this.renderPrimaryAction();
		const secondaryAction = this.renderSecondaryAction(primaryAction != null);
		if (primaryAction == null && secondaryAction == null) return nothing;

		return html`<div class="section section--actions">
			<button-container>${primaryAction}${secondaryAction}</button-container>
		</div>`;
	}

	private renderSuggestedChanges() {
		if (!this.codeSuggestions?.length) return nothing;
		// src="${this.issue!.author.avatarUrl}"
		// title="${this.issue!.author.name} (author)"
		return html`
			<gl-tree>
				<gl-tree-item branch .expanded=${true} .level=${0}>
					<code-icon slot="icon" icon="gl-code-suggestion"></code-icon>
					Code Suggestions
				</gl-tree-item>
				${repeat(
					this.codeSuggestions,
					draft => draft.id,
					draft => html`
						<gl-tree-item
							.expanded=${true}
							.level=${1}
							@gl-tree-item-selected=${() => this.onShowCodeSuggestion(draft.id)}
						>
							<gl-avatar
								class="author-icon"
								src="${draft.author.avatarUri}"
								name="${draft.author.name} (author)"
							></gl-avatar>
							${draft.title}
							<span slot="description"
								><formatted-date .date=${new Date(draft.updatedAt)}></formatted-date
							></span>
						</gl-tree-item>
					`,
				)}
			</gl-tree>
		`;
	}

	private renderPullRequest() {
		if (this.pullRequest == null) return nothing;

		return html`
			<webview-pane
				collapsable
				flexible
				?expanded=${this.preferences?.pullRequestExpanded ?? true}
				data-region="pullrequest-pane"
			>
				<span slot="title">Pull Request #${this.pullRequest?.id}</span>
				<action-nav slot="actions">
					<gl-action-chip
						label="Open Pull Request Changes"
						icon="diff-multiple"
						@click=${() => this.onDataActionClick('open-pr-changes')}
					></gl-action-chip>
					<gl-action-chip
						label="Compare Pull Request"
						icon="compare-changes"
						@click=${() => this.onDataActionClick('open-pr-compare')}
					></gl-action-chip>
					<gl-action-chip
						label="Open Pull Request on Remote"
						icon="globe"
						@click=${() => this.onDataActionClick('open-pr-remote')}
					></gl-action-chip>
				</action-nav>
				<div class="section">
					<issue-pull-request
						type="pr"
						name="${this.pullRequest.title}"
						url="${this.pullRequest.url}"
						identifier="#${this.pullRequest.id}"
						status="${this.pullRequest.state}"
						.date=${this.pullRequest.updatedDate}
						.dateFormat="${this.preferences?.dateFormat}"
						.dateStyle="${this.preferences?.dateStyle}"
						details
					></issue-pull-request>
				</div>
				${this.renderSuggestedChanges()}
			</webview-pane>
		`;
	}

	private renderIncomingOutgoing() {
		if (this.branchState == null || (this.branchState.ahead === 0 && this.branchState.behind === 0)) return nothing;

		return html`
			<webview-pane collapsable>
				<span slot="title">Incoming / Outgoing</span>
				<gl-tree>
					<gl-tree-item branch .expanded=${false}>
						<code-icon slot="icon" icon="arrow-circle-down"></code-icon>
						Incoming Changes
						<span slot="decorations">${this.branchState.behind ?? 0}</span>
					</gl-tree-item>
					<gl-tree-item branch .expanded=${false}>
						<code-icon slot="icon" icon="arrow-circle-up"></code-icon>
						Outgoing Changes
						<span slot="decorations">${this.branchState.ahead ?? 0}</span>
					</gl-tree-item>
				</gl-tree>
			</webview-pane>
		`;
	}

	private renderPatchCreation() {
		if (!this.inReview) return nothing;

		return html`<gl-inspect-patch
			.orgSettings=${this.orgSettings}
			.preferences=${this.preferences}
			.generate=${this.generate}
			.createState=${this.patchCreateState}
			@gl-patch-create-patch=${(e: CustomEvent) => {
				void this.dispatchEvent(new CustomEvent('gl-inspect-create-suggestions', { detail: e.detail }));
			}}
		></gl-inspect-patch>`;
	}

	override render(): unknown {
		if (this.wip == null) return nothing;

		if (this.variant === 'embedded') {
			return this.renderEmbedded();
		}

		const hasFiles = (this.files?.length ?? 0) > 0;
		if (!hasFiles && !this.inReview) {
			return html`
				${this.renderActions()} ${this.renderPausedOpStatus()}
				<gl-details-wip-empty-pane
					.wip=${this.wip}
					.pullRequest=${this.pullRequest}
					@publish-branch=${() => this.onDataActionClick('publish-branch')}
					@pull=${() => this.onDataActionClick('pull')}
					@push=${() => this.onDataActionClick('push')}
					@create-pr=${() => this.onDataActionClick('create-pr')}
					@start-work=${() => this.onDataActionClick('start-work')}
					@switch-branch=${() => this.onDataActionClick('switch')}
					@create-branch=${() => this.onDataActionClick('create-branch')}
					@apply-stash=${() => this.onDataActionClick('apply-stash')}
					@new-worktree=${() => this.onDataActionClick('new-worktree')}
				></gl-details-wip-empty-pane>
			`;
		}

		return html`
			${this.renderActions()} ${this.renderPausedOpStatus()}
			<webview-pane-group flexible>
				${this.renderPullRequest()}
				${when(this.inReview === false, () => this.renderChangedFiles('wip'))}${this.renderPatchCreation()}
			</webview-pane-group>
		`;
	}

	private renderPausedOpStatus() {
		const pausedOpStatus = this.wip?.changes?.pausedOpStatus;
		if (pausedOpStatus == null) return nothing;

		return html`<div class="paused-op">
			<gl-merge-rebase-status
				?conflicts=${this.wip?.changes?.hasConflicts ?? false}
				.pausedOpStatus=${pausedOpStatus}
			></gl-merge-rebase-status>
		</div>`;
	}

	private renderEmbedded() {
		if (this.checkboxMode) {
			return html`<div class="files">
				<webview-pane-group flexible> ${this.renderChangedFiles('wip')} </webview-pane-group>
			</div>`;
		}
		return html`
			${this.renderEmbeddedHeader()}
			<div class="files">
				<webview-pane-group flexible> ${this.renderChangedFiles('wip')} </webview-pane-group>
			</div>
		`;
	}

	override renderChangedFiles(_mode: 'wip'): TemplateResult<1> {
		return html`
			<gl-wip-tree-pane
				.files=${this.files}
				.preferences=${this.preferences}
				.collapsable=${this.filesCollapsable}
				?show-file-icons=${this.fileIcons}
				?checkable=${this.checkboxMode}
				?multi-selectable=${true}
				?bulk-conflict-actions=${this.bulkConflictActions}
				.showSearchBox=${this.showSearchBox}
				.searchBoxFilter=${this.searchBoxFilter}
				.fileActions=${this._getFileActions}
				.fileContext=${this._getFileContext}
				.folderContext=${this._getFolderContext}
				.searchContext=${this.searchContext}
				.multiDiff=${this.getMultiDiffRefs()}
				.agentTouchedFiles=${this._agentTouchedFiles}
				empty-text=${this.emptyText}
				@file-checked=${this._onFileChecked}
			>
				${this.renderChangedFilesSlottedContent()}
			</gl-wip-tree-pane>
		`;
	}

	private getMultiDiffRefs():
		| { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string }
		| undefined {
		const repoPath = this.wip?.repo?.path ?? this.files?.find(f => f.repoPath)?.repoPath;
		if (!repoPath) return undefined;

		// `wip: true` forces the host to per-file HEAD↔index↔working semantics regardless of
		// `lhs`/`rhs`. The OpenMultipleChangesArgs routing switched from `rhs === ''` to an
		// explicit `wip` flag, so the WIP details panel must set it here.
		return { repoPath: repoPath, lhs: 'HEAD', rhs: '', wip: true, title: 'Working Changes' };
	}

	// Coalesces the selection-aware checkbox fan-out — gl-file-tree-pane dispatches one synchronous
	// `file-checked` per selected file — into a single stage/unstage, so the host runs ONE atomic
	// `git add`/`git reset` instead of N concurrent ops that collide on `.git/index.lock` and leave
	// some files behind. Flushed on a microtask, after the synchronous fan-out has drained.
	private _checkedBatch?: { checked: boolean; repoPath: string; files: File[] };

	protected override onFileChecked(e: CustomEvent<TreeItemCheckedDetail>): void {
		if (!e.detail.context) return;

		const [file] = e.detail.context as unknown as File[];
		const repoPath = file.repoPath ?? this.wip?.repo?.path;
		if (!repoPath) return;

		// Start a new batch when none is pending or the action flips (check vs uncheck); the fan-out
		// applies a single action across the whole selection, so a batch is action-homogeneous.
		if (this._checkedBatch?.checked !== e.detail.checked) {
			this._checkedBatch = { checked: e.detail.checked, repoPath: repoPath, files: [] };
			queueMicrotask(() => this.flushCheckedBatch());
		}
		this._checkedBatch.files.push(file);
	}

	private flushCheckedBatch(): void {
		const batch = this._checkedBatch;
		this._checkedBatch = undefined;
		if (batch == null) return;
		if (!batch.files.length) return;

		const [first] = batch.files;
		const detail = {
			path: first.path,
			repoPath: batch.repoPath,
			status: first.status,
			staged: first.staged,
			// >1 → carry the whole set so the host stages/unstages them in one atomic op.
			files: batch.files.length > 1 ? batch.files : undefined,
		};

		this.dispatchEvent(
			new CustomEvent(batch.checked ? 'file-stage' : 'file-unstage', {
				detail: detail,
			}),
		);
	}

	private renderEmbeddedHeader() {
		const wip = this.wip;
		if (!wip) return nothing;

		const branchName = wip.branch?.name;
		const filesCount = this.filesCount;
		const stagedCount = this.files?.filter(f => f.staged)?.length ?? 0;
		const unstagedCount = filesCount - stagedCount;

		return html`<div class="header">
			<div class="header__identity">
				<code-icon class="header__wip-icon" icon="diff"></code-icon>
				<div class="header__identity-left">
					<span class="header__wip-title">Working Changes</span>
					<span class="header__wip-subtitle">
						${this.worktreePath
							? html`<code-icon icon="folder"></code-icon> ${this.worktreePath}`
							: html`${stagedCount > 0 || unstagedCount > 0
									? `${stagedCount} staged · ${unstagedCount} unstaged`
									: 'No changes'}`}
					</span>
				</div>
				<div class="header__identity-right">
					<div class="header__actions">
						<gl-action-chip
							icon="close"
							label="Close"
							overlay="tooltip"
							@click=${() =>
								this.dispatchEvent(new CustomEvent('close-details', { bubbles: true, composed: true }))}
						></gl-action-chip>
					</div>
				</div>
			</div>
			<div class="header__branch-row">
				${branchName
					? html`<gl-branch-name
							class="header__branch-pill"
							appearance="pill"
							.name=${branchName}
						></gl-branch-name>`
					: nothing}
				${filesCount > 0
					? html`<commit-stats modified="${filesCount}" symbol="icons" appearance="pill"></commit-stats>`
					: nothing}
			</div>
			${this.renderPausedOpStatus()}
		</div>`;
	}

	override getFileActions(file: File, options?: Partial<TreeItemBase>): TreeItemAction[] {
		// Conflicted files get rebase-editor-style "Open Current/Incoming Changes". In non-checkbox
		// mode we also surface Stage — checkbox mode hides it because the row's checkbox already
		// performs staging. Stage routes through the existing `file-stage` event, which prompts
		// when unresolved conflict markers remain.
		if (isConflictStatus(file.status)) {
			return this.checkboxMode ? conflictedCheckboxActions : conflictedActions;
		}

		if (this.checkboxMode) {
			// Mixed (deduped) gets an extra "Open Staged Changes" view button alongside Discard.
			return options?.mixed ? checkboxMixedActions : checkboxDiscardOnly;
		}

		// Non-checkbox mode never sees `options.mixed === true` because gl-wip-tree-pane only
		// computes `mixedPaths` under `if (this.checkable)`. Each row of a mixed file appears in
		// its own staged/unstaged group and gets the natural Stage/Unstage button.
		return file.staged === true ? stagedActions : unstagedActions;
	}

	override getFolderContext(folder: { relativePath: string }): string | undefined {
		return buildFolderContext(this.wip?.repo?.path, folder);
	}

	override getFileContext(file: File): string | undefined {
		if (!this.wip?.repo?.path) return undefined;

		// Two-char `XY` conflict statuses (UU/AA/UD/DU/AU/UA/DD) carry the side semantics
		// the stage-current/incoming commands need; the generic single-char 'U' from
		// `isConflictStatus` doesn't, so we treat it as a regular unstaged file and skip
		// the conflict modifiers. Without this guard, the host's runStageConflictResolution
		// would silently no-op on 'U' files clicked through the new context-menu items.
		let webviewItem: string;
		if (isConflictStatus(file.status) && file.status !== 'U') {
			const conflictStatus = file.status;
			const modifiers: string[] = ['+conflict'];
			if (canStageCurrent(conflictStatus)) {
				modifiers.push('+canStageCurrent');
			}
			if (canStageIncoming(conflictStatus)) {
				modifiers.push('+canStageIncoming');
			}
			webviewItem = `gitlens:file${modifiers.join('')}`;
		} else {
			webviewItem = file.staged ? 'gitlens:file+staged' : 'gitlens:file+unstaged';
		}

		const context: DetailsItemTypedContext = {
			webviewItem: webviewItem,
			webviewItemValue: {
				type: 'file',
				path: file.path,
				repoPath: this.wip.repo.path,
				sha: uncommitted,
				staged: file.staged,
				status: file.status,
			},
		};

		return serializeWebviewItemContext(context);
	}

	private onDataActionClick(name: string) {
		void this.dispatchEvent(new CustomEvent('data-action', { detail: { name: name } }));
	}

	private onToggleReviewMode(inReview: boolean) {
		this.dispatchEvent(new CustomEvent('draft-state-changed', { detail: { inReview: inReview } }));
	}

	private onShowCodeSuggestion(id: string) {
		this.dispatchEvent(new CustomEvent('gl-show-code-suggestion', { detail: { id: id } }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-wip-panel': GlDetailsWipPanel;
	}
}
