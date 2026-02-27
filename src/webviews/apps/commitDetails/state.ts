/**
 * Signal-based state management for the Commit Details webview.
 *
 * State is instance-owned: the root component creates a `CommitDetailsState` via
 * `createCommitDetailsState()` and passes it to actions/events as a parameter.
 * No module-level singletons.
 *
 * State Categories:
 * 1. Persisted (survive hide/show/refresh) — mode, pinned, commitRef
 * 2. Ephemeral UI — navigationStack, inReview, draftState
 * 3. Domain Data — currentCommit, wipState, preferences, enrichment signals
 * 4. Remote Bridges — orgSettings, hasAccount (connected to host signals post-RPC)
 * 5. Resource-owned (NOT in state) — loading, reachability, explain, generate
 * 6. Derived — computed from above (canNavigateBack, wipStatus, etc.)
 *
 * Signals removed from state (now resource-owned in commitDetails.ts):
 * - loadingCommit → commitResource.loading
 * - loadingWip → wipResource.loading
 * - reachabilityState → reachabilityResource.status
 * - reachability → reachabilityResource.value
 * - explainState → explainResource.value
 * - generateState → generateResource.value
 */
import { computed } from '@lit-labs/signals';
import { signalObject } from 'signal-utils/object';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { Autolink } from '../../../autolinks/models/autolinks.js';
import type { Draft } from '../../../plus/drafts/models/drafts.js';
import type {
	CommitDetails,
	CommitSignatureShape,
	DraftState,
	Mode,
	Preferences,
	Wip,
} from '../../commitDetails/protocol.js';
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

export interface GenerateState {
	title?: string;
	description?: string;
	error?: { message: string };
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

	const mode = persisted<Mode>('mode', 'commit');
	const pinned = persisted('pinned', false);
	/** Persisted commit reference for reload recovery (replaces manual persistState). */
	const commitRef = persisted<{ sha: string; repoPath: string } | undefined>('commitRef', undefined);

	// ── Ephemeral UI State ──

	const navigationStack = signal<{ count: number; position: number; hint?: string }>({
		count: 0,
		position: 0,
	});
	const inReview = signal(false);
	const draftState = signal<DraftState>({ inReview: false });

	// ── Domain Data ──

	/** Current commit details — set by actions after resource fetch. */
	const currentCommit = signal<CommitDetails | undefined>(undefined);
	const searchContext = signal<GitCommitSearchContext | undefined>(undefined);
	/** Current WIP state — set by actions after resource fetch. */
	const wipState = signal<Wip | undefined>(undefined);
	const preferences = signal<Preferences | undefined>(undefined);

	/** Organization settings — connected to remote signal once RPC connects. Single `.get()`. */
	const orgSettings = createRemoteSignalBridge({ ai: false, drafts: false });

	/** Whether the user has a GitKraken account — connected to remote signal once RPC connects. Single `.get()`. */
	const hasAccount = createRemoteSignalBridge(false);

	const capabilities = signalObject({
		hasIntegrationsConnected: false,
		autolinksEnabled: false,
		experimentalComposerEnabled: false,
	});

	// ── Enrichment (fire-and-forget, not resources) ──

	const autolinks = signal<Autolink[] | undefined>(undefined);
	const formattedMessage = signal<string | undefined>(undefined);
	const autolinkedIssues = signal<IssueOrPullRequest[] | undefined>(undefined);
	const pullRequest = signal<PullRequestShape | undefined>(undefined);
	const signature = signal<CommitSignatureShape | undefined>(undefined);
	const codeSuggestions = signal<Omit<Draft, 'changesets'>[] | undefined>(undefined);

	// ── Derived State ──

	const canNavigateBack = computed(() => {
		const nav = navigationStack.get();
		return nav.position > 0;
	});

	const canNavigateForward = computed(() => {
		const nav = navigationStack.get();
		return nav.position < nav.count - 1;
	});

	const isUncommitted = computed(() => {
		const commit = currentCommit.get();
		return commit?.sha === '0000000000000000000000000000000000000000';
	});

	const isStash = computed(() => {
		const commit = currentCommit.get();
		return commit?.stashNumber != null;
	});

	const wipStatus = computed(() => {
		const wip = wipState.get();
		if (wip == null) return undefined;

		const branch = wip.branch;
		if (branch == null) return undefined;

		const changes = wip.changes;
		const working = changes?.files.length ?? 0;
		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;
		const status =
			behind > 0 && ahead > 0
				? 'both'
				: behind > 0
					? 'behind'
					: ahead > 0
						? 'ahead'
						: working > 0
							? 'working'
							: undefined;

		const branchName = wip.repositoryCount > 1 ? `${wip.repo.name}:${branch.name}` : branch.name;

		return {
			branch: branchName,
			upstream: branch.upstream?.name,
			ahead: ahead,
			behind: behind,
			working: wip.changes?.files.length ?? 0,
			status: status,
		};
	});

	return {
		// Infrastructure
		loading: loading,
		error: error,

		// Persisted UI State
		mode: mode,
		pinned: pinned,
		commitRef: commitRef,

		// Ephemeral UI State
		navigationStack: navigationStack,
		inReview: inReview,
		draftState: draftState,

		// Domain Data
		currentCommit: currentCommit,
		searchContext: searchContext,
		wipState: wipState,
		preferences: preferences,
		orgSettings: orgSettings,
		hasAccount: hasAccount,
		capabilities: capabilities,

		// Enrichment
		autolinks: autolinks,
		formattedMessage: formattedMessage,
		autolinkedIssues: autolinkedIssues,
		pullRequest: pullRequest,
		signature: signature,
		codeSuggestions: codeSuggestions,

		// Derived State (read-only)
		canNavigateBack: canNavigateBack,
		canNavigateForward: canNavigateForward,
		isUncommitted: isUncommitted,
		isStash: isStash,
		wipStatus: wipStatus,

		// Lifecycle
		resetAll: resetAll,
		startAutoPersist: startAutoPersist,
		dispose: dispose,
	};
}

/** Commit Details state type — the return value of `createCommitDetailsState()`. */
export type CommitDetailsState = ReturnType<typeof createCommitDetailsState>;
