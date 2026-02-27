/**
 * Actions for the Commit Details webview.
 *
 * Actions are methods that:
 * 1. Update local state (via signals)
 * 2. Make RPC calls to the backend
 *
 * Patterns used:
 * - Resources: commit, wip, reachability, explain, generate resources handle
 *   fetch/cancel/staleness (replaces CancellableRequest + manual loading)
 * - Auto-persistence: persisted signals are auto-saved via `startAutoPersist()`
 *   (replaces manual `persistState()` / `getHostIpcApi().setState()`)
 * - State bridging: after resource fetch, actions writes results to state signals
 *   so derived signals (isUncommitted, wipStatus) and events can read them
 *
 * The CommitDetailsActions class requires resolved sub-services, state, and
 * resources in the constructor (resolve-once pattern), which enables:
 * - Easier unit testing (mock services, state, and resources can be injected)
 * - Clear lifecycle management (no module-level state)
 * - Single await per sub-service at startup, then direct calls
 */
import type { Remote } from '@eamodio/supertalk';
import type { ViewFilesLayout } from '../../../config.js';
import type { GlExtensionCommands } from '../../../constants.commands.js';
import type { InspectWebviewTelemetryContext } from '../../../constants.telemetry.js';
import type { GitFileChangeShape } from '../../../git/models/fileChange.js';
import type { PullRequestRefs } from '../../../git/models/pullRequest.js';
import type { Draft } from '../../../plus/drafts/models/drafts.js';
import { Logger } from '../../../system/logger.js';
import type { CommitDetailsServices, InitialContext } from '../../commitDetails/commitDetailsService.js';
import type { FileShowOptions, Mode, WipChange } from '../../commitDetails/protocol.js';
import * as fileActions from '../shared/actions/file.js';
import * as gitActions from '../shared/actions/git.js';
import * as prActions from '../shared/actions/pr.js';
import {
	entry,
	fireAndForget,
	fireRpc,
	noop,
	optimisticBatchFireAndForget,
	optimisticFireAndForget,
} from '../shared/actions/rpc.js';
import type { Resource } from '../shared/state/resource.js';
import type { CreatePatchEventDetail } from './components/gl-inspect-patch.js';
import type { CommitDetailsState, ExplainState, GenerateState } from './state.js';

// ============================================================
// Resolved Services Type (resolve-once pattern)
// ============================================================

/**
 * Helper type: resolves a sub-service from Remote<CommitDetailsServices>.
 * After `const git = await services.git`, the type is `ResolvedSubService<'git'>`.
 */
type ResolvedSubService<K extends keyof CommitDetailsServices> = Awaited<Remote<CommitDetailsServices>[K]>;

/**
 * Resolved sub-services passed to CommitDetailsActions.
 * Each sub-service is resolved once at startup via `await services.git`, etc.
 */
export interface ResolvedServices {
	readonly git: ResolvedSubService<'git'>;
	readonly commands: ResolvedSubService<'commands'>;
	readonly config: ResolvedSubService<'config'>;
	readonly storage: ResolvedSubService<'storage'>;
	readonly ai: ResolvedSubService<'ai'>;
	readonly subscription: ResolvedSubService<'subscription'>;
	readonly integrations: ResolvedSubService<'integrations'>;
	readonly actions: ResolvedSubService<'actions'>;
	readonly navigation: ResolvedSubService<'navigation'>;
	readonly drafts: ResolvedSubService<'drafts'>;
	readonly telemetry: ResolvedSubService<'telemetry'>;
}

/**
 * Resources bag for Commit Details — created in commitDetails.ts, passed to actions.
 */
export interface CommitDetailsResources {
	readonly commit: Resource<import('../../commitDetails/protocol.js').CommitDetails | undefined, [string, string]>;
	readonly wip: Resource<import('../../commitDetails/protocol.js').Wip | undefined, [string | undefined]>;
	readonly reachability: Resource<import('../../../git/gitProvider.js').GitCommitReachability | undefined>;
	readonly explain: Resource<ExplainState | undefined>;
	readonly generate: Resource<GenerateState | undefined>;
}

// ============================================================
// CommitDetailsActions Class
// ============================================================

/**
 * Actions class for the Commit Details webview.
 *
 * This class encapsulates all user actions and RPC calls.
 * It requires resolved sub-services, instance-owned state, and resources
 * to be injected via the constructor.
 */
