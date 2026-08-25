/**
 * Standalone Rebase Editor RPC service.
 *
 * Carries the host operations of the Interactive Rebase Editor — todo-plan mutations
 * (entry action changes, moves, shifts), rebase lifecycle (start/continue/skip/abort),
 * conflict resolution affordances, enrichment lookups, and the AI handoff requests — plus
 * the four save-last events that stream state to the webview. The methods delegate verbatim
 * to the provider's handlers (the provider owns the todo document and all git context); this
 * class owns the transport: save-last buffering keyed off webview visibility.
 */

import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { Serialized } from '../../system/serialize.js';
import type {
	Author,
	ChangeEntriesParams,
	ChangeEntryParams,
	Commit,
	GetConflictsParams,
	GetMissingAvatarsParams,
	GetMissingCommitsParams,
	MoveEntriesParams,
	MoveEntryParams,
	OpenConflictChangesParams,
	OpenConflictFileParams,
	ReorderParams,
	ResolveAllConflictsParams,
	ResolveConflictParams,
	RevealRefParams,
	ShiftEntriesParams,
	StageConflictParams,
	State,
	UpdateSelectionParams,
} from '../rebase/protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEvent } from './eventVisibilityBuffer.js';
import type { SharedWebviewServices } from './services/common.js';
import type { RpcEventSubscription } from './services/types.js';

/** Complete state snapshot — replaces the legacy full-state notification. */
export type RebaseStateChangedEvent = Serialized<State>;

export interface RebaseAvatarsChangedEvent {
	/** Map of author name → avatar URL */
	avatars: Record<string, string>;
}

export interface RebaseCommitsChangedEvent {
	/** Map of commit SHA → enriched commit data */
	commits: Record<string, Commit>;
	/** Map of author name → author info (for new authors from fetched commits) */
	authors: Record<string, Author>;
	/** True if the commits are already on top of onto (recalculated when commits are enriched) */
	isInPlace?: boolean;
}

export interface RebaseSubscriptionChangedEvent {
	subscription: Subscription;
}

/**
 * The provider-side implementations the service delegates to. Kept as a bag of functions so the
 * provider's handler methods can stay private.
 */
export interface RebaseRpcHandlers {
	abort(): Promise<void>;
	continue(): Promise<void>;
	continueWithAi(): Promise<void>;
	search(): void;
	skip(): Promise<void>;
	start(): Promise<void>;
	startWithAi(): Promise<boolean>;
	switchToText(): Promise<void>;
	swapOrdering(params: ReorderParams): Promise<void>;
	changeEntry(params: ChangeEntryParams): Promise<void>;
	changeEntries(params: ChangeEntriesParams): Promise<void>;
	moveEntry(params: MoveEntryParams): Promise<void>;
	moveEntries(params: MoveEntriesParams): Promise<void>;
	shiftEntries(params: ShiftEntriesParams): Promise<void>;
	updateSelection(params: UpdateSelectionParams): void;
	revealRef(params: RevealRefParams): Promise<void>;
	getMissingAvatars(params: GetMissingAvatarsParams): Promise<void>;
	getMissingCommits(params: GetMissingCommitsParams): Promise<void>;
	getConflicts(params: GetConflictsParams): Promise<ConflictDetectionResult | undefined>;
	getState(): Promise<Serialized<State>>;
	recompose(): Promise<void>;
	dismissCloseWarning(): void;
	openConflictFile(params: OpenConflictFileParams): Promise<void>;
	openConflictChanges(params: OpenConflictChangesParams): Promise<void>;
	resolveConflict(params: ResolveConflictParams): Promise<void>;
	stageConflict(params: StageConflictParams): Promise<void>;
	resolveAllConflicts(params: ResolveAllConflictsParams): Promise<void>;
	resolveConflictsInGraph(): Promise<void>;
}

/**
 * The RPC-facing surface of {@link RebaseService} — the shape the Rebase Editor webview composes
 * into its services interface.
 */
export interface RebaseViewService {
	/** Fired with a complete state snapshot (todo edits, rebase progress, config changes). */
	readonly onStateChanged: RpcEventSubscription<RebaseStateChangedEvent>;
	/** Fired when enhanced avatars have been fetched for the requested authors. */
	readonly onAvatarsChanged: RpcEventSubscription<RebaseAvatarsChangedEvent>;
	/** Fired with enriched commit data for the requested SHAs. */
	readonly onCommitsChanged: RpcEventSubscription<RebaseCommitsChangedEvent>;
	/** Fired when the subscription changes (can unlock Pro-gated data like conflict detection). */
	readonly onSubscriptionChanged: RpcEventSubscription<RebaseSubscriptionChangedEvent>;

