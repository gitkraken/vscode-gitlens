import { computed } from '@lit-labs/signals';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { FeatureAccess } from '../../../../features.js';
import type { RepositoryShape } from '../../../../git/models/repositoryShape.js';
import type { TimelinePeriod, TimelineScopeSerialized, TimelineSliceBy } from '../../../plus/timeline/protocol.js';
import type { HostStorage } from '../../shared/host/storage.js';
import { createStateGroup } from '../../shared/state/signals.js';

export interface TimelineHostDisplayConfig {
	abbreviatedShaLength: number;
	dateFormat: string;
	shortDateFormat: string;
}

const defaultDisplayConfig: TimelineHostDisplayConfig = {
	abbreviatedShaLength: 7,
	dateFormat: '',
	shortDateFormat: '',
};

/**
 * Creates a new Timeline state instance with all signals initialized to defaults.
 * Called by the root component; the returned object is passed to actions as a parameter.
 *
 * @param storage - Optional host storage for persisting UI state.
 */
export function createTimelineState(storage?: HostStorage) {
	const { signal, persisted, resetAll, startAutoPersist, dispose } = createStateGroup({
		storage: storage,
		version: 1,
	});

	const period = persisted<TimelinePeriod>('period', '1|Y');
	const showAllBranches = persisted('showAllBranches', false);
	const sliceBy = persisted<TimelineSliceBy>('sliceBy', 'author');
	const scope = persisted<TimelineScopeSerialized | undefined>('scope', undefined);

	/** Host-pushed display config (date format, abbreviated SHA length). */
	const displayConfig = signal<TimelineHostDisplayConfig>(defaultDisplayConfig);
	const repository = signal<(RepositoryShape & { ref: GitReference | undefined }) | undefined>(undefined);
	const repositories = signal<{ count: number; openCount: number }>({ count: 0, openCount: 0 });
	const access = signal<FeatureAccess | undefined>(undefined);

	// ── Infrastructure ──

	/** RPC connection error (distinct from dataset resource fetch errors). */
	const error = signal<string | undefined>(undefined);

	// ── Derived helpers ──

	const allowed = computed<boolean | 'mixed'>(() => {
		return access.get()?.allowed ?? true;
	});

	const head = computed(() => {
		return scope.get()?.head ?? repository.get()?.ref;
	});

	const base = computed(() => {
		return scope.get()?.base ?? repository.get()?.ref;
	});

	const isShowAllBranchesSupported = computed(() => {
		return !repository.get()?.virtual;
	});

	const isSliceBySupported = computed(() => {
		const r = repository.get();
		const s = scope.get();
		return !r?.virtual && (s?.type === 'file' || s?.type === 'folder');
	});

	const effectiveSliceBy = computed<TimelineSliceBy>(() => {
		return isSliceBySupported.get() && showAllBranches.get() ? sliceBy.get() : 'author';
	});

	return {
		// Persisted
		period: period,
		showAllBranches: showAllBranches,
		sliceBy: sliceBy,
		scope: scope,

		// Ephemeral
		displayConfig: displayConfig,
		repository: repository,
		repositories: repositories,
		access: access,

		// Infrastructure
		error: error,

		// Derived (read-only)
		allowed: allowed,
		head: head,
		base: base,
		isShowAllBranchesSupported: isShowAllBranchesSupported,
		isSliceBySupported: isSliceBySupported,
		effectiveSliceBy: effectiveSliceBy,

		// Lifecycle
		resetAll: resetAll,
		startAutoPersist: startAutoPersist,
		dispose: dispose,
	};
}

/** Timeline state type — the return value of `createTimelineState()`. */
export type TimelineState = ReturnType<typeof createTimelineState>;