export class CommitDetailsActions {
	private _wipWatchRepoPath: string | undefined;
	private _wipWatchUnsubscribe: (() => void) | undefined;

	constructor(
		private readonly state: CommitDetailsState,
		private readonly services: ResolvedServices,
		private readonly resources: CommitDetailsResources,
	) {}

	/**
	 * Cancel all in-flight resource requests.
	 *
	 * Called when the webview becomes hidden (`visibilitychange`) to prevent
	 * hanging promises — VS Code silently drops host→webview `postMessage`
	 * while hidden, so RPC responses would never arrive.
	 *
	 * Safe because:
	 * - Resources handle abort internally via `AbortController`
	 * - Host-side cooperative cancellation fires via `AbortSignal`
	 * - Visibility restore re-fetches via event replays and `visibilitychange`
	 */
	cancelPendingRequests(): void {
		this.resources.commit.cancel();
		this.resources.wip.cancel();
		this.resources.reachability.cancel();
		this.resources.explain.cancel();
		this.resources.generate.cancel();
	}

	/** Subscribe to FS changes for a WIP repo. Unsubscribes from previous repo if different. */
	private watchWipRepo(repoPath: string): void {
		if (repoPath === this._wipWatchRepoPath) return;

		this._wipWatchUnsubscribe?.();
		this._wipWatchRepoPath = repoPath;
		this._wipWatchUnsubscribe = this.services.git.onRepositoryWorkingChanged(repoPath, () => {
			void this.fetchWipState(repoPath);
		});
	}

	/** Stop watching WIP repo FS changes. */
	unwatchWip(): void {
		this._wipWatchUnsubscribe?.();
		this._wipWatchUnsubscribe = undefined;
		this._wipWatchRepoPath = undefined;
	}

	// ============================================================
	// Telemetry Actions
	// ============================================================

	updateTelemetryContext(context: InspectWebviewTelemetryContext): void {
		fireAndForget(this.services.telemetry.updateContext(context));
	}

	sendTelemetryEvent(name: string, data?: Record<string, string | number | boolean | undefined>): void {
		fireAndForget(this.services.telemetry.sendEvent(name, data));
	}

	// ============================================================
	// Navigation Actions
	// ============================================================

	/**
	 * Navigate back in the commit stack.
	 * Updates the navigation stack signal from the backend response.
	 */
	async navigateBack(): Promise<void> {
		if (!this.state.canNavigateBack.get()) return;

		try {
			const navStack = await this.services.navigation.navigate('back');
			this.state.navigationStack.set(navStack);
		} catch (ex) {
			Logger.error(ex, 'navigate back failed');
		}
	}

	/**
	 * Navigate forward in the commit stack.
	 * Updates the navigation stack signal from the backend response.
	 */
	async navigateForward(): Promise<void> {
		if (!this.state.canNavigateForward.get()) return;

		try {
			const navStack = await this.services.navigation.navigate('forward');
			this.state.navigationStack.set(navStack);
		} catch (ex) {
			Logger.error(ex, 'navigate forward failed');
		}
	}

	/**
	 * Toggle the pinned state.
	 * Uses optimistic update with rollback on error.
	 * Auto-persisted via `startAutoPersist()` — no manual `persistState()`.
	 */
	togglePin(): void {
		const newPinned = !this.state.pinned.get();
		optimisticFireAndForget(this.state.pinned, newPinned, this.services.navigation.setPin(newPinned), 'toggle pin');
	}

	/**
	 * Open commit picker to select a different commit.
	 */
	pickCommit(): void {
		fireAndForget(this.services.actions.pickCommit(), 'pick commit');
	}

	/**
	 * Open commit search dialog.
	 */
	searchCommit(): void {
		fireAndForget(this.services.actions.searchCommit(), 'search commit');
	}

	// ============================================================
	// Mode Switching Actions
	// ============================================================

	/**
	 * Switch between commit and WIP modes.
	 * When switching to WIP, also fetches WIP data.
	 * Auto-persisted via `startAutoPersist()` — no manual `persistState()`.
	 */
	switchMode(newMode: Mode): void {
		if (newMode === this.state.mode.get()) return;

		const commit = this.state.currentCommit.get();
		const repoPath = commit?.repoPath;

		// Update mode immediately
		this.state.mode.set(newMode);

		// Tell backend about mode change (handles telemetry)
		this.services.navigation.switchMode(newMode, repoPath).catch((ex: unknown) => {
			Logger.error(ex, 'switch mode RPC failed');
		});

		// If switching to WIP, fetch WIP data (also starts FS watching)
		if (newMode === 'wip') {
			void this.fetchWipState(repoPath);
		} else {
			this.unwatchWip();
		}
	}

