import type { Uri } from 'vscode';
import type { GitReference } from '@gitlens/git/models/reference.js';
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
	};

	scope: TimelineScopeSerialized | undefined;
	repository: (RepositoryShape & { ref: GitReference | undefined }) | undefined;
	repositories: { count: number; openCount: number };

	access: FeatureAccess;
}

export interface TimelineDatum {
	sha: string;
	author: string;
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
	/** Display config from VS Code settings (date formats, sha length). */
	displayConfig: {
		abbreviatedShaLength: number;
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