	/** Aborts the paused rebase and closes the editor. */
	abort(): Promise<void>;
	/** Continues the paused rebase. */
	continue(): Promise<void>;
	/** Continues the paused rebase with automatic (AI) conflict resolution. */
	continueWithAi(): Promise<void>;
	/** Opens the webview's find widget. */
	search(): Promise<void>;
	/** Skips the currently paused commit. */
	skip(): Promise<void>;
	/** Starts the planned rebase and closes the editor. */
	start(): Promise<void>;
	/** Hands the pending rebase off to automatic (AI) conflict resolution. Always answers. */
	startWithAi(): Promise<boolean>;
	/** Reopens the todo file in the default text editor. */
	switchToText(): Promise<void>;
	/** Toggles the todo ordering (ascending/descending). */
	swapOrdering(params: ReorderParams): Promise<void>;
	/** Changes the action of a single entry. */
	changeEntry(params: ChangeEntryParams): Promise<void>;
	/** Changes the actions of multiple entries in one edit. */
	changeEntries(params: ChangeEntriesParams): Promise<void>;
	/** Moves a single entry to an absolute position. */
	moveEntry(params: MoveEntryParams): Promise<void>;
	/** Moves multiple entries (preserving relative order) to an absolute position. */
	moveEntries(params: MoveEntriesParams): Promise<void>;
	/** Shifts entries up/down independently, preserving gaps between non-contiguous selections. */
	shiftEntries(params: ShiftEntriesParams): Promise<void>;
	/** Reports the primary selected commit (drives auto-reveal behavior). */
	updateSelection(params: UpdateSelectionParams): Promise<void>;
	/** Reveals a branch or commit in the configured location. */
	revealRef(params: RevealRefParams): Promise<void>;
	/** Fetches enhanced avatars for the requested emails; results arrive via {@link onAvatarsChanged}. */
	getMissingAvatars(params: GetMissingAvatarsParams): Promise<void>;
	/** Fetches enriched commit data for the requested SHAs; results arrive via {@link onCommitsChanged}. */
	getMissingCommits(params: GetMissingCommitsParams): Promise<void>;
	/** Checks the plan for potential conflicts (Pro feature). */
	getConflicts(params: GetConflictsParams): Promise<ConflictDetectionResult | undefined>;
	/** Serves the webview's initial-state query (the standard-bootstrap replacement for deferred bootstrap). */
	getState(): Promise<Serialized<State>>;
	/** Aborts the rebase and opens the Commit Graph composer with the original commits. */
	recompose(): Promise<void>;
	/** Dismisses the close-warning banner. */
	dismissCloseWarning(): Promise<void>;
	/** Opens a conflicted file. */
	openConflictFile(params: OpenConflictFileParams): Promise<void>;
	/** Opens the two-sided comparison for one side of a conflicted file. */
	openConflictChanges(params: OpenConflictChangesParams): Promise<void>;
	/** Resolves a single conflict by staging the chosen side. */
	resolveConflict(params: ResolveConflictParams): Promise<void>;
	/** Stages a conflicted file, confirming when unresolved markers remain. */
	stageConflict(params: StageConflictParams): Promise<void>;
	/** Resolves every conflicted file by staging the chosen side, after confirmation. */
	resolveAllConflicts(params: ResolveAllConflictsParams): Promise<void>;
	/** Opens the AI conflict-resolution flow in the Commit Graph. */
	resolveConflictsInGraph(): Promise<void>;
}

/** RPC services for the Rebase Editor webview. */
export interface RebaseServices extends SharedWebviewServices {
	readonly rebase: RebaseViewService;
}

export class RebaseService implements RebaseViewService {
	readonly #handlers: RebaseRpcHandlers;

	readonly onStateChanged: RpcEventSubscription<RebaseStateChangedEvent>;

	readonly onAvatarsChanged: RpcEventSubscription<RebaseAvatarsChangedEvent>;

	readonly onCommitsChanged: RpcEventSubscription<RebaseCommitsChangedEvent>;

	readonly onSubscriptionChanged: RpcEventSubscription<RebaseSubscriptionChangedEvent>;