	/**
	 * Toggle review mode for WIP.
	 * Uses optimistic batch update with rollback on error.
	 */
	changeReviewMode(inReview: boolean): void {
		if (inReview === this.state.inReview.get()) return;

		const repoPath = this.state.wipState.get()?.repo?.path;
		optimisticBatchFireAndForget(
			[entry(this.state.inReview, inReview), entry(this.state.draftState, { inReview: inReview })],
			this.services.navigation.changeReviewMode(inReview, repoPath),
			'change review mode',
			this.state.error,
		);
	}

	// ============================================================
	// Preferences Actions
	// ============================================================

	/**
	 * Update a preference value via direct config/workspace storage calls.
	 * Uses optimistic update with rollback on error.
	 */
	updatePullRequestExpanded(expanded: boolean): void {
		const currentPrefs = this.state.preferences.get();
		if (currentPrefs == null) {
			fireRpc(
				this.state.error,
				this.services.storage.updateWorkspace('views:commitDetails:pullRequestExpanded', expanded),
				'update pullRequestExpanded',
			);
			return;
		}
		optimisticFireAndForget(
			this.state.preferences,
			{ ...currentPrefs, pullRequestExpanded: expanded },
			this.services.storage.updateWorkspace('views:commitDetails:pullRequestExpanded', expanded),
			'update pullRequestExpanded',
		);
	}

	updateFilesLayout(files: {
		compact?: boolean;
		icon?: 'type' | 'status';
		layout?: ViewFilesLayout;
		threshold?: number;
	}): void {
		const currentPrefs = this.state.preferences.get();
		if (currentPrefs == null) return;

		const newPrefs = { ...currentPrefs, files: { ...currentPrefs.files, ...files } };
		this.state.preferences.set(newPrefs);

		// Persist each changed property individually
		if (files.compact != null) {
			fireAndForget(
				this.services.config.update('views.commitDetails.files.compact', files.compact),
				'update files.compact',
			);
		}
		if (files.icon != null) {
			fireAndForget(
				this.services.config.update('views.commitDetails.files.icon', files.icon),
				'update files.icon',
			);
		}
		if (files.layout != null) {
			fireAndForget(
				this.services.config.update('views.commitDetails.files.layout', files.layout),
				'update files.layout',
			);
		}
		if (files.threshold != null) {
			fireAndForget(
				this.services.config.update('views.commitDetails.files.threshold', files.threshold),
				'update files.threshold',
			);
		}
	}

	// ============================================================
	// Git Actions
	// ============================================================

	/** Get the current repository path (from WIP state or commit) */
	private getRepoPath(): string | undefined {
		const wip = this.state.wipState.get();
		if (wip?.repo?.path) return wip.repo.path;
		return this.state.currentCommit.get()?.repoPath;
	}

	fetch(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.fetch(this.services.git, repoPath);
	}

	push(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.push(this.services.git, repoPath);
	}

	pull(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.pull(this.services.git, repoPath);
	}

	publish(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.publish(this.services.git, repoPath);
	}

	switchBranch(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.switchBranch(this.services.git, repoPath);
	}

	stageFile(file: GitFileChangeShape): void {
		gitActions.stageFile(this.state.error, this.services.git, file);
	}

	unstageFile(file: GitFileChangeShape): void {
		gitActions.unstageFile(this.state.error, this.services.git, file);
	}

	// ============================================================
	// File Actions
	// ============================================================

	/** Get the current commit SHA for file actions. */
	private getCurrentRef(): string | undefined {
		return this.state.currentCommit.get()?.sha;
	}

	openFile(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.openFile(this.services.actions, file, showOptions, this.getCurrentRef());
	}

	openFileOnRemote(file: GitFileChangeShape): void {
		fileActions.openFileOnRemote(this.services.actions, file, this.getCurrentRef());
	}

	openFileCompareWorking(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.openFileCompareWorking(this.services.actions, file, showOptions, this.getCurrentRef());
	}

	openFileComparePrevious(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.openFileComparePrevious(this.services.actions, file, showOptions, this.getCurrentRef());
	}

	executeFileAction(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.executeFileAction(this.services.actions, file, showOptions, this.getCurrentRef());
	}

