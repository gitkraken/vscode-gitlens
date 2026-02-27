import type { TextDocumentShowOptions, Uri } from 'vscode';
import { Disposable, env, EventEmitter, window } from 'vscode';
import { CheckoutError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitRevisionReference } from '@gitlens/git/models/reference.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import type { Repository } from '@gitlens/git/models/repository.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isUncommitted, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { MRU } from '@gitlens/utils/mru.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CopyDeepLinkCommandArgs, CopyFileDeepLinkCommandArgs } from '../../commands/copyDeepLink.js';
import type { CopyMessageToClipboardCommandArgs } from '../../commands/copyMessageToClipboard.js';
import type { CopyShaToClipboardCommandArgs } from '../../commands/copyShaToClipboard.js';
import type { DiffWithCommandArgs } from '../../commands/diffWith.js';
import type { ExplainCommitCommandArgs } from '../../commands/explainCommit.js';
import type { ExplainWipCommandArgs } from '../../commands/explainWip.js';
import type { OpenFileOnRemoteCommandArgs } from '../../commands/openFileOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../../commands/openOnRemote.js';
import type { CreatePatchCommandArgs } from '../../commands/patches.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../constants.commands.js';
import type { InspectTelemetryContext, InspectWebviewTelemetryContext, Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { CommitSelectedEvent } from '../../eventBus.js';
import {
	applyChanges,
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileAtRevision,
	openFileOnRemote,
	restoreFile,
	showDetailsQuickPick,
} from '../../git/actions/commit.js';
import { executeGitCommand } from '../../git/actions.js';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import type { GlRepository } from '../../git/models/repository.js';
import { getCommitAuthorAvatarUri, getCommitForFile } from '../../git/utils/-webview/commit.utils.js';
import { getReferenceFromRevision } from '../../git/utils/-webview/reference.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { executeCommand, executeCoreCommand, registerWebviewCommand } from '../../system/-webview/command.js';
import { getContext, setContext } from '../../system/-webview/context.js';
import type { MergeEditorInputs } from '../../system/-webview/vscode/editors.js';
import { openMergeEditor } from '../../system/-webview/vscode/editors.js';
import { createCommandDecorator, getWebviewCommand } from '../../system/decorators/command.js';
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
import {
	getFileCommitFromContext,
	getUriFromContext,
	isDetailsFileContext,
	isDetailsItemContext,
} from './commitDetailsWebview.utils.js';
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
} from './protocol.js';
import { messageHeadlineSplitterToken } from './protocol.js';
import type { CommitDetailsWebviewShowingArgs } from './registration.js';

