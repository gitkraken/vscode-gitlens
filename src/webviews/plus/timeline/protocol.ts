import type { Uri } from 'vscode';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { CurrentUserNameStyle } from '@gitlens/git/utils/commit.utils.js';
import type { FeatureAccess } from '../../../features.js';
import type { RepositoryShape } from '../../../git/models/repositoryShape.js';
import type { Serialized } from '../../../system/serialize.js';
import type { IpcScope } from '../../ipc/models/ipc.js';
import { IpcNotification } from '../../ipc/models/ipc.js';
import type { WebviewState } from '../../protocol.js';
import type { SharedWebviewServices } from '../../rpc/services/common.js';
import type { Unsubscribe } from '../../rpc/services/types.js';

export const scope: IpcScope = 'timeline';

export interface State extends WebviewState<'gitlens.timeline' | 'gitlens.views.timeline'> {
	dataset?: Promise<TimelineDatum[]>;
	config: {
		showAllBranches: boolean;
		period: TimelinePeriod;
		sliceBy: TimelineSliceBy;

		abbreviatedShaLength: number;
		dateFormat: string;
		shortDateFormat: string;
		currentUserNameStyle: CurrentUserNameStyle;
	};

	scope: TimelineScopeSerialized | undefined;
	repository: (RepositoryShape & { ref: GitReference | undefined }) | undefined;
	repositories: { count: number; openCount: number };

	access: FeatureAccess;
}

export interface TimelineDatum {
	sha: string;
	/** Raw author name (no "(you)" suffix). The webview applies `formatIdentityDisplayName` with
	 * the current user style at render time so the rail/tooltip text honor the user's setting,
	 * while initials and avatar lookup keep using the unmodified name. */
	author: string;
	/** True when this commit's author is the current Git user. Combined with the raw `author`
	 * name, the webview formats display strings with `formatIdentityDisplayName`. */
	current?: boolean;
	/** Author email — used by the rail to render a gravatar. Optional because synthetic / squashed
	 * commits surfaced from non-git sources may not carry one. */
	email?: string;
	/** Pre-resolved gravatar (or remote provider) avatar URL, computed by the host. The webview
	 * has no facility to compute it from email alone, so the host does the work. */
	avatarUrl?: string;
	date: string;
	message: string;

	branches?: string[];

	files: number | undefined;
	additions: number | undefined;
	deletions: number | undefined;

	sort: number;
}

export interface TimelineScope {
	type: TimelineScopeType;
	uri: Uri;
	head?: GitReference;
	base?: GitReference;
}
export type TimelineScopeSerialized = Serialized<TimelineScope> & { relativePath: string };

export type TimelineScopeType = 'file' | 'folder' | 'repo';
export type TimelinePeriod = `${number}|${'D' | 'M' | 'Y'}` | 'all';
export type TimelineSliceBy = 'author' | 'branch';

export type ChooseRefParams = { scope: State['scope']; type: 'base' | 'head'; showAllBranches?: boolean };
export type DidChooseRefParams =
	| { type: 'base' | 'head'; ref: GitReference | /** All Branches */ null | undefined }
	| undefined;

export interface ChoosePathParams {
	repoUri: string;
	ref: GitReference | undefined;
	title: string;
	initialPath?: string;
}
export interface DidChoosePathParams {
	picked?: { type: 'file' | 'folder'; relativePath: string };
}

export interface SelectDataPointParams {
	scope: State['scope'];
	id: string | undefined;
	shift: boolean;
}

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange');