	// ============================================================
	// Commit Actions
	// ============================================================

	/**
	 * Execute a commit action (show in graph, copy SHA, etc.).
	 */
	executeCommitAction(action: 'graph' | 'more' | 'scm' | 'sha', alt?: boolean): void {
		const commit = this.state.currentCommit.get();
		if (!commit) return;
		fireAndForget(
			this.services.actions.executeCommitAction(commit.repoPath, commit.sha, action, alt),
			`commit action: ${action}`,
		);
	}

	/**
	 * Execute a non-webview GitLens command.
	 */
	executeCommand(command: GlExtensionCommands, ...args: unknown[]): void {
		fireAndForget(this.services.commands.execute(command, ...args), `command: ${command}`);
	}

	// ============================================================
	// Pull Request Actions
	// ============================================================

	/** Get PR context from state */
	private getPrContext():
		| { repoPath: string; refs: PullRequestRefs; url: string; id: string; provider: string }
		| undefined {
		const pr = this.state.pullRequest.get();
		const repoPath = this.state.wipState.get()?.repo?.path ?? this.state.currentCommit.get()?.repoPath;
		if (!pr?.refs || !repoPath) return undefined;
		return {
			repoPath: repoPath,
			refs: pr.refs,
			url: pr.url,
			id: pr.id,
			provider: pr.provider?.id ?? 'unknown',
		};
	}

	openPullRequestChanges(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestChanges(this.services.actions, ctx.repoPath, ctx.refs);
	}

	openPullRequestComparison(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestComparison(this.services.actions, ctx.repoPath, ctx.refs);
	}

	openPullRequestOnRemote(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestOnRemote(this.services.actions, ctx.url);
	}

	openPullRequestDetails(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestDetails(this.services.actions, ctx.repoPath, ctx.id, ctx.provider);
	}

	// ============================================================
	// Draft/Patch Actions
	// ============================================================

	/**
	 * Create a patch from WIP changes.
	 */
	createPatchFromWip(changes: WipChange, checked: boolean | 'staged'): void {
		fireAndForget(this.services.drafts.createPatchFromWip(changes, checked), 'create patch from WIP');
	}

	/**
	 * Suggest changes (create a draft).
	 * Requires WIP state with PR context.
	 */
	suggestChanges(params: CreatePatchEventDetail): void {
		const wip = this.state.wipState.get();
		if (!wip?.repo?.path) return;

		fireAndForget(
			this.services.drafts.suggestChanges({
				repoPath: wip.repo.path,
				...params,
			}),
			'suggest changes',
		);
	}

	/**
	 * Show a code suggestion.
	 */
	showCodeSuggestion(draft: Draft): void {
		fireAndForget(this.services.drafts.showCodeSuggestion(draft), 'show code suggestion');
	}

	// ============================================================
	// AI Actions (via resources)
	// ============================================================

	/**
	 * Generate an AI explanation of the current commit.
	 * Resource handles cancel-previous and staleness.
	 */
	async explainCommit(): Promise<void> {
		const commit = this.state.currentCommit.get();
		if (!commit) return;

		await this.resources.explain.fetch();
	}

	/**
	 * Generate AI title and description for WIP changes.
	 * Resource handles cancel-previous and staleness.
	 */
	async generateDescription(): Promise<void> {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;

		await this.resources.generate.fetch();
	}

	// ============================================================
	// Reachability Actions (via resource)
	// ============================================================

	/**
	 * Load commit reachability data (branches/tags containing the commit).
	 * Resource handles cancel-previous and loading state.
	 */
	async loadReachability(): Promise<void> {
		if (this.resources.reachability.loading.get()) return;

		const commit = this.state.currentCommit.get();
		if (commit == null) return;

		await this.resources.reachability.fetch();
	}

	/**
	 * Clear reachability data without re-fetching (e.g., on repo changes that
	 * invalidate branches/tags).
	 */
	clearReachability(): void {
		this.resources.reachability.cancel();
		this.resources.reachability.mutate(undefined);
	}

	/**
	 * Refresh commit reachability data.
	 */
	refreshReachability(): void {
		this.resources.reachability.mutate(undefined);
		void this.loadReachability();
	}

	// ============================================================
	// Data Fetching Actions
	// ============================================================