const { command, getCommands } =
	createCommandDecorator<GlWebviewCommandsOrCommandsWithSuffix<'commitDetails' | 'graphDetails'>>();

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
	private _showingCommitRef: { repoPath: string; sha: string } | undefined;
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
		private readonly host: WebviewHost<'gitlens.views.commitDetails' | 'gitlens.views.graphDetails'>,
		private readonly options: { attachedTo: 'default' | 'graph' },
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
		return this.options.attachedTo === 'graph' ? 'graph-details' : 'inspect';
	}

	getTelemetryContext(): InspectTelemetryContext {
		if (this._showingMode === 'wip') {
			const context: InspectTelemetryContext = {
				...this.host.getTelemetryContext(),
				'context.mode': 'wip',
				'context.attachedTo': this.options.attachedTo,
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
			'context.attachedTo': this.options.attachedTo,
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
			this._showingCommitRef = { repoPath: ref.repoPath, sha: ref.ref };
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
	private resolveCurrentCommitRef(): { repoPath: string; sha: string } | undefined {
		if (this._pinned) return undefined;

		// Check line tracker first (for the default inspect panel, not graph)
		if (this.options.attachedTo !== 'graph' && window.activeTextEditor != null) {
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
		if (this.options.attachedTo === 'graph') {
			const args = this.container.events.getCachedEventArgsBySource('commit:selected', 'gitlens.views.graph');
			if (args?.commit != null) {
				return { repoPath: args.commit.repoPath, sha: args.commit.ref };
			}
		} else {
			const args = this.container.events.getCachedEventArgs('commit:selected');
			if (args?.commit != null) {
				return { repoPath: args.commit.repoPath, sha: args.commit.ref };
			}
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

		for (const { command, handler } of getCommands()) {
			subscriptions.push(registerWebviewCommand(getWebviewCommand(command, this.host.type), handler, this));
		}

		return subscriptions;
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
		// Filter events based on attachedTo
		if (
			e.data == null ||
			(this.options.attachedTo === 'graph' && e.source !== 'gitlens.views.graph') ||
			(this.options.attachedTo === 'default' && e.source === 'gitlens.views.graph')
		) {
			return;
		}

		// Add to navigation stack and track what's being shown
		this._commitStack.insert(getReferenceFromRevision(e.data.commit));
		this._showingCommitRef = { repoPath: e.data.commit.repoPath, sha: e.data.commit.ref };

		// Forward event to webview - let webview decide what to do based on its state
		this._onCommitSelected.fire({
			repoPath: e.data.commit.repoPath,
			sha: e.data.commit.ref,
			searchContext: e.data.searchContext,
			passive: e.data.interaction === 'passive',
			// Graph Details auto-switches between WIP and commit modes based on selection
			requestedMode:
				this.options.attachedTo === 'graph'
					? e.data.commit.ref === uncommitted
						? 'wip'
						: 'commit'
					: undefined,
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

		if (this.options.attachedTo !== 'graph') {
			const { lineTracker } = this.container;
			this._lineTrackerDisposable = lineTracker.subscribe(
				this,
				lineTracker.onDidChangeActiveLines(this.onActiveEditorLinesChanged, this),
			);
		}
	}

	private get isLineTrackerSuspended() {
		return this.options.attachedTo !== 'graph' ? this._lineTrackerDisposable == null : false;
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

	private async onExplainRequest(repoPath: string, sha: string, signal?: AbortSignal): Promise<ExplainResult> {
		try {
			signal?.throwIfAborted();
			// Check if this is uncommitted changes
			if (sha === 'wip' || isUncommitted(sha)) {
				await executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
					repoPath: repoPath,
					source: { source: this.getTelemetrySource(), context: { type: 'wip' } },
				});
			} else {
				// TODO: Detect stash commits - for now assume regular commit
				await executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
					repoPath: repoPath,
					rev: sha,
					source: {
						source: this.getTelemetrySource(),
						context: { type: 'commit' },
					},
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
			this._showingCommitRef = { repoPath: commit.repoPath, sha: commit.ref };
			selectedCommit = { repoPath: commit.repoPath, sha: commit.ref };
		}

		return { navigationStack: this.getNavigationStack(), selectedCommit: selectedCommit };
	}

	private async getWipChange(repository: GlRepository): Promise<WipChange | undefined> {
		const status = await this.container.git.getRepositoryService(repository.path).status.getStatus();
		if (status == null) return undefined;

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
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
		const [commitResult, avatarUriResult] = await Promise.allSettled([
			!commit.hasFullDetails()
				? GitCommit.ensureFullDetails(commit, { include: { uncommittedFiles: true } }).then(() => commit)
				: commit,
			getCommitAuthorAvatarUri(commit, { size: 32 }),
		]);

		commit = getSettledValue(commitResult, commit);
		const avatarUri = getSettledValue(avatarUriResult);

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
			committer: { ...commit.committer, avatar: undefined },
			message: message,
			parents: commit.parents,
			stashNumber: commit.refType === 'stash' ? commit.stashNumber : undefined,
			// Serialize files to plain objects - GitFileChange class instances contain
			// a Container reference which causes circular reference errors during JSON serialization
			files: (commit.isUncommitted ? commit.anyFiles : commit.fileset?.files)?.map(f => ({
				repoPath: f.repoPath,
				path: f.path,
				status: f.status,
				originalPath: f.originalPath,
				staged: f.staged,
			})),
			stats: commit.stats,
		};
	}

	private async getFileCommitFromContextOrParams(
		item: DetailsItemContext | ExecuteFileActionParams | undefined,
	): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
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
		let commit: GitCommit | undefined;
		if (params.repoPath != null) {
			if (params.ref != null && params.ref !== uncommitted) {
				commit = await this.container.git.getRepositoryService(params.repoPath).commits.getCommit(params.ref);
			} else {
				commit = await this.container.git.getRepositoryService(params.repoPath).commits.getCommit(uncommitted);
			}
		}

		commit = commit != null ? await getCommitForFile(commit, params.path, params.staged) : undefined;
		return commit != null ? [commit, commit.file!] : [];
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
				void executeCommand<ShowInCommitGraphCommandArgs>(
					this.options.attachedTo === 'graph' ? 'gitlens.showInCommitGraphView' : 'gitlens.showInCommitGraph',
					{ ref: ref, source: { source: this.getTelemetrySource() } },
				);
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

		this.host.sendTelemetryEvent(
			`${this.options.attachedTo === 'graph' ? 'graphDetails' : 'commitDetails'}/mode/changed`,
			{
				'mode.old': params.mode === 'wip' ? 'commit' : 'wip', // Assume switching from opposite
				'mode.new': params.mode,
			},
		);
	}

	@command('gitlens.views.openChanges:')
	@debug()
	private async openChanges(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		void openChanges(file, commit, { preserveFocus: true, preview: true, ...this.getShowOptions(item) });
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
	}

	@command('gitlens.views.openChangesWithWorking:')
	@debug()
	private async openFileChangesWithWorking(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		void openChangesWithWorking(file, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(item),
		});
	}

	@command('gitlens.views.openPreviousChangesWithWorking:')
	@debug()
	private async openPreviousFileChangesWithWorking(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		void openChangesWithWorking(
			file,
			{ repoPath: commit.repoPath, ref: commit.unresolvedPreviousSha },
			{ preserveFocus: true, preview: true, ...this.getShowOptions(item) },
		);
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
	}

	@command('gitlens.views.openFile:')
	@debug()
	private async openFile(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		// if (file.submodule != null) {
		// 	const submodulePath = this.container.git.getAbsoluteUri(file.path, commit.repoPath).fsPath;
		// 	const submoduleRepo = this.container.git.getRepository(submodulePath);
		// 	if (submoduleRepo != null) {
		// 		const ref = createReference(file.submodule.oid, submoduleRepo.path, { refType: 'revision' });
		// 		void showInspectView({ commit: ref });
		// 	}
		// 	return;
		// }

		this.suspendLineTracker();
		void openFile(file, commit, { preserveFocus: true, preview: true });
	}

	@command('gitlens.openFileOnRemote:')
	@debug()
	private async openFileOnRemote(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void openFileOnRemote(file, commit);
	}

	@command('gitlens.views.stageFile:')
	@debug()
	private async stageFile(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		await this.container.git.getRepositoryService(commit.repoPath).staging?.stageFile(file.uri);
	}

	@command('gitlens.views.unstageFile:')
	@debug()
	private async unstageFile(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		await this.container.git.getRepositoryService(commit.repoPath).staging?.unstageFile(file.uri);
	}

	private getShowOptions(
		item: DetailsItemContext | ExecuteFileActionParams | undefined,
	): TextDocumentShowOptions | undefined {
		return isDetailsItemContext(item) ? undefined : item?.showOptions;

		// return getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebase:active')
		// 	? { ...params.showOptions, viewColumn: ViewColumn.Beside } : params.showOptions;
	}

	@command('gitlens.views.copy:')
	@debug()
	private async copy(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void env.clipboard.writeText(file.path);
	}

	@command('gitlens.copyRelativePathToClipboard:')
	@debug()
	private async copyRelativePath(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		const path = this.container.git.getRelativePath(file.uri, commit.repoPath);
		void env.clipboard.writeText(path);
	}

	@command('gitlens.copyPatchToClipboard:')
	@debug()
	private async copyPatch(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		let args: CreatePatchCommandArgs;
		if (commit.isUncommitted) {
			const to = commit.isUncommittedStaged ? uncommittedStaged : uncommitted;
			args = {
				repoPath: commit.repoPath,
				to: to,
				title: to === uncommittedStaged ? 'Staged Changes' : 'Uncommitted Changes',
				uris: [file.uri],
			};
		} else {
			if (commit.message == null) {
				await GitCommit.ensureFullDetails(commit);
			}

			const { summary: title, body: description } = splitCommitMessage(commit.message);

			args = {
				repoPath: commit.repoPath,
				to: commit.ref,
				from: `${commit.ref}^`,
				title: title,
				description: description,
				uris: [file.uri],
			};
		}

		void executeCommand<CreatePatchCommandArgs>('gitlens.copyPatchToClipboard', args);
	}

	@command('gitlens.views.openFileRevision:')
	@debug()
	private async openFileRevision(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		// if (file.submodule != null) {
		// 	const submodulePath = this.container.git.getAbsoluteUri(file.path, commit.repoPath).fsPath;
		// 	const submoduleRepo = this.container.git.getRepository(submodulePath);
		// 	if (submoduleRepo != null) {
		// 		const ref = createReference(file.submodule.oid, submoduleRepo.path, { refType: 'revision' });
		// 		void showInspectView({ commit: ref });
		// 	}
		// 	return;
		// }

		this.suspendLineTracker();
		void openFileAtRevision(file, commit, { preserveFocus: true, preview: false });
	}

	@command('gitlens.openFileHistory:')
	@debug()
	private async openFileHistory(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.openFileHistory', file.uri);
	}

	@command('gitlens.quickOpenFileHistory:')
	@debug()
	private async quickOpenFileHistory(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.quickOpenFileHistory', file.uri);
	}

	@command('gitlens.visualizeHistory.file:')
	@debug()
	private async visualizeFileHistory(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.visualizeHistory.file', file.uri);
	}

	@command('gitlens.openFileHistoryInGraph:')
	@debug()
	private async openFileHistoryInGraph(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.openFileHistoryInGraph', file.uri);
	}

	@command('gitlens.restore.file:')
	@debug()
	private async restoreFile(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const { path, repoPath, sha } = item.webviewItemValue;
		if (sha == null || sha === uncommitted) return;

		try {
			await this.container.git.getRepositoryService(repoPath).ops?.checkout(sha, { path: path });
		} catch (ex) {
			if (CheckoutError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to restore file');
			}
		}
	}

	@command('gitlens.restorePrevious.file:')
	@debug()
	private async restorePreviousFile(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void restoreFile(file, commit, true);
	}

	@command('gitlens.views.selectFileForCompare:')
	@debug()
	private selectFileForCompare(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const { repoPath, sha } = item.webviewItemValue;
		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		void setContext('gitlens:views:canCompare:file', { ref: sha ?? uncommitted, repoPath: repoPath, uri: uri });
	}

	@command('gitlens.views.compareFileWithSelected:')
	@debug()
	private async compareFileWithSelected(item: DetailsItemContext | undefined) {
		const selectedFile = getContext('gitlens:views:canCompare:file');
		if (selectedFile == null || !isDetailsFileContext(item)) return;

		void setContext('gitlens:views:canCompare:file', undefined);

		const { repoPath, sha } = item.webviewItemValue;
		if (selectedFile.repoPath !== repoPath) {
			this.selectFileForCompare(item);
			return;
		}

		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		await this.compareFileWith(selectedFile.repoPath, selectedFile.uri, selectedFile.ref, uri, sha ?? uncommitted);
	}

	private async compareFileWith(
		repoPath: string,
		lhsUri: Uri,
		lhsRef: string,
		rhsUri: Uri | undefined,
		rhsRef: string,
	) {
		rhsUri ??= await this.container.git.getRepositoryService(repoPath).getWorkingUri(lhsUri);

		return executeCommand<DiffWithCommandArgs, void>('gitlens.diffWith', {
			repoPath: repoPath,
			lhs: { sha: lhsRef, uri: lhsUri },
			rhs: { sha: rhsRef, uri: rhsUri ?? lhsUri },
		});
	}

	@command('gitlens.views.applyChanges:')
	@debug()
	private async applyChanges(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void applyChanges(file, commit);
	}

	@command('gitlens.views.mergeChangesWithWorking:')
	@debug()
	private async mergeChangesWithWorking(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		const svc = this.container.git.getRepositoryService(commit.repoPath);
		if (svc == null) return;

		const nodeUri = await svc.getBestRevisionUri(file.path, commit.ref);
		if (nodeUri == null) return;

		const input1: MergeEditorInputs['input1'] = {
			uri: nodeUri,
			title: `Incoming`,
			detail: ` ${commit.shortSha}`,
		};

		const [mergeBaseResult, workingUriResult] = await Promise.allSettled([
			svc.refs.getMergeBase(commit.ref, 'HEAD'),
			svc.getWorkingUri(file.uri),
		]);

		const workingUri = getSettledValue(workingUriResult);
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open the merge editor, no working file found');
			return;
		}
		const input2: MergeEditorInputs['input2'] = {
			uri: workingUri,
			title: 'Current',
			detail: ' Working Tree',
		};

		const headUri = await svc.getBestRevisionUri(file.path, 'HEAD');
		if (headUri != null) {
			const branch = await svc.branches.getBranch?.();

			input2.uri = headUri;
			input2.detail = ` ${branch?.name || 'HEAD'}`;
		}

		const mergeBase = getSettledValue(mergeBaseResult);
		const baseUri = mergeBase != null ? await svc.getBestRevisionUri(file.path, mergeBase) : undefined;

		return openMergeEditor({
			base: baseUri ?? nodeUri,
			input1: input1,
			input2: input2,
			output: workingUri,
		});
	}

	@command('gitlens.diffWithRevision:')
	@debug()
	private diffWithRevision(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		void executeCommand('gitlens.diffWithRevision', uri);
	}

	@command('gitlens.diffWithRevisionFrom:')
	@debug()
	private diffWithRevisionFrom(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		void executeCommand('gitlens.diffWithRevisionFrom', uri);
	}

	@command('gitlens.externalDiff:')
	@debug()
	private async externalDiff(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		const previousSha = await GitCommit.getPreviousSha(commit);
		const ref1 = isUncommitted(previousSha) ? '' : previousSha;
		const ref2 = commit.isUncommitted ? '' : commit.sha;

		void executeCommand('gitlens.externalDiff', {
			files: [{ uri: file.uri, staged: commit.isUncommittedStaged, ref1: ref1, ref2: ref2 }],
		});
	}

	@command('gitlens.views.highlightChanges:')
	@debug()
	private async highlightChanges(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		await openFile(file, commit, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: commit.ref },
			true,
		));
	}

	@command('gitlens.views.highlightRevisionChanges:')
	@debug()
	private async highlightRevisionChanges(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		await openFile(file, commit, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: commit.ref, only: true },
			true,
		));
	}

	@command('gitlens.copyDeepLinkToCommit:')
	@debug()
	private async copyDeepLinkToCommit(item: DetailsItemContext | undefined) {
		const [commit] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: commit });
	}

	@command('gitlens.copyDeepLinkToFile:')
	@debug()
	private async copyDeepLinkToFile(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<CopyFileDeepLinkCommandArgs>('gitlens.copyDeepLinkToFile', {
			ref: commit,
			filePath: file.path,
			repoPath: commit.repoPath,
		});
	}

	@command('gitlens.copyDeepLinkToFileAtRevision:')
	@debug()
	private async copyDeepLinkToFileAtRevision(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<CopyFileDeepLinkCommandArgs>('gitlens.copyDeepLinkToFileAtRevision', {
			ref: commit,
			filePath: file.path,
			repoPath: commit.repoPath,
			chooseRef: true,
		});
	}

	@command('gitlens.views.copyRemoteCommitUrl:')
	@debug()
	private async copyRemoteCommitUrl(item: DetailsItemContext | undefined) {
		const [commit] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: commit.repoPath,
			resource: { type: RemoteResourceType.Commit, sha: commit.ref },
			clipboard: true,
		});
	}

	@command('gitlens.shareAsCloudPatch:')
	@debug()
	private async shareAsCloudPatch(item: DetailsItemContext | undefined) {
		const [commit] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		if (commit.message == null) {
			await GitCommit.ensureFullDetails(commit);
		}

		const { summary: title, body: description } = splitCommitMessage(commit.message);

		void executeCommand<CreatePatchCommandArgs>('gitlens.createCloudPatch', {
			to: commit.ref,
			repoPath: commit.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.copyRemoteFileUrlFrom:')
	@debug()
	private async copyRemoteFileUrlFrom(item: DetailsItemContext | undefined) {
		const [commit, _file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<OpenFileOnRemoteCommandArgs>('gitlens.copyRemoteFileUrlFrom', {
			sha: commit.ref,
			clipboard: true,
			pickBranchOrTag: true,
			range: false,
		});
	}

	@command('gitlens.copyRemoteFileUrlWithoutRange:')
	@debug()
	private async copyRemoteFileUrlWithoutRange(item: DetailsItemContext | undefined) {
		const [commit, _file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<OpenFileOnRemoteCommandArgs>('gitlens.copyRemoteFileUrlWithoutRange', {
			sha: commit.ref,
			clipboard: true,
			range: false,
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
					const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
					if (commit == null) return undefined;
					signal?.throwIfAborted();
					// Track what the webview is showing so file actions know which commit to use
					this._showingCommitRef = { repoPath: repoPath, sha: sha };
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

				explainCommit: (repoPath: string, sha: string, signal?: AbortSignal) =>
					this.onExplainRequest(repoPath, sha, signal),

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
		},
	};
}
