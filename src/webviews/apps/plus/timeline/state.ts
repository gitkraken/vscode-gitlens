import { computed } from '@lit-labs/signals';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { CurrentUserNameStyle } from '@gitlens/git/utils/commit.utils.js';
import type { FeatureAccess } from '../../../../features.js';
import type { RepositoryShape } from '../../../../git/models/repositoryShape.js';
import type { TimelinePeriod, TimelineScopeSerialized, TimelineSliceBy } from '../../../plus/timeline/protocol.js';
import type { HostStorage } from '../../shared/host/storage.js';
import { createStateGroup } from '../../shared/state/signals.js';

export interface TimelineHostDisplayConfig {
	abbreviatedShaLength: number;
	dateFormat: string;
	shortDateFormat: string;
	currentUserNameStyle: CurrentUserNameStyle;
}

const defaultDisplayConfig: TimelineHostDisplayConfig = {
	abbreviatedShaLength: 7,
	dateFormat: '',
	shortDateFormat: '',
	currentUserNameStyle: 'nameAndYou',
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

	const period = persisted<TimelinePeriod>('period', '1|M');
	const showAllBranches = persisted('showAllBranches', false);
	const sliceBy = persisted<TimelineSliceBy>('sliceBy', 'author');
	const scope = persisted<TimelineScopeSerialized | undefined>('scope', undefined);

	/** Host-pushed display config (date format, abbreviated SHA length). */
	const displayConfig = signal<TimelineHostDisplayConfig>(defaultDisplayConfig);
	const repository = signal<(RepositoryShape & { ref: GitReference | undefined }) | undefined>(undefined);
	const repositories = signal<{ count: number; openCount: number }>({ count: 0, openCount: 0 });
	const access = signal<FeatureAccess | undefined>(undefined);
	/** True when the workspace has both public and private repos — drives the gate's "Switch Repos"
	 *  affordance. Set from the dataset result; only surfaced by the gate while it's shown. */
	const allowRepoSwitch = signal<boolean>(false);

	/** Currently-loaded history span (ms) for the dataset. `null` means "use period-derived
	 *  span" (initial state and after period change). When the chart fires `gl-load-more`
	 *  (user zoomed past the loaded oldest), we bump this by `period * extensionChunkRatio`
	 *  and re-fetch, so older history pages in without re-loading what's already on screen. */
	const loadedSpanMs = signal<number | null>(null);
	/** Actual visible-time-range span (ms) reported by the chart's `gl-visible-range-changed`
	 *  event. Drives the header pill's label so it shows the live span (through zoom/pan)
	 *  instead of the static period setting. `undefined` until the chart emits the first range. */
	const visibleSpanMs = signal<number | undefined>(undefined);
	/** True while an extension fetch is in flight. Drives the chart's edge-gradient affordance
	 *  (no full-canvas spinner) so existing rows stay interactive during paging. */
	const loadingMore = signal<boolean>(false);
	/** False once an extension fetch returned the same number of rows as before — we've reached
	 *  the start of history for this scope. Resets to `true` on scope/period change. */
	const hasMore = signal<boolean>(true);

	/** RPC connection error (distinct from dataset resource fetch errors). */
	const error = signal<string | undefined>(undefined);

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
		allowRepoSwitch: allowRepoSwitch,
		loadedSpanMs: loadedSpanMs,
		visibleSpanMs: visibleSpanMs,
		loadingMore: loadingMore,
		hasMore: hasMore,

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
