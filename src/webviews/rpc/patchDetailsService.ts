/**
 * Standalone Patch Details RPC service.
 *
 * Carries the host operations of the Cloud Patch Details surface — applying and creating cloud
 * patches, draft metadata/permissions/collaborators, file opens and comparisons, AI
 * explain/generate — plus the five save-last events that stream state to the webview. The methods
 * delegate verbatim to the provider's handlers (the provider owns all draft/create context);
 * this class owns the transport: event buffering and the `AbortSignal` boundary for the AI calls.
 */

import type { Serialized } from '../../system/serialize.js';
import type {
	ApplyPatchParams,
	ArchiveDraftParams,
	CreatePatchParams,
	DidExplainParams,
	DidGenerateParams,
	DraftPatchCheckedParams,
	ExecuteFileActionParams,
	Mode,
	OpenInCommitGraphParams,
	PatchDetails,
	Preferences,
	State,
	SwitchModeParams,
	UpdateCreatePatchMetadataParams,
	UpdateCreatePatchRepositoryCheckedStateParams,
	UpdatePatchDetailsMetadataParams,
	UpdatePatchUserSelection,
	UpdatePreferenceParams,
} from '../plus/patchDetails/protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEvent } from './eventVisibilityBuffer.js';
import type { SharedWebviewServices } from './services/common.js';
import type { RpcEventSubscription } from './services/types.js';

/** Complete state snapshot — replaces the legacy reset-flagged full-state push. */
export type PatchDetailsStateChangedEvent = Serialized<State>;

export interface PatchDetailsCreateChangedEvent {
	mode: Mode;
	create: Serialized<State>['create'];
}

export interface PatchDetailsDraftChangedEvent {
	mode: Mode;
	draft: Serialized<State>['draft'];
}

export interface PatchDetailsPreferencesChangedEvent {
	preferences: Preferences;
}

export interface PatchDetailsPatchRepositoryChangedEvent {
	patch: PatchDetails;
}

/**
 * The provider-side implementations the service delegates to. Kept as a bag of functions so the
 * provider's handler methods can stay private.
 */
export interface PatchDetailsRpcHandlers {
	applyPatch(params: ApplyPatchParams): void;
	archiveDraft(params: ArchiveDraftParams): Promise<void>;
	createDraft(params: CreatePatchParams): Promise<void>;
	openInCommitGraph(params: OpenInCommitGraphParams): void;
	patchChecked(params: DraftPatchCheckedParams): void;
	openFile(params: ExecuteFileActionParams): Promise<void>;
	openFileComparisonWithWorking(params: ExecuteFileActionParams): Promise<void>;
	openFileComparisonWithPrevious(params: ExecuteFileActionParams): Promise<void>;
	switchMode(params: SwitchModeParams): void;
	copyCloudLink(): void;
	updateCreateCheckedState(params: UpdateCreatePatchRepositoryCheckedStateParams): void;
	updateCreateMetadata(params: UpdateCreatePatchMetadataParams): void;
	updateDraftMetadata(params: UpdatePatchDetailsMetadataParams): void;
	updateDraftPermissions(): Promise<void>;
	inviteUsers(): Promise<void>;
	updateUserSelection(params: UpdatePatchUserSelection): void;
	updatePreferences(params: UpdatePreferenceParams): void;
	getState(): Promise<PatchDetailsStateChangedEvent>;
	explain(signal?: AbortSignal): Promise<DidExplainParams>;
	generate(signal?: AbortSignal): Promise<DidGenerateParams>;
}

/**
 * The RPC-facing surface of {@link PatchDetailsService} — the shape the Patch Details webview
 * composes into its services interface.
 */
export interface PatchDetailsViewService {
	/** Fired with a complete state snapshot (mode switch, preferences/org-settings changes, refresh). */
	readonly onStateChanged: RpcEventSubscription<PatchDetailsStateChangedEvent>;
	/** Fired when the create-patch form state changes (checked repos, metadata, collaborators, WIP changes). */
	readonly onCreateChanged: RpcEventSubscription<PatchDetailsCreateChangedEvent>;
	/** Fired when the viewed draft changes; may arrive without patch contents (a richer snapshot follows). */
	readonly onDraftChanged: RpcEventSubscription<PatchDetailsDraftChangedEvent>;
	/** Fired when the webview-relevant configuration preferences change. */
	readonly onPreferencesChanged: RpcEventSubscription<PatchDetailsPreferencesChangedEvent>;
	/** Fired when a patch's repository gets located, so its files become actionable. */
	readonly onPatchRepositoryChanged: RpcEventSubscription<PatchDetailsPatchRepositoryChangedEvent>;