/** Config the webview sends to the host when fetching data. */
export interface TimelineConfig {
	period: TimelinePeriod;
	showAllBranches: boolean;
	sliceBy: TimelineSliceBy;
	/**
	 * Additional branch names to include in the contributor walk when `showAllBranches` is false.
	 * Used by the embedded Graph timeline mode to mirror the Graph's `branchesVisibility` filter
	 * (smart / favorited / current → a small list of refs). The host loops `getContributors` per ref
	 * and dedupes commits by sha. Ignored when `showAllBranches` is true (the `--all` walk covers
	 * everything).
	 */
	additionalBranches?: string[];
	/**
	 * When set, the host uses `since: now - loadedSpanMs` as the contributor walk cutoff INSTEAD
	 * of the `period`-derived `since`. Used by the standalone Visual History for progressive
	 * loading: initial fetch covers the period (windowSpanMs), and the chart's `gl-load-more`
	 * event extends the span on demand as the user pans into older history. The embedded Graph
	 * timeline builds its dataset from `graphState.rows` directly and never calls `getDataset`,
	 * so it doesn't set this.
	 */
	loadedSpanMs?: number;
}

/** Scope change event from host (tab change, file selection). */
export interface ScopeChangedEvent {
	uri: string;
	type: TimelineScopeType;
}

/** Initial context returned by the host. */
export interface TimelineInitialContext {
	scope: TimelineScopeSerialized | undefined;
	/** Config overrides from command args (if any). Webview merges with its persisted config. */
	configOverrides?: Partial<TimelineConfig>;
	/** Display config from VS Code settings (date formats, sha length, current-user style). */
	displayConfig: {
		abbreviatedShaLength: number;
		currentUserNameStyle: CurrentUserNameStyle;
		dateFormat: string;
		shortDateFormat: string;
	};
}

/** Result of getDataset — includes chart data plus metadata needed for rendering. */
export interface TimelineDatasetResult {
	dataset: TimelineDatum[];
	/** Enriched scope (with relativePath, head, base resolved by the host). */
	scope: TimelineScopeSerialized;
	/** Repository info for the scope (for breadcrumbs, button group, virtual flag). */
	repository: (RepositoryShape & { ref: GitReference | undefined }) | undefined;
	/** Feature access for the scope's repo. */
	access: FeatureAccess;
	/** True when the workspace has both public and private repos, so a gated (private) scope can offer
	 *  switching to a public repo. Independent of `access.allowed` — the gate only surfaces it when shown. */
	allowRepoSwitch?: boolean;
}

/** View-specific service for Timeline operations. */
export interface TimelineViewService {
	// --- Lifecycle ---
	/** Get the initial scope (from command args or active tab). */
	getInitialContext(): Promise<TimelineInitialContext>;

	// --- View-specific data ---
	/** Get timeline chart data + metadata. Side-effect: starts file system watching on the repo. */
	getDataset(
		scope: TimelineScopeSerialized,
		config: TimelineConfig,
		signal?: AbortSignal,
	): Promise<TimelineDatasetResult>;
	/**
	 * Get just the working-tree (WIP) pseudo-commit row(s) for a scope. Cheap focused fetch
	 * driven by working-tree change events — lets the webview patch the dataset's leading WIP
	 * row in place instead of re-running the full `getDataset` (which re-walks contributors and
	 * runs the per-commit branch-discovery loop on every file save).
	 */
	getWip(scope: TimelineScopeSerialized, signal?: AbortSignal): Promise<TimelineDatum[]>;

	// --- View-specific event (host-driven, requires VS Code API) ---
	/** Fires when the active tab or selected file changes. */
	onScopeChanged(callback: (event: ScopeChangedEvent | undefined) => void): Unsubscribe;

	// --- User actions (require VS Code API) ---
	/** Open a commit diff for a chart data point. Fire-and-forget. */
	selectDataPoint(params: SelectDataPointParams): void;
	/** Show reference picker, return selected ref. */
	chooseRef(params: ChooseRefParams): Promise<DidChooseRefParams>;
	/** Show file/folder picker, return selected path. */
	choosePath(params: ChoosePathParams): Promise<DidChoosePathParams>;
	/** Show repository picker, return selected repo scope. */
	chooseRepo(): Promise<ScopeChangedEvent | undefined>;
	/** Open the given scope in an editor panel (from sidebar view). */
	openInEditor(scope: TimelineScopeSerialized): void;
}

/** RPC services for the Timeline webview. */
export interface TimelineServices extends SharedWebviewServices {
	readonly timeline: TimelineViewService;
}
