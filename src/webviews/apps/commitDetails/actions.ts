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
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestRefs, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.ts';
import { Logger } from '@gitlens/utils/logger.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Autolink } from '../../../autolinks/models/autolinks.js';
import type { ViewFilesLayout } from '../../../config.js';
import type { GlExtensionCommands } from '../../../constants.commands.js';
import type { InspectWebviewTelemetryContext, TelemetryEvents } from '../../../constants.telemetry.js';
import type { Draft } from '../../../plus/drafts/models/drafts.js';
import type { CommitDetailsServices, InitialContext } from '../../commitDetails/commitDetailsService.js';
import type {
	CommitDetails,
	CommitSignatureShape,
	FileShowOptions,
	Mode,
	Wip,
	WipChange,
} from '../../commitDetails/protocol.js';
import { fetchCommitEnrichment } from '../shared/actions/commitEnrichment.js';
import type { OpenMultipleChangesArgs } from '../shared/actions/file.js';
import * as fileActions from '../shared/actions/file.js';
import * as gitActions from '../shared/actions/git.js';
import * as prActions from '../shared/actions/pr.js';
import {
	enrichmentGuard,
	entry,
	fireAndForget,
	fireRpc,
	noop,
	noopUnlessReal,
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
 * Each sub-service is resolved once at startup via `await services.inspect`, etc.
 */
export interface ResolvedServices {
	readonly inspect: ResolvedSubService<'inspect'>;
	readonly drafts: ResolvedSubService<'drafts'>;
	readonly repositories: ResolvedSubService<'repositories'>;
	readonly repository: ResolvedSubService<'repository'>;
	readonly commands: ResolvedSubService<'commands'>;
	readonly config: ResolvedSubService<'config'>;
	readonly storage: ResolvedSubService<'storage'>;
	readonly ai: ResolvedSubService<'ai'>;
	readonly autolinks: ResolvedSubService<'autolinks'>;
	readonly subscription: ResolvedSubService<'subscription'>;
	readonly integrations: ResolvedSubService<'integrations'>;
	readonly files: ResolvedSubService<'files'>;
	readonly pullRequests: ResolvedSubService<'pullRequests'>;
	readonly telemetry: ResolvedSubService<'telemetry'>;
}

/**
 * Resources bag for Commit Details — created in commitDetails.ts, passed to actions.
 */
export interface CommitDetailsResources {
	readonly commit: Resource<CommitDetails | undefined, [string, string]>;
	readonly wip: Resource<Wip | undefined, [string | undefined]>;
	readonly reachability: Resource<GitCommitReachability | undefined>;
	readonly explain: Resource<ExplainState | undefined, [string | undefined]>;
	readonly generate: Resource<GenerateState | undefined>;
}

interface FetchCommitOptions {
	force?: boolean;
}

/** Per-SHA aggregate of resolved enrichment values. Mirrors the graph-details cache shape:
 *  `hasPullRequest` / `hasSignature` are sentinels because `undefined` is a valid resolved
 *  value (commit not signed, no PR), distinguishing "not fetched yet" from "fetched and got nothing". */
interface CommitEnrichmentCacheEntry {
	commit?: CommitDetails;
	autolinks?: Autolink[];
	formattedMessage?: string;
	autolinkedIssues?: IssueOrPullRequest[];
	pullRequest?: PullRequestShape | undefined;
	signature?: CommitSignatureShape | undefined;
	hasPullRequest?: boolean;
	hasSignature?: boolean;
}

const commitEnrichmentCacheLimit = 32;

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
	private _navigating = false;
	private _wipWatchRepoPath: string | undefined;
	private _wipWatchUnsubscribe: (() => void) | undefined;

	/** Aborts when a new commit selection arrives — propagates to host-side enrichment RPCs
	 *  via `signal?.throwIfAborted()` so abandoned work stops at the next checkpoint instead
	 *  of running to completion + shipping a dead-letter response over the channel. */
	private _enrichmentController?: AbortController;

	/** SHA-keyed cache of commit shell + chip enrichment. Hydrated synchronously on revisit so
	 *  chips are visible from t≈0ms instead of flashing through cleared state. Same shape as the
	 *  graph-details panel's cache. Populated as fetches resolve via the sink in `fetchCommit`. */
	private readonly _commitEnrichmentCache = new LruMap<string, CommitEnrichmentCacheEntry>(
		commitEnrichmentCacheLimit,
	);

	constructor(
		private readonly state: CommitDetailsState,
		private readonly services: ResolvedServices,
		private readonly resources: CommitDetailsResources,
	) {}

	private resetEnrichment(): AbortSignal {
		this._enrichmentController?.abort();
		const controller = new AbortController();
		this._enrichmentController = controller;
		return controller.signal;
	}

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

	/**
	 * Subscribe to FS changes for a WIP repo. Unsubscribes from previous repo if different.
	 *
	 * Supertalk RPC marshals subscription methods as `Promise<Unsubscribe>`, so the call
	 * must be awaited — a synchronous assignment captures the Promise (not callable)
	 * and breaks teardown with `is not a function`.
	 */
	private watchWipRepo(repoPath: string): void {
		if (repoPath === this._wipWatchRepoPath) return;

		this._wipWatchUnsubscribe?.();
		this._wipWatchUnsubscribe = undefined;
		this._wipWatchRepoPath = repoPath;

		void (async () => {
			const unsubscribe = (await this.services.repository.onRepositoryWorkingChanged(repoPath, () => {
				void this.fetchWipState(repoPath);
			})) as unknown as (() => void) | undefined;
			if (typeof unsubscribe !== 'function') return;
			// Repo changed again (or was cleared) while awaiting — drop this subscription.
			if (this._wipWatchRepoPath !== repoPath) {
				unsubscribe();
				return;
			}
			this._wipWatchUnsubscribe = unsubscribe;
		})();
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

	sendTelemetryEvent(
		name: keyof TelemetryEvents,
		data?: Record<string, string | number | boolean | undefined>,
	): void {
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
		if (this._navigating || !this.state.canNavigateBack.get()) return;

		this._navigating = true;
		try {
			const result = await this.services.inspect.navigate('back');
			this.state.navigationStack.set(result.navigationStack);
			if (result.selectedCommit != null) {
				this.state.searchContext.set(undefined);
				await this.fetchCommit(result.selectedCommit.repoPath, result.selectedCommit.sha, { force: true });
			}
		} catch (ex) {
			Logger.error(ex, 'navigate back failed');
		} finally {
			this._navigating = false;
		}
	}

	/**
	 * Navigate forward in the commit stack.
	 * Updates the navigation stack signal from the backend response.
	 */
	async navigateForward(): Promise<void> {
		if (this._navigating || !this.state.canNavigateForward.get()) return;

		this._navigating = true;
		try {
			const result = await this.services.inspect.navigate('forward');
			this.state.navigationStack.set(result.navigationStack);
			if (result.selectedCommit != null) {
				this.state.searchContext.set(undefined);
				await this.fetchCommit(result.selectedCommit.repoPath, result.selectedCommit.sha, { force: true });
			}
		} catch (ex) {
			Logger.error(ex, 'navigate forward failed');
		} finally {
			this._navigating = false;
		}
	}

	async refetchCurrentCommit(): Promise<void> {
		const current = this.state.currentCommit.get();
		if (current == null) return;

		await this.fetchCommit(current.repoPath, current.sha, { force: true });
	}

	/**
	 * Toggle the pinned state.
	 * Uses optimistic update with rollback on error.
	 * Auto-persisted via `startAutoPersist()` — no manual `persistState()`.
	 */
	togglePin(): void {
		const newPinned = !this.state.pinned.get();
		optimisticFireAndForget(this.state.pinned, newPinned, this.services.inspect.setPin(newPinned), 'toggle pin');
	}

	/**
	 * Open commit picker to select a different commit.
	 */
	pickCommit(): void {
		fireAndForget(this.services.inspect.pickCommit(), 'pick commit');
	}

	/**
	 * Open commit search dialog.
	 */
	searchCommit(): void {
		fireAndForget(this.services.inspect.searchCommit(), 'search commit');
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
		this.services.inspect.switchMode(newMode, repoPath).catch((ex: unknown) => {
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
			this.services.inspect.changeReviewMode(inReview, repoPath),
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
		gitActions.fetch(this.services.repository, repoPath);
	}

	push(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.push(this.services.repository, repoPath);
	}

	pull(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.pull(this.services.repository, repoPath);
	}

	switchBranch(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.switchBranch(this.services.repository, repoPath);
	}

	stageFile(file: GitFileChangeShape): void {
		gitActions.stageFile(this.state.error, this.services.repository, file);
	}

	unstageFile(file: GitFileChangeShape): void {
		gitActions.unstageFile(this.state.error, this.services.repository, file);
	}

	discardFile(file: GitFileChangeShape): void {
		gitActions.discardFile(this.state.error, this.services.repository, file);
	}

	discardUnstagedFiles(): void {
		const repoPath = this.getRepoPath();
		if (!repoPath) return;
		gitActions.discardUnstagedFiles(this.state.error, this.services.repository, repoPath);
	}

	// ============================================================
	// File Actions
	// ============================================================

	/** Get the current commit SHA for file actions (undefined in WIP mode → uses uncommitted). */
	private getCurrentRef(): string | undefined {
		if (this.state.mode.get() === 'wip') return undefined;
		return this.state.currentCommit.get()?.sha;
	}

	openFile(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.openFile(this.services.files, file, showOptions, this.getCurrentRef());
	}

	openFileOnRemote(file: GitFileChangeShape): void {
		fileActions.openFileOnRemote(this.services.files, file, this.getCurrentRef());
	}

	openFileCompareWorking(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.openFileCompareWorking(this.services.files, file, showOptions, this.getCurrentRef());
	}

	openFileComparePrevious(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.openFileComparePrevious(this.services.files, file, showOptions, this.getCurrentRef());
	}

	executeFileAction(file: GitFileChangeShape, showOptions?: FileShowOptions): void {
		fileActions.executeFileAction(this.services.files, file, showOptions, this.getCurrentRef());
	}

	openMultipleChanges(args: OpenMultipleChangesArgs): void {
		fileActions.openMultipleChanges(this.services.files, args);
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
			this.services.inspect.executeCommitAction(commit.repoPath, commit.sha, action, alt),
			`commit action: ${action}`,
		);
	}

	/**
	 * Execute a non-webview GitLens command.
	 */
	executeCommand(command: GlExtensionCommands, ...args: unknown[]): void {
		fireAndForget(this.services.commands.execute(command, ...args), `command: ${command}`);
	}

	openOnRemote(repoPath: string | undefined, sha: string): void {
		if (!repoPath) return;
		void this.services.commands.execute('gitlens.openOnRemote', {
			repoPath: repoPath,
			resource: { type: 'commit' satisfies `${RemoteResourceType.Commit}`, sha: sha },
		});
	}

	changeFilesLayout(layout: ViewFilesLayout): void {
		const prefs = this.state.preferences.get();
		if (!prefs?.files) return;

		const files = { ...prefs.files, layout: layout };
		this.state.preferences.set({ ...prefs, files: files });
		void this.services.config.update('views.commitDetails.files.layout', layout);
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
		prActions.openPullRequestChanges(this.services.pullRequests, ctx.repoPath, ctx.refs);
	}

	openPullRequestComparison(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestComparison(this.services.pullRequests, ctx.repoPath, ctx.refs);
	}

	openPullRequestOnRemote(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestOnRemote(this.services.pullRequests, ctx.url);
	}

	openPullRequestDetails(): void {
		const ctx = this.getPrContext();
		if (!ctx) return;
		prActions.openPullRequestDetails(this.services.pullRequests, ctx.repoPath, ctx.id, ctx.provider);
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

		void this.services.drafts
			.suggestChanges({
				repoPath: wip.repo.path,
				...params,
			})
			.then(() => {
				this.changeReviewMode(false);
			}, noop);
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
	async explainCommit(prompt?: string): Promise<void> {
		const commit = this.state.currentCommit.get();
		if (!commit) return;

		await this.resources.explain.fetch(prompt);
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
			const context: InitialContext = await this.services.inspect.getInitialContext();

			// When the host explicitly provides an initial commit, honor its mode (e.g., graph
			// selecting a specific commit should show it in commit mode, not WIP).
			// Otherwise, persisted state takes priority — it reflects the user's most recent interaction.
			const mode =
				context.initialCommit != null
					? context.mode
					: persistedMode !== 'commit'
						? persistedMode
						: context.mode;
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
				.getIntegrationStates()
				.then(s => (this.state.capabilities.hasIntegrationsConnected = s.some(i => i.connected)), noop);

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
	async fetchCommit(repoPath: string, sha: string, options?: FetchCommitOptions): Promise<void> {
		const current = this.state.currentCommit.get();
		if (!options?.force && current?.repoPath === repoPath && current?.sha === sha) {
			// Already showing this commit — cancel any in-flight request
			this.resources.commit.cancel();
			return;
		}

		this.state.error.set(undefined);
		this.resources.reachability.cancel();
		this.resources.explain.cancel();
		this.resources.generate.cancel();

		// Abort any prior in-flight enrichment so a slow autolinks / PR / signature lookup from
		// the previous selection can't overwrite the new selection's state. Host-side methods
		// honor the signal via `signal?.throwIfAborted()` so abandoned work stops at the next
		// checkpoint instead of running to completion.
		const enrichSignal = this.resetEnrichment();

		// Hydrate from cache synchronously when we've previously seen this SHA. Skipping the
		// flash-out → flash-in cycle on revisit: chips are visible from t≈0ms instead of after
		// the gating commit.fetch + 30-60ms enrichment fan-out completes. Cache miss falls back
		// to the existing eager-clear so prior-selection chips don't linger over the new commit's
		// metadata once it lands.
		const cacheKey = `${sha}:${repoPath}`;
		const cached = this._commitEnrichmentCache.get(cacheKey);
		if (cached != null) {
			if (cached.commit != null) {
				this.state.currentCommit.set(cached.commit);
				this.state.commitRef.set({ sha: cached.commit.sha, repoPath: cached.commit.repoPath });
			}
			this.state.autolinks.set(cached.autolinks);
			this.state.formattedMessage.set(cached.formattedMessage);
			this.state.autolinkedIssues.set(cached.autolinkedIssues);
			this.state.pullRequest.set(cached.hasPullRequest ? cached.pullRequest : undefined);
			this.state.signature.set(cached.hasSignature ? cached.signature : undefined);
		} else {
			this.state.autolinks.set(undefined);
			this.state.formattedMessage.set(undefined);
			this.state.autolinkedIssues.set(undefined);
			this.state.pullRequest.set(undefined);
			this.state.signature.set(undefined);
		}

		await this.resources.commit.fetch(repoPath, sha);

		// Write result to state for derived signals and events
		if (this.resources.commit.status.get() === 'success') {
			const commit = this.resources.commit.value.get();
			this.state.currentCommit.set(commit);
			this.state.commitRef.set(commit ? { sha: commit.sha, repoPath: commit.repoPath } : undefined);

			if (commit != null) {
				// Cache the freshly-fetched commit shell so future revisits hydrate instantly.
				this._commitEnrichmentCache.update(cacheKey, { commit: commit });

				// Shared chip-enrichment fan-out — same orchestration as the graph details panel
				// (basic autolinks + enriched autolinks + PR + signature in parallel, generation
				// guarded, abort-aware, AbortError-silent rejection). Sink writes resolved values
				// into commitDetails state signals AND the per-SHA cache so revisits show chips
				// from t≈0ms.
				fetchCommitEnrichment(
					this.services,
					this.resources.commit,
					enrichSignal,
					{
						repoPath: repoPath,
						sha: sha,
						isStash: commit.stashNumber != null,
						autolinksEnabled: this.state.capabilities.autolinksEnabled,
					},
					{
						setBasicAutolinks: (autolinks, formattedMessage) => {
							this._commitEnrichmentCache.update(cacheKey, {
								autolinks: autolinks,
								formattedMessage: formattedMessage,
							});
							this.state.autolinks.set(autolinks);
							this.state.formattedMessage.set(formattedMessage);
						},
						setEnrichedAutolinks: (issues, formattedMessage) => {
							this._commitEnrichmentCache.update(cacheKey, {
								autolinkedIssues: issues,
								formattedMessage: formattedMessage,
							});
							this.state.autolinkedIssues.set(issues);
							// Enriched formatted message overrides basic (has issue titles in tooltips)
							this.state.formattedMessage.set(formattedMessage);
						},
						setPullRequest: pr => {
							this._commitEnrichmentCache.update(cacheKey, { pullRequest: pr, hasPullRequest: true });
							this.state.pullRequest.set(pr);
						},
						setSignature: sig => {
							this._commitEnrichmentCache.update(cacheKey, { signature: sig, hasSignature: true });
							this.state.signature.set(sig);
						},
					},
				);

				// Check if repo has remotes (for "Open on Remote" action) — not enrichment, but
				// shares the generation-guard pattern.
				void this.services.repository.hasRemotes(repoPath).then(
					enrichmentGuard(this.resources.commit, has => {
						if (enrichSignal.aborted) return;
						this.state.hasRemotes.set(has);
					}),
					noopUnlessReal,
				);
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
				// enrichmentGuard() prevents stale callbacks from writing data for a replaced WIP
				const guard = <T>(onResult: (value: T) => void) => enrichmentGuard<T>(this.resources.wip, onResult);
				void this.services.pullRequests.getPullRequestForBranch(effectiveRepoPath).then(
					guard(pr => {
						this.state.pullRequest.set(pr);
						if (pr != null) {
							void this.services.drafts.getCodeSuggestions(effectiveRepoPath).then(
								enrichmentGuard(this.resources.wip, suggestions =>
									this.state.codeSuggestions.set(suggestions),
								),
								noop,
							);
						}
					}),
					noop,
				);
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
			const [pullRequestExpandedResult, configResult, coreConfigResult, aiEnabledResult] =
				await Promise.allSettled([
					this.services.storage.getWorkspace('views:commitDetails:pullRequestExpanded'),
					this.services.config.getMany(
						'views.commitDetails.avatars',
						'defaultCurrentUserNameStyle',
						'defaultDateFormat',
						'defaultDateStyle',
						'views.commitDetails.files',
						'signing.showSignatureBadges',
						'views.commitDetails.autolinks.enabled',
						'ai.experimental.composer.enabled',
					),
					this.services.config.getManyCore(
						'workbench.tree.renderIndentGuides',
						'workbench.tree.indent',
						'git.enableSmartCommit',
					),
					this.services.ai.isEnabled(),
				]);

			const pullRequestExpanded = getSettledValue(pullRequestExpandedResult);
			const [
				avatars,
				currentUserNameStyle,
				dateFormat,
				dateStyle,
				files,
				showSignatureBadges,
				autolinksEnabled,
				experimentalComposerEnabled,
			] = getSettledValue(configResult) ?? [];
			const [indentGuides, indent, enableSmartCommit] = getSettledValue(coreConfigResult) ?? [];
			const aiEnabled = getSettledValue(aiEnabledResult);

			this.state.preferences.set({
				currentUserNameStyle: currentUserNameStyle ?? 'you',
				pullRequestExpanded: pullRequestExpanded ?? true,
				avatars: avatars ?? true,
				dateFormat: dateFormat ?? 'MMMM Do, YYYY h:mma',
				dateStyle: dateStyle ?? 'relative',
				files: files ??
					this.state.preferences.get()?.files ?? {
						layout: 'auto',
						compact: true,
						threshold: 5,
						icon: 'type',
					},
				indentGuides: indentGuides ?? 'onHover',
				indent: indent,
				aiEnabled: aiEnabled ?? false,
				enableSmartCommit: enableSmartCommit ?? false,
				showSignatureBadges: showSignatureBadges ?? false,
			});
			if (autolinksEnabled != null) {
				this.state.capabilities.autolinksEnabled = autolinksEnabled;
			}
			if (experimentalComposerEnabled != null) {
				this.state.capabilities.experimentalComposerEnabled = experimentalComposerEnabled;
			}
		} catch (ex) {
			Logger.error(ex, 'Failed to fetch preferences');
		}
	}

	/**
	 * Check integrations status.
	 */
	async checkIntegrations(): Promise<void> {
		try {
			const states = await this.services.integrations.getIntegrationStates();
			this.state.capabilities.hasIntegrationsConnected = states.some(i => i.connected);
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
				this.push();
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