	/** Applies the selected patches of the viewed draft onto the current branch or a chosen branch. */
	applyPatch(params: ApplyPatchParams): Promise<void>;
	/** Archives (or accepts/rejects) the viewed cloud draft. */
	archiveDraft(params: ArchiveDraftParams): Promise<void>;
	/** Creates a cloud patch from the create form's checked changesets. */
	createDraft(params: CreatePatchParams): Promise<void>;
	/** Opens the given ref of the given repo in the Commit Graph. */
	openInCommitGraph(params: OpenInCommitGraphParams): Promise<void>;
	/** Prompts to locate a patch's repository when it is checked in the file tree. */
	patchChecked(params: DraftPatchCheckedParams): Promise<void>;
	/** Opens the working-tree file of a patch change. */
	openFile(params: ExecuteFileActionParams): Promise<void>;
	/** Opens the comparison of a patch change with the working tree. */
	openFileComparisonWithWorking(params: ExecuteFileActionParams): Promise<void>;
	/** Opens the comparison of a patch change with its previous revision. */
	openFileComparisonWithPrevious(params: ExecuteFileActionParams): Promise<void>;
	/** Switches between create and view modes. */
	switchMode(params: SwitchModeParams): Promise<void>;
	/** Copies the viewed draft's deep link to the clipboard. */
	copyCloudLink(): Promise<void>;
	/** Sets the checked state of one repository in the create form. */
	updateCreateCheckedState(params: UpdateCreatePatchRepositoryCheckedStateParams): Promise<void>;
	/** Sets title/description/visibility of the create form. */
	updateCreateMetadata(params: UpdateCreatePatchMetadataParams): Promise<void>;
	/** Sets the pending visibility of the viewed draft. */
	updateDraftMetadata(params: UpdatePatchDetailsMetadataParams): Promise<void>;
	/** Persists the pending visibility and collaborator changes of the viewed draft. */
	updateDraftPermissions(): Promise<void>;
	/** Opens the organization members picker to select collaborators. */
	inviteUsers(): Promise<void>;
	/** Applies one collaborator role change (or removal) to the pending selections. */
	updateUserSelection(params: UpdatePatchUserSelection): Promise<void>;
	/** Persists the files-list preferences changed from the webview. */
	updatePreferences(params: UpdatePreferenceParams): Promise<void>;
	/** Returns the current complete state snapshot — the subscribe-then-query seed so a
	 *  remounted webview converges even if its bootstrap attribute is stale. */
	getState(): Promise<PatchDetailsStateChangedEvent>;
	/** Explains the viewed draft's changes with AI; aborted when the webview supersedes or cancels. */
	explain(signal?: AbortSignal): Promise<DidExplainParams>;
	/** Generates title/description for the create form with AI; abortable like {@link explain}. */
	generate(signal?: AbortSignal): Promise<DidGenerateParams>;
}

/** RPC services for the Patch Details webview. */
export interface PatchDetailsServices extends SharedWebviewServices {
	readonly patchDetails: PatchDetailsViewService;
}

export class PatchDetailsService implements PatchDetailsViewService {
	readonly #handlers: PatchDetailsRpcHandlers;

	readonly onStateChanged: RpcEventSubscription<PatchDetailsStateChangedEvent>;

	readonly onCreateChanged: RpcEventSubscription<PatchDetailsCreateChangedEvent>;

	readonly onDraftChanged: RpcEventSubscription<PatchDetailsDraftChangedEvent>;

	readonly onPreferencesChanged: RpcEventSubscription<PatchDetailsPreferencesChangedEvent>;

	readonly onPatchRepositoryChanged: RpcEventSubscription<PatchDetailsPatchRepositoryChangedEvent>;