	/**
	 * Fetch all initial state for the webview.
	 * Persisted mode/pinned/commitRef are already restored by `createStateGroup` —
	 * no manual `getHostIpcApi().getState()` needed.
	 */
	async fetchInitialState(): Promise<void> {
		this.state.loading.set(true);
		this.state.error.set(undefined);

		// Persisted signals already contain restored values from previous session
		const persistedMode = this.state.mode.get();
		const persistedPinned = this.state.pinned.get();
		const persistedCommitRef = this.state.commitRef.get();

		try {
			// Get initial context (mode, navigation, initial commit/wip info)
			const context: InitialContext = await this.services.navigation.getInitialContext();

			// Persisted state takes priority — it reflects the user's most recent interaction.
			// Host state is fallback for first open (no persisted state yet).
			const mode = persistedMode !== 'commit' ? persistedMode : (persistedMode ?? context.mode);
			const pinned = persistedPinned || context.pinned;

			this.state.mode.set(mode);
			this.state.pinned.set(pinned);
			this.state.navigationStack.set(context.navigationStack);
			this.state.inReview.set(context.inReview);
			this.state.draftState.set({ inReview: context.inReview });

			// Fire config calls as fire-and-forget — each sets its signal on resolve.
			// These don't gate domain data; signals have safe defaults until they arrive.
			void this.fetchPreferences();
			void this.services.config
				.get('views.commitDetails.autolinks.enabled')
				.then(a => (this.state.capabilities.autolinksEnabled = a), noop);
			void this.services.config
				.get('ai.experimental.composer.enabled')
				.then(c => (this.state.capabilities.experimentalComposerEnabled = c), noop);
			// Note: hasAccount and orgSettings use RemoteSignalBridge (connected in commitDetails.ts)
			void this.services.integrations
				.hasAnyConnected()
				.then(i => (this.state.capabilities.hasIntegrationsConnected = i), noop);

			// Fetch domain data based on mode — the only thing worth blocking on.
			// Use persisted commitRef as fallback when host has no initial commit.
			const initialCommit = context.initialCommit ?? persistedCommitRef;
			if (mode === 'commit' && initialCommit != null) {
				await this.fetchCommit(initialCommit.repoPath, initialCommit.sha);
			} else if (mode === 'wip') {
				await this.fetchWipState(context.initialWipRepoPath);
			}
		} catch (ex) {
			Logger.error(ex, 'Failed to fetch initial state');
			this.state.error.set(ex instanceof Error ? ex.message : 'Failed to initialize');
		} finally {
			this.state.loading.set(false);
		}
	}

	/**
	 * Fetch commit details from the backend.
	 * Resource handles cancel-previous and loading state. After fetch,
	 * the result is written to state signals for derived signals and events.
	 * Autolinks and enriched data are fire-and-forget.
	 */
	async fetchCommit(repoPath: string, sha: string): Promise<void> {
		const current = this.state.currentCommit.get();
		if (current?.repoPath === repoPath && current?.sha === sha) {
			// Already showing this commit — cancel any in-flight request
			this.resources.commit.cancel();
			return;
		}

		this.state.error.set(undefined);

		// Clear commit-dependent state immediately so the UI never shows
		// a mix of the new commit's core data with the old commit's extras
		this.state.autolinks.set(undefined);
		this.state.formattedMessage.set(undefined);
		this.state.autolinkedIssues.set(undefined);
		this.state.pullRequest.set(undefined);
		this.state.signature.set(undefined);
		this.resources.reachability.mutate(undefined);
		this.resources.explain.mutate(undefined);
		this.resources.generate.mutate(undefined);

		await this.resources.commit.fetch(repoPath, sha);

		// Write result to state for derived signals and events
		if (this.resources.commit.status.get() === 'success') {
			const commit = this.resources.commit.value.get();
			this.state.currentCommit.set(commit);
			this.state.commitRef.set(commit ? { sha: commit.sha, repoPath: commit.repoPath } : undefined);

			if (commit != null) {
				// Fire autolinks and enriched data in parallel — don't block render
				void this.services.git.getCommitAutolinks(repoPath, sha).then(r => {
					if (r != null) {
						this.state.autolinks.set(r.autolinks);
						this.state.formattedMessage.set(r.formattedMessage);
					}
				}, noop);
				void this.services.git.getCommitEnriched(repoPath, sha).then(r => {
					if (r != null) {
						this.state.autolinkedIssues.set(r.autolinkedIssues);
						this.state.pullRequest.set(r.associatedPullRequest);
						this.state.signature.set(r.signature);
						// Enriched formatted message overrides basic
						this.state.formattedMessage.set(r.formattedMessage);
					}
				}, noop);
			}
		} else if (this.resources.commit.error.get() != null) {
			this.state.error.set(this.resources.commit.error.get());
		}
	}

