import type { TextDocumentShowOptions } from 'vscode';
import { Disposable, EventEmitter, Uri, window } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { GitRevisionReference } from '@gitlens/git/models/reference.js';
import type { Repository } from '@gitlens/git/models/repository.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isUncommitted, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { MRU } from '@gitlens/utils/mru.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CopyMessageToClipboardCommandArgs } from '../../commands/copyMessageToClipboard.js';
import type { CopyShaToClipboardCommandArgs } from '../../commands/copyShaToClipboard.js';
import type { ExplainCommitCommandArgs } from '../../commands/explainCommit.js';
import type { ExplainStashCommandArgs } from '../../commands/explainStash.js';
import type { ExplainWipCommandArgs } from '../../commands/explainWip.js';
import type { InspectTelemetryContext, InspectWebviewTelemetryContext, Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { CommitSelectedEvent } from '../../eventBus.js';
import { showDetailsQuickPick } from '../../git/actions/commit.js';
import { executeGitCommand } from '../../git/actions.js';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import type { GlRepository } from '../../git/models/repository.js';
import {
	getCommitAndFileByPath,
	getCommitAuthorAvatarUri,
	getCommitCommitterAvatarUri,
} from '../../git/utils/-webview/commit.utils.js';
import { countConflictMarkers } from '../../git/utils/-webview/mergeConflicts.utils.js';
import { getReferenceFromRevision } from '../../git/utils/-webview/reference.utils.js';
import { executeCommand, executeCoreCommand, registerWebviewCommand } from '../../system/-webview/command.js';
import { getWebviewCommand } from '../../system/decorators/command.js';
import type { LinesChangeEvent } from '../../trackers/lineTracker.js';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { bufferEventHandler, createRpcEventSubscription } from '../rpc/eventVisibilityBuffer.js';
import { createSharedServices, proxyServices } from '../rpc/services/common.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import { isSerializedState } from '../webviewsController.js';
import type {
	CommitDetailsServices,
	CommitSelectionEvent,
	ExplainResult,
	GenerateResult,
	NavigateResult,
} from './commitDetailsService.js';
import type { ComparisonContext } from './commitDetailsWebview.utils.js';
import {
	getFileCommitFromContext,
	isDetailsFileContext,
	isDetailsFolderContext,
	isDetailsItemContext,
} from './commitDetailsWebview.utils.js';
import { DetailsFileCommands, getDetailsFileCommands } from './detailsFileCommands.js';
import {
	DetailsFolderCommands,
	getDetailsFolderCommands,
	sharedDetailsFolderCommandRoutes,
} from './detailsFolderCommands.js';
import type {
	CommitDetails,
	DetailsItemContext,
	ExecuteFileActionParams,
	GitBranchShape,
	Mode,
	ShowWipArgs,
	State,
	Wip,
	WipChange,
	WipFileChange,
} from './protocol.js';
import { messageHeadlineSplitterToken } from './protocol.js';
import type { CommitDetailsWebviewShowingArgs } from './registration.js';

// Commands that open or modify editor content and need the line tracker suspended
const lineTrackerCommands = new Set([
	'gitlens.views.openChanges:',
	'gitlens.views.openChangesWithWorking:',
	'gitlens.views.openPreviousChangesWithWorking:',
	'gitlens.views.openFile:',
	'gitlens.views.openFileRevision:',
	'gitlens.externalDiff:',
	'gitlens.views.highlightChanges:',
	'gitlens.views.highlightRevisionChanges:',
]);

// Internal type for WIP context (not exposed to webview)
interface WipContext {
	changes: WipChange | undefined;
	repositoryCount: number;
	branch?: GitBranch;
	repo: Repository;
}

/**
 * Backend provider for Commit Details webview.
 *
 * Architecture: The webview is the source of truth for ALL domain state
 * (commit details, WIP data, etc.). The backend:
 * - Tracks "showing context" (what was requested when opened) so it can
 *   tell the webview what to load on initialization
 * - Provides data via RPC methods (all accept params from webview)
 * - Forwards events to the webview
 * - Controls line tracker based on pinned state
 * - Maintains navigation history for back/forward
 *
 * The backend does NOT cache domain data (commit objects, WIP details, etc.).
 */
export class CommitDetailsWebviewProvider implements WebviewProvider<State, State, CommitDetailsWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _focused = false;

	/** Navigation history - backend keeps for back/forward navigation */
	private _commitStack = new MRU<GitRevisionReference>(10, (a, b) => a.ref === b.ref);

	/** Controls line tracker - set via setPin() RPC */
	private _pinned = false;

	// --- Showing context ---
	// These track what was requested when the webview was shown,
	// so getInitialContext() can tell the webview what to load.
	// This is NOT cached domain data - just the request parameters.
	private _showingMode: Mode = 'commit';
	private _showingCommitRef: { repoPath: string; sha: string; refType?: GitRevisionReference['refType'] } | undefined;
	private _showingWipRepoPath: string | undefined;
	private _showingInReview = false;
	private _showingSource: Sources | undefined;

	// --- Telemetry context pushed from the webview via RPC ---
	private _telemetryContext: InspectWebviewTelemetryContext | undefined;

	// View-specific event emitters — support multiple subscribers
	private readonly _onCommitSelected = new EventEmitter<CommitSelectionEvent>();
	private readonly _onShowWip = new EventEmitter<{ repoPath?: string; inReview: boolean }>();

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.commitDetails'>,
	) {
		this._disposable = Disposable.from();
	}

	dispose(): void {
		this._disposable.dispose();
		this._lineTrackerDisposable?.dispose();
		this._selectionTrackerDisposable?.dispose();
		this._onCommitSelected.dispose();
		this._onShowWip.dispose();
	}

	getTelemetrySource(): Sources {
		return 'inspect';
	}

	getTelemetryContext(): InspectTelemetryContext {
		if (this._showingMode === 'wip') {
			const context: InspectTelemetryContext = {
				...this.host.getTelemetryContext(),
				'context.mode': 'wip',
				'context.autolinks': 0,
				'context.inReview': this._showingInReview,
				'context.codeSuggestions': 0,
				...this._telemetryContext,
			};
			return context;
		}

		const context: InspectTelemetryContext = {
			...this.host.getTelemetryContext(),
			'context.mode': 'commit',
			'context.autolinks': 0,
			'context.pinned': this._pinned,
			'context.type': undefined,
			'context.uncommitted': false,
			...this._telemetryContext,
		};
		return context;
	}

	private _skipNextRefreshOnVisibilityChange = false;

	onShowing(
		loading: boolean,
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<CommitDetailsWebviewShowingArgs, State>
	): [boolean, InspectTelemetryContext] {
		const [arg] = args;
		if ((arg as ShowWipArgs)?.type === 'wip') {
			return [this.onShowingWip(arg as ShowWipArgs, loading, options), this.getTelemetryContext()];
		}

		return [
			this.onShowingCommit(arg as Partial<CommitSelectedEvent['data']> | undefined, loading, options),
			this.getTelemetryContext(),
		];
	}

	onShowingWip(arg: ShowWipArgs, loading: boolean, options?: WebviewShowOptions): boolean {
		if (options?.preserveVisibility && !this.host.visible) return false;

		// Capture showing context so getInitialContext() knows what to return
		this._showingMode = 'wip';
		this._showingWipRepoPath = arg.repository?.path;
		this._showingInReview = arg.inReview ?? false;
		this._showingSource = arg.source;
		this._showingCommitRef = undefined;

		// Resolve repo path if not explicitly provided
		if (this._showingWipRepoPath == null) {
			const repo = this.container.git.getBestRepositoryOrFirst();
			this._showingWipRepoPath = repo?.path;
		}

		if (this._showingInReview) {
			void this.trackOpenReviewMode(this._showingSource, this._showingWipRepoPath);
		}

		// If the webview is already live (reused panel), notify it to switch to WIP mode.
		// When loading=true, the webview will call fetchInitialState() which reads _showing* fields.
		if (!loading) {
			this._onShowWip.fire({
				repoPath: this._showingWipRepoPath,
				inReview: this._showingInReview,
			});
		}

		this._skipNextRefreshOnVisibilityChange = true;
		return true;
	}

	onShowingCommit(
		arg: Partial<CommitSelectedEvent['data']> | undefined,
		loading: boolean,
		options?: WebviewShowOptions,
	): boolean {
		let data: Partial<CommitSelectedEvent['data']> | undefined;

		if (isSerializedState<State>(arg)) {
			const { commit: selected } = arg.state;
			if (selected?.repoPath != null && selected?.sha != null) {
				if (selected.stashNumber != null) {
					data = {
						commit: createReference(selected.sha, selected.repoPath, {
							refType: 'stash',
							name: selected.message,
							number: selected.stashNumber,
						}),
					};
				} else {
					data = {
						commit: createReference(selected.sha, selected.repoPath, {
							refType: 'revision',
							message: selected.message,
						}),
					};
				}
			}
		} else if (arg != null && typeof arg === 'object') {
			data = arg;
		}

		// Add to navigation stack and capture showing context
		if (data?.commit != null) {
			const ref = getReferenceFromRevision(data.commit);
			this._commitStack.insert(ref);
			this._showingCommitRef = { repoPath: ref.repoPath, sha: ref.ref, refType: ref.refType };
		} else {
			// No explicit commit - try to resolve from event cache / line tracker
			this._showingCommitRef = this.resolveCurrentCommitRef();
		}

		this._showingMode = 'commit';
		this._showingWipRepoPath = undefined;
		this._showingInReview = false;

		if (data?.preserveVisibility && !this.host.visible) return false;
		if (options?.preserveVisibility && !this.host.visible) return false;

		// If the webview is already live (reused panel), fire commit selection event
		// so it navigates to the new commit. When loading=true, the webview will call
		// fetchInitialState() which reads _showingCommitRef.
		// Note: For event-bus-driven selections (graph clicks), onCommitSelected() fires
		// the event before show() is called, so this is a no-op (same commit).
		if (!loading && this._showingCommitRef != null) {
			this._onCommitSelected.fire({
				repoPath: this._showingCommitRef.repoPath,
				sha: this._showingCommitRef.sha,
				passive: false,
			});
		}

		this._skipNextRefreshOnVisibilityChange = true;
		return true;
	}

	/**
	 * Resolve the current commit ref from the event cache or line tracker.
	 * Used when no explicit commit is provided in onShowingCommit.
	 */
	private resolveCurrentCommitRef():
		| { repoPath: string; sha: string; refType?: GitRevisionReference['refType'] }
		| undefined {
		if (this._pinned) return undefined;

		// Check line tracker first
		if (window.activeTextEditor != null) {
			const { lineTracker } = this.container;
			const line = lineTracker.selections?.[0]?.active;
			if (line != null) {
				const commit = lineTracker.getState(line)?.commit;
				if (commit != null) {
					return { repoPath: commit.repoPath, sha: commit.sha };
				}
			}
		}

		// Check event cache
		const args = this.container.events.getCachedEventArgs('commit:selected');
		if (args?.commit != null) {
			return { repoPath: args.commit.repoPath, sha: args.commit.ref, refType: args.commit.refType };
		}

		return undefined;
	}

	async trackOpenReviewMode(source?: Sources, repoPath?: string): Promise<void> {
		const repoPrivacy = repoPath != null ? await this.container.git.visibility(repoPath) : undefined;

		this.host.sendTelemetryEvent('openReviewMode', {
			provider: 'unknown', // Provider info would need to be passed if needed
			'repository.visibility': repoPrivacy,
			repoPrivacy: repoPrivacy,
			source: source ?? this.getTelemetrySource(),
			filesChanged: 0, // File count would need to be passed if needed
		});
	}

	includeBootstrap(_deferrable?: boolean): Promise<State> {
		// Webview fetches all data via RPC — bootstrap only provides metadata
		return Promise.resolve({
			webviewId: this.host.id,
			webviewInstanceId: this.host.instanceId,
			timestamp: Date.now(),
		} as State);
	}

	registerCommands(): Disposable[] {
		const subscriptions: Disposable[] = [
			registerWebviewCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
		];

		// Shared file commands. `gitlens.views.copy:` and `gitlens.copyRelativePathToClipboard:` are
		// also wired to folder context — when the menu fires them on a folder row, route to the
		// folder commands instance instead of running the file lookup (which would no-op).
		const fileCommands = new DetailsFileCommands(this.container, this.host.id);
		const folderCommands = new DetailsFolderCommands(this.container);
		for (const { command: cmd, handler } of getDetailsFileCommands()) {
			const suspendsLineTracker = lineTrackerCommands.has(cmd);
			const folderRoute = sharedDetailsFolderCommandRoutes[cmd];
			subscriptions.push(
				registerWebviewCommand(
					getWebviewCommand(cmd, this.host.type),
					async (item?: DetailsItemContext | ExecuteFileActionParams) => {
						if (suspendsLineTracker) {
							this.suspendLineTracker();
						}

						if (folderRoute != null && isDetailsFolderContext(item)) {
							folderCommands[folderRoute](item.webviewItemValue);
							return;
						}

						const [commit, file, comparison] = await this.getFileCommitFromContextOrParams(item);
						if (commit == null) return;

						return void handler.call(fileCommands, commit, file, this.getShowOptions(item), comparison);
					},
					this,
				),
			);
		}

		// Folder-only commands (Folder History submenu). `gitlens.views.copy:` and
		// `gitlens.copyRelativePathToClipboard:` are intentionally NOT registered here — they share
		// IDs with the file commands above.
		for (const { command: cmd, handler } of getDetailsFolderCommands()) {
			if (cmd in sharedDetailsFolderCommandRoutes) continue;
			subscriptions.push(
				registerWebviewCommand(getWebviewCommand(cmd, this.host.type), (item?: DetailsItemContext) => {
					if (!isDetailsFolderContext(item)) return;
					handler.call(folderCommands, item.webviewItemValue);
				}),
			);
		}

		return subscriptions;
	}

	private getShowOptions(
		item: DetailsItemContext | ExecuteFileActionParams | undefined,
	): TextDocumentShowOptions | undefined {
		return isDetailsItemContext(item) ? undefined : item?.showOptions;
	}

	onFocusChanged(focused: boolean): void {
		if (this._focused === focused) return;

		this._focused = focused;
		if (focused && this.isLineTrackerSuspended) {
			this.ensureTrackers();
		}
	}

	// Note: Git actions (fetch, push, pull, etc.) are now called directly via RPC with repoPath param

	onRefresh(_force?: boolean | undefined): void {
		// Backend is stateless - webview handles refresh via RPC
		// Just ensure trackers are set up
		this.ensureTrackers();
	}

	onReloaded(): void {
		// Webview will call fetchInitialState() on reload via onRpcReady()
	}

	onVisibilityChanged(visible: boolean): void {
		this.ensureTrackers();
		if (!visible) return;

		const skipRefresh = this._skipNextRefreshOnVisibilityChange;
		if (skipRefresh) {
			this._skipNextRefreshOnVisibilityChange = false;
			return;
		}

		// Notify webview about potential changes that happened while hidden
		// WIP mode visibility refresh is handled by the webview's visibilitychange listener
		if (this._showingMode === 'commit' && !this._pinned) {
			// Commit mode: check if there's a current/new commit to show
			const commitRef = this.resolveCurrentCommitRef();
			if (commitRef != null) {
				this._onCommitSelected.fire({
					repoPath: commitRef.repoPath,
					sha: commitRef.sha,
					passive: true,
				});
			}
		}
	}

	/** Computes hasAccount fresh (no caching) */
	async getHasAccount(): Promise<boolean> {
		return (await this.container.subscription.getSubscription())?.account != null;
	}

	private onCommitSelected(e: CommitSelectedEvent) {
		if (e.data == null) return;

		// Add to navigation stack and track what's being shown
		const ref = getReferenceFromRevision(e.data.commit);
		this._commitStack.insert(ref);
		this._showingCommitRef = { repoPath: ref.repoPath, sha: ref.ref, refType: ref.refType };

		// Forward event to webview - let webview decide what to do based on its state
		this._onCommitSelected.fire({
			repoPath: e.data.commit.repoPath,
			sha: e.data.commit.ref,
			searchContext: e.data.searchContext,
			passive: e.data.interaction === 'passive',
		});

		// Show webview if not passive and not pinned
		if (e.data.interaction !== 'passive' && !this._pinned) {
			void this.host.show(false, { preserveFocus: e.data.preserveFocus }, e.data);
		}
	}

	private _lineTrackerDisposable: Disposable | undefined;
	private _selectionTrackerDisposable: Disposable | undefined;
	private ensureTrackers(): void {
		this._selectionTrackerDisposable?.dispose();
		this._selectionTrackerDisposable = undefined;
		this._lineTrackerDisposable?.dispose();
		this._lineTrackerDisposable = undefined;

		if (!this.host.visible) return;

		this._selectionTrackerDisposable = this.container.events.on('commit:selected', this.onCommitSelected, this);

		if (this._pinned) return;

		const { lineTracker } = this.container;
		this._lineTrackerDisposable = lineTracker.subscribe(
			this,
			lineTracker.onDidChangeActiveLines(this.onActiveEditorLinesChanged, this),
		);
	}

	private get isLineTrackerSuspended() {
		return this._lineTrackerDisposable == null;
	}

	private suspendLineTracker() {
		// Defers the suspension of the line tracker, so that the focus change event can be handled first
		setTimeout(() => {
			this._lineTrackerDisposable?.dispose();
			this._lineTrackerDisposable = undefined;
		}, 100);
	}

	private onActiveEditorLinesChanged(e: LinesChangeEvent) {
		if (e.pending || e.editor == null || e.suspended) return;

		// Get commit from line tracker
		const line = e.selections?.[0]?.active;
		const commit = line != null ? this.container.lineTracker.getState(line)?.commit : undefined;

		if (commit != null) {
			// Forward commit selection event to webview
			this._onCommitSelected.fire({
				repoPath: commit.repoPath,
				sha: commit.sha,
				passive: true, // Line tracker selections are passive
			});
		}
	}

	private async onExplainRequest(
		repoPath: string,
		sha: string,
		prompt?: string,
		signal?: AbortSignal,
	): Promise<ExplainResult> {
		try {
			signal?.throwIfAborted();
			// Check if this is uncommitted changes
			if (sha === 'wip' || isUncommitted(sha)) {
				await executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
					repoPath: repoPath,
					prompt: prompt || undefined,
					source: { source: this.getTelemetrySource(), context: { type: 'wip' } },
				});
			} else if (this._showingCommitRef?.refType === 'stash') {
				await executeCommand<ExplainStashCommandArgs>('gitlens.ai.explainStash', {
					repoPath: repoPath,
					rev: sha,
					prompt: prompt || undefined,
					source: { source: this.getTelemetrySource(), context: { type: 'stash' } },
				});
			} else {
				await executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
					repoPath: repoPath,
					rev: sha,
					prompt: prompt || undefined,
					source: { source: this.getTelemetrySource(), context: { type: 'commit' } },
				});
			}
			signal?.throwIfAborted();

			return { result: { summary: '', body: '' } };
		} catch (ex) {
			debugger;
			return { error: { message: ex.message } };
		}
	}

	private async onGenerateRequest(repoPath: string, signal?: AbortSignal): Promise<GenerateResult> {
		const repo = this.container.git.getRepository(repoPath);

		if (!repo) {
			return { error: { message: 'Unable to find repository' } };
		}

		try {
			signal?.throwIfAborted();
			const result = await this.container.ai.actions.generateCreateDraft(
				repo,
				{ source: this.getTelemetrySource(), context: { type: 'suggested_pr_change' } },
				{ progress: { location: { viewId: this.host.id } } },
			);
			signal?.throwIfAborted();
			if (result === 'cancelled') throw new Error('Operation was canceled');

			if (result == null) throw new Error('Error retrieving content');

			return {
				title: result.result.summary,
				description: result.result.body,
			};
		} catch (ex) {
			debugger;
			return { error: { message: ex.message } };
		}
	}

	private onNavigateStack(params: { direction: 'back' | 'forward' }): NavigateResult {
		const commit = this._commitStack.navigate(params.direction);
		let selectedCommit: NavigateResult['selectedCommit'];
		if (commit != null) {
			// Track what's being shown so file actions know which commit to use
			this._showingCommitRef = { repoPath: commit.repoPath, sha: commit.ref, refType: commit.refType };
			selectedCommit = { repoPath: commit.repoPath, sha: commit.ref };
		}

		return { navigationStack: this.getNavigationStack(), selectedCommit: selectedCommit };
	}

	private _wipConflictMarkerCache = new Map<string, { mtime: number; count: number }>();

	private async getWipChange(repository: GlRepository): Promise<WipChange | undefined> {
		const svc = this.container.git.getRepositoryService(repository.path);
		const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
			svc.status.getStatus(),
			svc.pausedOps?.getPausedOperationStatus?.(),
		]);

		const status = getSettledValue(statusResult);
		if (status == null) return undefined;

		const pausedOpStatus = getSettledValue(pausedOpStatusResult);

		const conflictMarkerCounts = new Map<string, number>();
		if (status.hasConflicts) {
			const conflictedPaths = new Set<string>();
			for (const file of status.files) {
				if (isConflictStatus(file.status)) {
					conflictedPaths.add(file.path);
				}
			}
			if (conflictedPaths.size > 0) {
				const paths = [...conflictedPaths];
				const counts = await Promise.allSettled(
					paths.map(p => countConflictMarkers(Uri.joinPath(repository.uri, p), this._wipConflictMarkerCache)),
				);
				paths.forEach((p, i) => {
					const count = getSettledValue(counts[i]);
					if (count != null) {
						conflictMarkerCounts.set(p, count);
					}
				});
			}
		}

		const files: WipFileChange[] = [];
		for (const file of status.files) {
			const conflictMarkers = conflictMarkerCounts.get(file.path);
			const change: WipFileChange = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
				conflictMarkers: conflictMarkers,
			};

			files.push(change);
			if (file.staged && file.wip) {
				files.push({ ...change, staged: false });
			}
		}

		return {
			repository: {
				name: repository.name,
				path: repository.path,
				uri: repository.uri.toString(),
			},
			branchName: status.branch,
			files: files,
			hasConflicts: status.hasConflicts,
			pausedOpStatus: pausedOpStatus,
		};
	}

	private onUpdatePinned(params: { pin: boolean }) {
		if (params.pin === this._pinned) return;

		this._pinned = params.pin;
		this.ensureTrackers();
		// Webview already knows the new pin state - no notification needed
	}

	// ============================================================
	// Event Delivery Helper
	// ============================================================

	/** Computes navigation stack from _commitStack (on demand, not cached) */
	private getNavigationStack(): { count: number; position: number; hint?: string } {
		let sha = this._commitStack.get(this._commitStack.position - 1)?.ref;
		if (sha != null) {
			sha = shortenRevision(sha);
		}
		return {
			count: this._commitStack.count,
			position: this._commitStack.position,
			hint: sha,
		};
	}

	// Removed: updateNavigation - navigation is handled via onNavigateStack which fires commit selection events

	private onChangeReviewModeCommand(params: { inReview: boolean; repoPath?: string }) {
		// inReview state is owned by webview - just track telemetry
		if (params.inReview) {
			void this.trackOpenReviewMode('inspect-overview', params.repoPath);
		}
	}

	/**
	 * Get core commit details (fast path — no autolinks, no enriched data).
	 * The message is raw-formatted (headline split) but not linkified with autolink patterns.
	 */
	private async getCoreCommitDetails(commit: GitCommit): Promise<CommitDetails> {
		const hasDistinctCommitter = commit.committer.email != null && commit.committer.email !== commit.author.email;
		const [commitResult, avatarUriResult, committerAvatarUriResult] = await Promise.allSettled([
			!commit.hasFullDetails()
				? GitCommit.ensureFullDetails(commit, { include: { uncommittedFiles: true } }).then(() => commit)
				: commit,
			getCommitAuthorAvatarUri(commit, { size: 32 }),
			hasDistinctCommitter ? getCommitCommitterAvatarUri(commit, { size: 32 }) : Promise.resolve(undefined),
		]);

		commit = getSettledValue(commitResult, commit);
		const avatarUri = getSettledValue(avatarUriResult);
		const committerAvatarUri = hasDistinctCommitter ? getSettledValue(committerAvatarUriResult) : undefined;

		// Raw message with headline split — no autolink linkification (that's deferred)
		let message = CommitFormatter.fromTemplate(`\${message}`, commit);
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${messageHeadlineSplitterToken}${message.substring(index + 1)}`;
		}

		return {
			repoPath: commit.repoPath,
			sha: commit.sha,
			shortSha: commit.shortSha,
			author: { ...commit.author, avatar: avatarUri?.toString(true) },
			committer: { ...commit.committer, avatar: committerAvatarUri?.toString(true) },
			message: message,
			parents: commit.parents,
			stashNumber: commit.refType === 'stash' ? commit.stashNumber : undefined,
			stashOnRef: commit.refType === 'stash' ? commit.stashOnRef : undefined,
			// Serialize files to plain objects - GitFileChange class instances contain
			// a Container reference which causes circular reference errors during JSON serialization
			files: (commit.isUncommitted ? commit.anyFiles : commit.fileset?.files)?.map(f => ({
				repoPath: f.repoPath,
				path: f.path,
				status: f.status,
				originalPath: f.originalPath,
				staged: f.staged,
				stats: f.stats,
			})),
			stats: commit.stats,
		};
	}

	private async getFileCommitFromContextOrParams(
		item: DetailsItemContext | ExecuteFileActionParams | undefined,
	): Promise<
		| [commit: GitCommit, file: GitFileChange, comparison?: ComparisonContext]
		| [commit?: undefined, file?: undefined, comparison?: undefined]
	> {
		if (item == null) return [];

		if (isDetailsItemContext(item)) {
			if (!isDetailsFileContext(item)) return [];

			return getFileCommitFromContext(this.container, item.webviewItemValue);
		}

		return this.getFileCommitFromParams(item);
	}

	private async getFileCommitFromParams(
		params: ExecuteFileActionParams,
	): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
		if (params.repoPath == null) return [];
		return getCommitAndFileByPath(params.repoPath, params.path, params.ref, params.staged);
	}

	private onShowCommitPicker() {
		// Open commit picker - let it determine best repo
		void executeGitCommand({
			command: 'log',
			state: { reference: 'HEAD', openPickInView: true },
		});
	}

	private onShowCommitSearch() {
		void executeGitCommand({ command: 'search', state: { openPickInView: true } });
	}

	private onExecuteCommitAction(params: {
		repoPath: string;
		sha: string;
		action: 'graph' | 'more' | 'scm' | 'sha';
		alt?: boolean;
	}) {
		switch (params.action) {
			case 'graph': {
				const ref = createReference(params.sha, params.repoPath, { refType: 'revision' });
				void executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
					ref: ref,
					source: { source: this.getTelemetrySource() },
				});
				break;
			}
			case 'more':
				void this.showCommitActions(params.repoPath, params.sha);
				break;

			case 'scm':
				void executeCoreCommand('workbench.view.scm');
				break;

			case 'sha':
				if (params.alt) {
					// Copy message - need to fetch commit to get message
					void this.container.git
						.getRepositoryService(params.repoPath)
						.commits.getCommit(params.sha)
						.then(commit => {
							if (commit != null) {
								void executeCommand<CopyMessageToClipboardCommandArgs>(
									'gitlens.copyMessageToClipboard',
									{
										message: commit.message,
									},
								);
							}
						});
				} else {
					void executeCommand<CopyShaToClipboardCommandArgs>('gitlens.copyShaToClipboard', {
						sha: params.sha,
					});
				}
				break;
		}
	}

	private async showCommitActions(repoPath: string, sha: string) {
		if (isUncommitted(sha)) return;

		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return;

		void showDetailsQuickPick(commit);
	}

	private async onShowFileActions(params: ExecuteFileActionParams) {
		const [commit, file] = await this.getFileCommitFromParams(params);
		if (commit == null) return;

		this.suspendLineTracker();
		void showDetailsQuickPick(commit, file);
	}

	private onSwitchMode(params: { mode: Mode; repoPath?: string }) {
		// Track mode so onVisibilityChanged knows whether to fire passive commit selection
		this._showingMode = params.mode;

		this.host.sendTelemetryEvent('commitDetails/mode/changed', {
			'mode.old': params.mode === 'wip' ? 'commit' : 'wip', // Assume switching from opposite
			'mode.new': params.mode,
		});
	}

	// ============================================================
	// RPC Services (Supertalk)
	// ============================================================

	/**
	 * Returns services to expose via RPC (Supertalk).
	 *
	 * These are thin wrappers around existing functionality, providing a
	 * service-oriented interface for the webview to call.
	 */
	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): CommitDetailsServices {
		const shared = createSharedServices(
			this.container,
			this.host,
			context => {
				this._telemetryContext = context as InspectWebviewTelemetryContext;
			},
			buffer,
			tracker,
		);

		return proxyServices({
			...shared,

			// ============================================================
			// Inspect: view-specific commit/WIP queries, navigation, actions, AI
			// ============================================================
			inspect: {
				// ── Events ──

				onCommitSelected: (callback: (event: CommitSelectionEvent) => void) => {
					this.ensureTrackers();
					const pendingKey = Symbol('commitSelected');
					const buffered = bufferEventHandler(buffer, pendingKey, callback, 'save-last');
					const disposable = this._onCommitSelected.event(buffered);

					// Replay cached selection so webview gets the current commit
					// even if the event fired before subscription was ready.
					const commitRef = this.resolveCurrentCommitRef();
					if (commitRef != null) {
						callback({
							repoPath: commitRef.repoPath,
							sha: commitRef.sha,
							passive: true,
						});
					}

					const unsubscribe = () => {
						buffer?.removePending(pendingKey);
						disposable.dispose();
					};
					return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
				},

				onShowWip: createRpcEventSubscription<{ repoPath?: string; inReview: boolean }>(
					buffer,
					'showWip',
					'save-last',
					buffered => this._onShowWip.event(buffered),
					undefined,
					tracker,
				),

				// ── Initialization ──

				getInitialContext: () =>
					Promise.resolve({
						mode: this._showingMode,
						pinned: this._pinned,
						navigationStack: this.getNavigationStack(),
						inReview: this._showingInReview,
						initialCommit: this._showingCommitRef,
						initialWipRepoPath: this._showingWipRepoPath,
					}),

				// ── Commit Queries ──

				getCommit: async (repoPath: string, sha: string, signal?: AbortSignal) => {
					signal?.throwIfAborted();
					const svc = this.container.git.getRepositoryService(repoPath);
					let commit: GitCommit | undefined;
					if (this._showingCommitRef?.refType === 'stash') {
						const stash = await svc.stash?.getStash();
						commit = stash?.stashes.get(sha);
					}
					commit ??= await svc.commits.getCommit(sha);
					if (commit == null) return undefined;
					signal?.throwIfAborted();
					// Track what the webview is showing so file actions know which commit to use
					this._showingCommitRef = { repoPath: repoPath, sha: sha, refType: commit.refType };
					const details = await this.getCoreCommitDetails(commit);
					signal?.throwIfAborted();
					return details;
				},

				// ── WIP Queries ──

				getWipChanges: async (repoPath?: string, signal?: AbortSignal) => {
					signal?.throwIfAborted();
					const repo =
						repoPath != null
							? this.container.git.getRepository(repoPath)
							: this.container.git.getBestRepositoryOrFirst();
					if (repo == null) return undefined;

					const changes = await this.getWipChange(repo);
					if (changes == null) return undefined;
					signal?.throwIfAborted();

					// Get branch info (fast, local) but NOT PR or code suggestions (deferred)
					const branch = await repo.git.branches.getBranch(changes.branchName);
					signal?.throwIfAborted();

					return serializeWipContext({
						changes: changes,
						repo: repo,
						repositoryCount: this.container.git.openRepositoryCount,
						branch: branch,
					});
				},

				// ── Navigation ──

				navigate: direction => {
					return Promise.resolve(this.onNavigateStack({ direction: direction }));
				},

				setPin: pin => {
					this.onUpdatePinned({ pin: pin });
					return Promise.resolve();
				},

				switchMode: (mode, repoPath) => {
					this.onSwitchMode({ mode: mode, repoPath: repoPath });
					return Promise.resolve();
				},

				changeReviewMode: (inReview, repoPath) => {
					this.onChangeReviewModeCommand({ inReview: inReview, repoPath: repoPath });
					return Promise.resolve();
				},

				// ── Commit Actions ──

				executeCommitAction: (repoPath, sha, action, alt?) => {
					this.onExecuteCommitAction({ repoPath: repoPath, sha: sha, action: action, alt: alt });
					return Promise.resolve();
				},

				pickCommit: () => {
					this.onShowCommitPicker();
					return Promise.resolve();
				},

				searchCommit: () => {
					this.onShowCommitSearch();
					return Promise.resolve();
				},

				openAutolinkSettings: async () => {
					await executeCommand('gitlens.showSettingsPage!autolinks');
				},

				// ── AI Operations ──

				explainCommit: (repoPath: string, sha: string, prompt?: string, signal?: AbortSignal) =>
					this.onExplainRequest(repoPath, sha, prompt, signal),

				generateDescription: (repoPath: string, signal?: AbortSignal) =>
					this.onGenerateRequest(repoPath, signal),
			},
		} satisfies CommitDetailsServices);
	}
}

function serializeBranch(branch?: GitBranch): GitBranchShape | undefined {
	if (branch == null) return undefined;

	return {
		name: branch.name,
		repoPath: branch.repoPath,
		upstream: branch.upstream,
		tracking: {
			ahead: branch.upstream?.state.ahead ?? 0,
			behind: branch.upstream?.state.behind ?? 0,
		},
	};
}

function serializeWipContext(wip?: WipContext): Wip | undefined {
	if (wip == null) return undefined;

	return {
		changes: wip.changes,
		repositoryCount: wip.repositoryCount,
		branch: serializeBranch(wip.branch),
		repo: {
			uri: wip.repo.uri.toString(),
			name: wip.repo.name,
			path: wip.repo.path,
			isWorktree: wip.repo.isWorktree,
		},
	};
}