	readonly #didStateChanged = createRpcEvent<RebaseStateChangedEvent>('stateChanged', 'save-last');
	readonly #didAvatarsChanged = createRpcEvent<RebaseAvatarsChangedEvent>('avatarsChanged', 'save-last');
	readonly #didCommitsChanged = createRpcEvent<RebaseCommitsChangedEvent>('commitsChanged', 'save-last');
	readonly #didSubscriptionChanged = createRpcEvent<RebaseSubscriptionChangedEvent>(
		'subscriptionChanged',
		'save-last',
	);

	constructor(handlers: RebaseRpcHandlers, buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker) {
		this.#handlers = handlers;

		this.onStateChanged = this.#didStateChanged.subscribe(buffer, tracker);
		this.onAvatarsChanged = this.#didAvatarsChanged.subscribe(buffer, tracker);
		this.onCommitsChanged = this.#didCommitsChanged.subscribe(buffer, tracker);
		this.onSubscriptionChanged = this.#didSubscriptionChanged.subscribe(buffer, tracker);
	}

	fireStateChanged(state: RebaseStateChangedEvent): void {
		this.#didStateChanged.fire(state);
	}

	fireAvatarsChanged(event: RebaseAvatarsChangedEvent): void {
		this.#didAvatarsChanged.fire(event);
	}

	fireCommitsChanged(event: RebaseCommitsChangedEvent): void {
		this.#didCommitsChanged.fire(event);
	}

	fireSubscriptionChanged(event: RebaseSubscriptionChangedEvent): void {
		this.#didSubscriptionChanged.fire(event);
	}

	async abort(): Promise<void> {
		await this.#handlers.abort();
	}

	async continue(): Promise<void> {
		await this.#handlers.continue();
	}

	async continueWithAi(): Promise<void> {
		await this.#handlers.continueWithAi();
	}

	search(): Promise<void> {
		this.#handlers.search();
		return Promise.resolve();
	}

	async skip(): Promise<void> {
		await this.#handlers.skip();
	}

	async start(): Promise<void> {
		await this.#handlers.start();
	}

	startWithAi(): Promise<boolean> {
		return this.#handlers.startWithAi();
	}

	switchToText(): Promise<void> {
		return this.#handlers.switchToText();
	}

	swapOrdering(params: ReorderParams): Promise<void> {
		return this.#handlers.swapOrdering(params);
	}

	changeEntry(params: ChangeEntryParams): Promise<void> {
		return this.#handlers.changeEntry(params);
	}

	changeEntries(params: ChangeEntriesParams): Promise<void> {
		return this.#handlers.changeEntries(params);
	}

	moveEntry(params: MoveEntryParams): Promise<void> {
		return this.#handlers.moveEntry(params);
	}

	moveEntries(params: MoveEntriesParams): Promise<void> {
		return this.#handlers.moveEntries(params);
	}

	shiftEntries(params: ShiftEntriesParams): Promise<void> {
		return this.#handlers.shiftEntries(params);
	}

	updateSelection(params: UpdateSelectionParams): Promise<void> {
		this.#handlers.updateSelection(params);
		return Promise.resolve();
	}

	revealRef(params: RevealRefParams): Promise<void> {
		return this.#handlers.revealRef(params);
	}

	getMissingAvatars(params: GetMissingAvatarsParams): Promise<void> {
		return this.#handlers.getMissingAvatars(params);
	}

	getMissingCommits(params: GetMissingCommitsParams): Promise<void> {
		return this.#handlers.getMissingCommits(params);
	}

	getConflicts(params: GetConflictsParams): Promise<ConflictDetectionResult | undefined> {
		return this.#handlers.getConflicts(params);
	}

	getState(): Promise<Serialized<State>> {
		return this.#handlers.getState();
	}

	recompose(): Promise<void> {
		return this.#handlers.recompose();
	}

	dismissCloseWarning(): Promise<void> {
		this.#handlers.dismissCloseWarning();
		return Promise.resolve();
	}

	openConflictFile(params: OpenConflictFileParams): Promise<void> {
		return this.#handlers.openConflictFile(params);
	}

	openConflictChanges(params: OpenConflictChangesParams): Promise<void> {
		return this.#handlers.openConflictChanges(params);
	}

	resolveConflict(params: ResolveConflictParams): Promise<void> {
		return this.#handlers.resolveConflict(params);
	}

	stageConflict(params: StageConflictParams): Promise<void> {
		return this.#handlers.stageConflict(params);
	}

	resolveAllConflicts(params: ResolveAllConflictsParams): Promise<void> {
		return this.#handlers.resolveAllConflicts(params);
	}

	resolveConflictsInGraph(): Promise<void> {
		return this.#handlers.resolveConflictsInGraph();
	}
}