	/**
	 * Fetch WIP state from the backend.
	 * Resource handles cancel-previous and loading state. After fetch,
	 * the result is written to state signals. PR and code suggestions
	 * are fire-and-forget.
	 */
	async fetchWipState(repoPath?: string): Promise<void> {
		this.state.error.set(undefined);

		// Clear WIP-dependent state
		this.state.pullRequest.set(undefined);
		this.state.codeSuggestions.set(undefined);

		await this.resources.wip.fetch(repoPath);

		// Write result to state for derived signals and events
		if (this.resources.wip.status.get() === 'success') {
			const wip = this.resources.wip.value.get();
			this.state.wipState.set(wip);

			// Watch this repo for FS changes (replaces backend subscribeToRepository)
			const effectiveRepoPath = wip?.repo?.path ?? repoPath;
			if (effectiveRepoPath != null) {
				this.watchWipRepo(effectiveRepoPath);

				// Fire PR and code suggestions in parallel — don't block WIP render
				void this.services.git.getAssociatedPullRequest(effectiveRepoPath).then(pr => {
					this.state.pullRequest.set(pr);
					if (pr != null) {
						void this.services.drafts
							.getCodeSuggestions(effectiveRepoPath)
							.then(suggestions => this.state.codeSuggestions.set(suggestions), noop);
					}
				}, noop);
			}
		} else if (this.resources.wip.error.get() != null) {
			this.state.error.set(this.resources.wip.error.get());
		}
	}

	/**
	 * Fetch preferences from the backend via individual config calls.
	 */
	async fetchPreferences(): Promise<void> {
		try {
			const [
				pullRequestExpanded,
				[avatars, dateFormat, dateStyle, files, showSignatureBadges],
				[indentGuides, indent],
				aiEnabled,
			] = await Promise.all([
				this.services.storage.getWorkspace('views:commitDetails:pullRequestExpanded'),
				this.services.config.getMany(
					'views.commitDetails.avatars',
					'defaultDateFormat',
					'defaultDateStyle',
					'views.commitDetails.files',
					'signing.showSignatureBadges',
				),
				this.services.config.getManyCore('workbench.tree.renderIndentGuides', 'workbench.tree.indent'),
				this.services.ai.isEnabled(),
			]);
			this.state.preferences.set({
				pullRequestExpanded: pullRequestExpanded ?? true,
				avatars: avatars,
				dateFormat: dateFormat ?? 'MMMM Do, YYYY h:mma',
				dateStyle: dateStyle ?? 'relative',
				files: files,
				indentGuides: indentGuides ?? 'onHover',
				indent: indent,
				aiEnabled: aiEnabled,
				showSignatureBadges: showSignatureBadges,
			});
		} catch (ex) {
			Logger.error(ex, 'Failed to fetch preferences');
		}
	}

	/**
	 * Check integrations status.
	 */
	async checkIntegrations(): Promise<void> {
		try {
			const hasIntegrations = await this.services.integrations.hasAnyConnected();
			this.state.capabilities.hasIntegrationsConnected = hasIntegrations;
		} catch (ex) {
			Logger.error(ex, 'Failed to check integrations status');
		}
	}

	// ============================================================
	// Branch Actions (convenience wrapper)
	// ============================================================

	/**
	 * Handle branch action by name.
	 */
	handleBranchAction(action: string): void {
		switch (action) {
			case 'pull':
				this.pull();
				break;
			case 'push':
				this.push();
				break;
			case 'fetch':
				this.fetch();
				break;
			case 'publish-branch':
				this.publish();
				break;
			case 'switch':
				this.switchBranch();
				break;
			case 'open-pr-changes':
				this.openPullRequestChanges();
				break;
			case 'open-pr-compare':
				this.openPullRequestComparison();
				break;
			case 'open-pr-remote':
				this.openPullRequestOnRemote();
				break;
			case 'open-pr-details':
				this.openPullRequestDetails();
				break;
		}
	}
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a new CommitDetailsActions instance.
 * This is the preferred way to create actions in production code.
 */
export function createActions(
	state: CommitDetailsState,
	services: ResolvedServices,
	resources: CommitDetailsResources,
): CommitDetailsActions {
	return new CommitDetailsActions(state, services, resources);
}