	readonly #didStateChanged = createRpcEvent<PatchDetailsStateChangedEvent>('stateChanged', 'save-last');
	readonly #didCreateChanged = createRpcEvent<PatchDetailsCreateChangedEvent>('createChanged', 'save-last');
	readonly #didDraftChanged = createRpcEvent<PatchDetailsDraftChangedEvent>('draftChanged', 'save-last');
	readonly #didPreferencesChanged = createRpcEvent<PatchDetailsPreferencesChangedEvent>(
		'preferencesChanged',
		'save-last',
	);
	readonly #didPatchRepositoryChanged = createRpcEvent<PatchDetailsPatchRepositoryChangedEvent>(
		'patchRepositoryChanged',
		'save-last',
	);

	constructor(handlers: PatchDetailsRpcHandlers, buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker) {
		this.#handlers = handlers;

		this.onStateChanged = this.#didStateChanged.subscribe(buffer, tracker);
		this.onCreateChanged = this.#didCreateChanged.subscribe(buffer, tracker);
		this.onDraftChanged = this.#didDraftChanged.subscribe(buffer, tracker);
		this.onPreferencesChanged = this.#didPreferencesChanged.subscribe(buffer, tracker);
		this.onPatchRepositoryChanged = this.#didPatchRepositoryChanged.subscribe(buffer, tracker);
	}

	fireStateChanged(state: PatchDetailsStateChangedEvent): void {
		this.#didStateChanged.fire(state);
	}

	fireCreateChanged(event: PatchDetailsCreateChangedEvent): void {
		this.#didCreateChanged.fire(event);
	}

	fireDraftChanged(event: PatchDetailsDraftChangedEvent): void {
		this.#didDraftChanged.fire(event);
	}

	firePreferencesChanged(event: PatchDetailsPreferencesChangedEvent): void {
		this.#didPreferencesChanged.fire(event);
	}

	firePatchRepositoryChanged(event: PatchDetailsPatchRepositoryChangedEvent): void {
		this.#didPatchRepositoryChanged.fire(event);
	}

	applyPatch(params: ApplyPatchParams): Promise<void> {
		this.#handlers.applyPatch(params);
		return Promise.resolve();
	}

	async archiveDraft(params: ArchiveDraftParams): Promise<void> {
		await this.#handlers.archiveDraft(params);
	}

	async createDraft(params: CreatePatchParams): Promise<void> {
		await this.#handlers.createDraft(params);
	}

	openInCommitGraph(params: OpenInCommitGraphParams): Promise<void> {
		this.#handlers.openInCommitGraph(params);
		return Promise.resolve();
	}

	patchChecked(params: DraftPatchCheckedParams): Promise<void> {
		this.#handlers.patchChecked(params);
		return Promise.resolve();
	}

	async openFile(params: ExecuteFileActionParams): Promise<void> {
		await this.#handlers.openFile(params);
	}

	async openFileComparisonWithWorking(params: ExecuteFileActionParams): Promise<void> {
		await this.#handlers.openFileComparisonWithWorking(params);
	}

	async openFileComparisonWithPrevious(params: ExecuteFileActionParams): Promise<void> {
		await this.#handlers.openFileComparisonWithPrevious(params);
	}

	switchMode(params: SwitchModeParams): Promise<void> {
		this.#handlers.switchMode(params);
		return Promise.resolve();
	}

	copyCloudLink(): Promise<void> {
		this.#handlers.copyCloudLink();
		return Promise.resolve();
	}

	updateCreateCheckedState(params: UpdateCreatePatchRepositoryCheckedStateParams): Promise<void> {
		this.#handlers.updateCreateCheckedState(params);
		return Promise.resolve();
	}

	updateCreateMetadata(params: UpdateCreatePatchMetadataParams): Promise<void> {
		this.#handlers.updateCreateMetadata(params);
		return Promise.resolve();
	}

	updateDraftMetadata(params: UpdatePatchDetailsMetadataParams): Promise<void> {
		this.#handlers.updateDraftMetadata(params);
		return Promise.resolve();
	}

	async updateDraftPermissions(): Promise<void> {
		await this.#handlers.updateDraftPermissions();
	}

	async inviteUsers(): Promise<void> {
		await this.#handlers.inviteUsers();
	}

	updateUserSelection(params: UpdatePatchUserSelection): Promise<void> {
		this.#handlers.updateUserSelection(params);
		return Promise.resolve();
	}

	updatePreferences(params: UpdatePreferenceParams): Promise<void> {
		this.#handlers.updatePreferences(params);
		return Promise.resolve();
	}

	getState(): Promise<PatchDetailsStateChangedEvent> {
		return this.#handlers.getState();
	}

	async explain(signal?: AbortSignal): Promise<DidExplainParams> {
		return this.#handlers.explain(signal);
	}

	async generate(signal?: AbortSignal): Promise<DidGenerateParams> {
		return this.#handlers.generate(signal);
	}
}
