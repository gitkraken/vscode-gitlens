/**
 * Signal-based state management for the Commit Details webview.
 *
 * State is instance-owned: the root component creates a `CommitDetailsState` via
 * `createCommitDetailsState()` and passes it to actions/events as a parameter.
 * No module-level singletons.
 *
 * State Categories:
 * 1. Persisted (survive hide/show/refresh) — pinned, commitRef
 * 2. Ephemeral UI — navigationStack
 * 3. Domain Data — currentCommit, preferences, enrichment signals
 * 4. Remote Bridges — orgSettings, hasAccount (connected to host signals post-RPC)
 * 5. Resource-owned (NOT in state) — loading, reachability, explain
 * 6. Derived — computed from above (canNavigateBack, isUncommitted, etc.)
 *
 * Signals removed from state (now resource-owned in commitDetails.ts):
 * - loadingCommit → commitResource.loading
 * - reachabilityState → reachabilityResource.status
 * - reachability → reachabilityResource.value
 * - explainState → explainResource.value
 */
import { computed } from '@lit-labs/signals';
import { signalObject } from 'signal-utils/object';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { Autolink } from '../../../autolinks/models/autolinks.js';
import type { CommitDetails, CommitSignatureShape, Preferences } from '../../commitDetails/protocol.js';
import type { NavigationState } from '../shared/controllers/navigationStack.js';
import type { HostStorage } from '../shared/host/storage.js';
import { createRemoteSignalBridge } from '../shared/state/remoteSignal.js';
import { createStateGroup } from '../shared/state/signals.js';

// ============================================================
// Explain/Generate State (for AI features)
// ============================================================

export interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

/**
 * Creates a new Commit Details state instance with all signals initialized to defaults.
 * Called by the root component; the returned object is passed to actions/events
 * as a parameter.
 *
 * @param storage - Optional host storage for persisting UI state.
 */
export function createCommitDetailsState(storage?: HostStorage) {
	const { signal, persisted, resetAll, startAutoPersist, dispose } = createStateGroup({
		storage: storage,
		version: 1,
	});

	// ── Infrastructure ──

	const loading = signal(false);
	const error = signal<string | undefined>(undefined);

	// ── Persisted UI State ──

	const pinned = persisted('pinned', false);
	/** Persisted commit reference for reload recovery (replaces manual persistState). */
	const commitRef = persisted<{ sha: string; repoPath: string } | undefined>('commitRef', undefined);

	// ── Ephemeral UI State ──

	const navigationStack = signal<NavigationState>({ count: 0, position: 0, canBack: false, canForward: false });

	// ── Domain Data ──

	/** Current commit details — set by actions after resource fetch. */
	const currentCommit = signal<CommitDetails | undefined>(undefined);
	const searchContext = signal<GitCommitSearchContext | undefined>(undefined);
	const preferences = signal<Preferences | undefined>(undefined);

	/** Organization settings — connected to remote signal once RPC connects. Single `.get()`. */
	const orgSettings = createRemoteSignalBridge({ ai: false, drafts: false });

	/** Whether the user has a GitKraken account — connected to remote signal once RPC connects. Single `.get()`. */
	const hasAccount = createRemoteSignalBridge(false);

	const capabilities = signalObject({ hasIntegrationsConnected: false, autolinksEnabled: false });

	// ── Repository context ──

	const hasRemotes = signal(false);

	// ── Enrichment (fire-and-forget, not resources) ──

	const autolinks = signal<Autolink[] | undefined>(undefined);
	const formattedMessage = signal<string | undefined>(undefined);
	const autolinkedIssues = signal<IssueOrPullRequest[] | undefined>(undefined);
	const pullRequest = signal<PullRequestShape | undefined>(undefined);
	const signature = signal<CommitSignatureShape | undefined>(undefined);

	// ── Derived State ──

	const canNavigateBack = computed(() => navigationStack.get().canBack);

	const canNavigateForward = computed(() => navigationStack.get().canForward);

	const isUncommitted = computed(() => {
		const commit = currentCommit.get();
		return commit?.sha === '0000000000000000000000000000000000000000';
	});

	return {
		// Infrastructure
		loading: loading,
		error: error,

		// Persisted UI State
		pinned: pinned,
		commitRef: commitRef,

		// Ephemeral UI State
		navigationStack: navigationStack,

		// Domain Data
		currentCommit: currentCommit,
		searchContext: searchContext,
		preferences: preferences,
		orgSettings: orgSettings,
		hasAccount: hasAccount,
		capabilities: capabilities,

		// Repository context
		hasRemotes: hasRemotes,

		// Enrichment
		autolinks: autolinks,
		formattedMessage: formattedMessage,
		autolinkedIssues: autolinkedIssues,
		pullRequest: pullRequest,
		signature: signature,

		// Derived State (read-only)
		canNavigateBack: canNavigateBack,
		canNavigateForward: canNavigateForward,
		isUncommitted: isUncommitted,

		// Lifecycle
		resetAll: resetAll,
		startAutoPersist: startAutoPersist,
		dispose: dispose,
	};
}

/** Commit Details state type — the return value of `createCommitDetailsState()`. */
export type CommitDetailsState = ReturnType<typeof createCommitDetailsState>;
