import type { Event, Selection, TextEditor, TextEditorSelectionChangeEvent } from 'vscode';
import { Disposable, EventEmitter, window, workspace } from 'vscode';
import type { GitCommit, GitCommitLine } from '@gitlens/git/models/commit.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../container.js';
import { isTrackableTextEditor } from '../system/-webview/vscode/editors.js';
import type {
	DocumentBlameStateChangeEvent,
	DocumentContentChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentTracker,
} from './documentTracker.js';

export interface LinesChangeEvent {
	readonly editor: TextEditor | undefined;
	readonly selections: LineSelection[] | undefined;

	readonly reason: 'editor' | 'selection';
	readonly pending?: boolean;
	readonly suspended?: boolean;
	/** True when the current line is being actively edited — consumers should clear decorations */
	readonly editing?: boolean;
}

export interface LineSelection {
	anchor: number;
	active: number;
}

export interface LineState {
	commit: GitCommit;
	/** The blame line for this editor line — use this for originalLine/previousSha instead of commit.lines.find() */
	commitLine?: GitCommitLine;
}

export class LineTracker {
	private _onDidChangeActiveLines = new EventEmitter<LinesChangeEvent>();
	get onDidChangeActiveLines(): Event<LinesChangeEvent> {
		return this._onDidChangeActiveLines.event;
	}

	protected _disposable: Disposable | undefined;
	private _editor: TextEditor | undefined;
	private _isEditing = false;
	private _selectionsVersion = 0;
	private readonly _state = new Map<number, LineState | undefined>();
	private _subscriptions = new Map<unknown, Disposable[]>();
	private _subscriptionOnlyWhenTracking: Disposable | undefined;

	constructor(
		private readonly container: Container,
		private readonly documentTracker: GitDocumentTracker,
	) {}

	dispose(): void {
		this._onDidChangeActiveLines.dispose();
		for (const subscriber of this._subscriptions.keys()) {
			this.unsubscribe(subscriber);
		}
	}

	private onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor === this._editor) return;
		if (editor != null && !isTrackableTextEditor(editor)) return;

		this._editor = editor;
		this._selections = toLineSelections(editor?.selections);
		this._selectionsVersion++;

		// Clear cached blame state from the previous editor — it's no longer relevant
		this._state.clear();

		if (this._suspended) {
			this.resume({ force: true });
		} else {
			this.notifyLinesChanged('editor');
		}
	}

	@trace({
		args: e => ({
			e: `editor/doc=${e.editor?.document.uri.toString(true)}, blameable=${e.blameable}`,
		}),
	})
	private onBlameStateChanged(_e: DocumentBlameStateChangeEvent) {
		this.notifyLinesChanged('editor');
	}

	@trace({
		args: e => ({
			e: `editor/doc=${e.editor.document.uri.toString(true)}`,
		}),
	})
	private onContentChanged(e: DocumentContentChangeEvent) {
		if (
			this.selections?.length &&
			e.contentChanges.some(c =>
				this.selections!.some(
					selection =>
						(c.range.end.line >= selection.active && selection.active >= c.range.start.line) ||
						(c.range.start.line >= selection.active && selection.active >= c.range.end.line),
				),
			)
		) {
			// Mark as actively editing — the annotation controller checks this
			// flag and suppresses inline decorations while set.
			this._isEditing = true;
		}

		// Still trigger the blame update so the cache stays warm (Tier 3 is
		// cheap). The annotation controller checks isEditing and suppresses
		// decorations while that flag is set. A vertical cursor move clears the
		// flag and the next update will show the annotation.
		this.notifyLinesChanged('editor');
	}

	@trace({
		args: e => ({
			e: `editor/doc=${e.editor.document.uri.toString(true)}`,
		}),
	})
	private onDirtyIdleTriggered(_e: DocumentDirtyIdleTriggerEvent) {
		this.resume();
	}

	@trace({
		args: e => ({
			e: `editor/doc=${e.editor.document.uri.toString(true)}, dirty=${e.dirty}`,
		}),
	})
	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent) {
		if (e.dirty) {
			// Don't suspend if we have in-memory dirty blame — no git process needed,
			// so we can keep updating blame on every content change instantly.
			if (e.document.blameSnapshot != null) {
				this.notifyLinesChanged('editor');
				return;
			}
			this.suspend();
		} else {
			this.resume({ force: true });
		}
	}

	private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
		// If this isn't for our cached editor and its not a real editor -- kick out
		if (this._editor !== e.textEditor && !isTrackableTextEditor(e.textEditor)) return;

		const selections = toLineSelections(e.selections);
		if (this._editor === e.textEditor && this.includes(selections)) return;

		// Clear editing state when the cursor moves to a different line
		if (this._isEditing) {
			this._isEditing = false;
		}

		this._editor = e.textEditor;
		this._selections = selections;
		this._selectionsVersion++;

		this.notifyLinesChanged('selection');
	}

	private _selections: LineSelection[] | undefined;
	get selections(): LineSelection[] | undefined {
		return this._selections;
	}

	get selectionsVersion(): number {
		return this._selectionsVersion;
	}

	/** True when the user is actively editing the current line (suppress inline annotations) */
	get isEditing(): boolean {
		return this._isEditing;
	}

	private _suspended = false;
	get suspended(): boolean {
		return this._suspended;
	}

	getState(line: number): LineState | undefined {
		return this._state.get(line);
	}

	resetState(line?: number): void {
		if (line != null) {
			this._state.delete(line);
			return;
		}

		this._state.clear();
	}

	setState(line: number, state: LineState | undefined): void {
		this._state.set(line, state);
	}

	includes(selections: LineSelection[]): boolean;
	includes(line: number, options?: { activeOnly: boolean }): boolean;
	includes(lineOrSelections: number | LineSelection[], options?: { activeOnly: boolean }): boolean {
		if (typeof lineOrSelections !== 'number') {
			return isIncluded(lineOrSelections, this._selections);
		}

		if (!this._selections?.length) return false;

		const line = lineOrSelections;
		const activeOnly = options?.activeOnly ?? true;

		for (const selection of this._selections) {
			if (
				line === selection.active ||
				(!activeOnly &&
					((selection.anchor >= line && line >= selection.active) ||
						(selection.active >= line && line >= selection.anchor)))
			) {
				return true;
			}
		}
		return false;
	}

	refresh(): void {
		this.notifyLinesChanged('editor');
	}

	@trace()
	resume(options?: { force?: boolean; silent?: boolean }): void {
		if (!options?.force && !this._suspended) return;

		this._suspended = false;
		this._subscriptionOnlyWhenTracking ??= this.documentTracker.onDidChangeContent(this.onContentChanged, this);

		if (!options?.silent) {
			this.notifyLinesChanged('editor');
		}
	}

	@trace()
	suspend(options?: { force?: boolean; silent?: boolean }): void {
		if (!options?.force && this._suspended) return;

		this._suspended = true;
		this._subscriptionOnlyWhenTracking?.dispose();
		this._subscriptionOnlyWhenTracking = undefined;

		if (!options?.silent) {
			this.notifyLinesChanged('editor');
		}
	}

	subscribed(subscriber: unknown): boolean {
		return this._subscriptions.has(subscriber);
	}

	@trace({ args: false, onlyExit: true })
	subscribe(subscriber: unknown, subscription: Disposable): Disposable {
		const scope = getScopedLogger();

		const disposable = {
			dispose: () => this.unsubscribe(subscriber),
		};

		const first = this._subscriptions.size === 0;

		let subs = this._subscriptions.get(subscriber);
		if (subs == null) {
			subs = [subscription];
			this._subscriptions.set(subscriber, subs);
		} else {
			subs.push(subscription);
		}

		if (first) {
			scope?.addExitInfo('starting line tracker...');

			this.resume({ force: true, silent: true });

			this._disposable = Disposable.from(
				{ dispose: () => this.suspend({ force: true, silent: true }) },
				window.onDidChangeActiveTextEditor(debounce(this.onActiveTextEditorChanged, 0), this),
				window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this),
				// Direct (non-debounced) listener for immediate editing detection.
				// The documentTracker debounces content changes at 50ms, which means
				// _isEditing is never set while typing continuously. This listener
				// fires synchronously on every keystroke to clear annotations instantly.
				workspace.onDidChangeTextDocument(e => {
					if (e.document !== this._editor?.document) return;
					if (e.contentChanges.length === 0) return;
					if (
						this.selections?.some(s =>
							e.contentChanges.some(c => s.active >= c.range.start.line && s.active <= c.range.end.line),
						)
					) {
						this._isEditing = true;
						this._onDidChangeActiveLines.fire({
							editor: this._editor,
							selections: this.selections,
							reason: 'editor',
							editing: true,
						});
					}
				}),
				this.documentTracker.onDidChangeBlameState(this.onBlameStateChanged, this),
				this.documentTracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
				this.documentTracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
			);

			queueMicrotask(() => this.onActiveTextEditorChanged(window.activeTextEditor));
		} else {
			scope?.addExitInfo('already started...');
		}

		return disposable;
	}

	@trace({ args: false, onlyExit: true })
	unsubscribe(subscriber: unknown): void {
		const subs = this._subscriptions.get(subscriber);
		if (subs == null) return;

		this._subscriptions.delete(subscriber);
		for (const sub of subs) {
			sub.dispose();
		}

		if (this._subscriptions.size !== 0) return;

		this._throttledUpdateQueued = undefined;
		this._throttledUpdateQueuedReason = undefined;
		this._throttledUpdateVersion = undefined;
		this._throttledUpdatePendingFired = undefined;
		this._disposable?.dispose();
		this._disposable = undefined;
	}

	private async fireLinesChanged(e: LinesChangeEvent, version: number) {
		let updated = false;
		if (!this.suspended && e.selections != null && e.editor != null) {
			try {
				updated = await this.updateState(e.selections, e.editor, version);
			} catch {
				updated = false;
			}
		}

		// If the version changed while we were working, this result is stale.
		// Don't fire — a follow-up event for the new version is already queued.
		if (!updated && version !== this._selectionsVersion) return;

		// Re-read _isEditing live — it may have changed during the async updateState
		// (e.g., user started typing while a cursor-move update was in flight)
		if (this._isEditing && !e.editing) {
			e = { ...e, editing: true };
		}

		this._onDidChangeActiveLines.fire(updated ? e : { ...e, selections: undefined, suspended: this.suspended });
	}

	// Throttle state: at most 1 running + 1 queued (like VS Code's @throttle).
	// First call starts immediately (no timer delay). Queued call reads live
	// state at execution time so it always uses the latest selections/version.
	private _throttledUpdate: Promise<void> | undefined;
	private _throttledUpdateQueued: boolean | undefined;
	private _throttledUpdateQueuedReason: 'editor' | 'selection' | undefined;
	private _throttledUpdateVersion: number | undefined;
	private _throttledUpdatePendingFired: boolean | undefined;

	private notifyLinesChanged(reason: 'editor' | 'selection') {
		const e: LinesChangeEvent = { editor: this._editor, selections: this.selections, reason: reason };
		if (e.selections == null) {
			queueMicrotask(() => {
				if (e.editor !== window.activeTextEditor) return;

				// Cancel any queued throttled update — null selections take priority
				this._throttledUpdateQueued = undefined;

				void this.fireLinesChanged(e, this._selectionsVersion);
			});

			return;
		}

		// Throttle: if an update is already running, queue this one (coalescing).
		// The queued update will read live state when it executes.
		if (this._throttledUpdate != null) {
			// Fire pending only when the cursor actually moved (version changed) so
			// consumers can clear stale line-specific visuals. Skip for same-cursor
			// refreshes (e.g. blame/dirty state changes on save) to avoid an
			// unnecessary decoration-clearing flash. Fire at most once per cycle.
			if (!this._throttledUpdatePendingFired && this._selectionsVersion !== this._throttledUpdateVersion) {
				this._onDidChangeActiveLines.fire({ ...e, pending: true });
				this._throttledUpdatePendingFired = true;
			}
			this._throttledUpdateQueued = true;
			this._throttledUpdateQueuedReason =
				this._throttledUpdateQueuedReason === 'editor' || reason === 'editor' ? 'editor' : 'selection';
			return;
		}

		this.startThrottledUpdate(reason);
	}

	private startThrottledUpdate(reason: 'editor' | 'selection'): void {
		// Read live state at execution time (VS Code pattern) — ensures the
		// queued follow-up always uses the latest selections/version, not stale
		// values captured when the event first arrived.
		const version = this._selectionsVersion;
		this._throttledUpdateVersion = version;
		this._throttledUpdatePendingFired = false;
		const e: LinesChangeEvent = {
			editor: this._editor,
			selections: this.selections,
			reason: reason,
			editing: this._isEditing,
		};

		this._throttledUpdate = this.fireLinesChanged(e, version).finally(() => {
			this._throttledUpdate = undefined;

			if (this._throttledUpdateQueued) {
				this._throttledUpdateQueued = undefined;
				const queuedReason = this._throttledUpdateQueuedReason ?? 'selection';
				this._throttledUpdateQueuedReason = undefined;
				this.startThrottledUpdate(queuedReason);
			}
		});
	}

	@trace({
		args: (selections, editor) => ({ selections: selections?.map(s => s.active).join(','), editor: editor }),
		exit: true,
	})
	private async updateState(selections: LineSelection[], editor: TextEditor, version: number): Promise<boolean> {
		const scope = getScopedLogger();

		if (version !== this._selectionsVersion) {
			scope?.addExitInfo(`lines no longer match`);

			return false;
		}

		const document = await this.documentTracker.getOrAdd(editor.document);
		let status = await document.getStatus();
		if (!status.blameable) {
			scope?.addExitInfo(`document is not blameable`);

			return false;
		}

		if (selections.length === 1) {
			const blameLine = await this.container.git.getBlameForLine(
				document.uri,
				selections[0].active,
				editor?.document,
			);
			if (blameLine == null) {
				scope?.addExitInfo(`blame failed`);

				return false;
			}

			this.setState(blameLine.line.line - 1, { commit: blameLine.commit, commitLine: blameLine.line });
		} else {
			const blame = await this.container.git.getBlame(document.uri, editor.document);
			if (blame == null) {
				scope?.addExitInfo(`blame failed`);

				return false;
			}

			// Resolve uncommitted commit once for the whole cycle
			let uncommittedCommit: GitCommit | undefined;
			let uncommittedResolved = false;

			for (const selection of selections) {
				const commitLine = blame.lines[selection.active];
				if (commitLine == null) {
					this.resetState(selection.active);
					continue;
				}

				let commit = blame.commits.get(commitLine.sha);
				if (commit == null && commitLine.sha === uncommitted) {
					if (!uncommittedResolved) {
						const blameLine = await this.container.git.getBlameForLine(
							document.uri,
							selection.active,
							editor.document,
						);
						uncommittedCommit = blameLine?.commit;
						uncommittedResolved = true;
					}
					commit = uncommittedCommit;
				}

				if (commit == null) {
					this.resetState(selection.active);
					continue;
				}

				this.setState(selection.active, { commit: commit, commitLine: commitLine });
			}
		}

		// Check again because of the awaits above

		if (version !== this._selectionsVersion) {
			scope?.addExitInfo('stale selections (version changed)');
			return false;
		}

		status = await document.getStatus();

		if (!status.blameable) {
			scope?.addExitInfo(`document is not blameable`);
			return false;
		}

		if (editor.document.isDirty && document.blameSnapshot == null) {
			document.setForceDirtyStateChangeOnNextDocumentChange();
		}

		return true;
	}
}

function isIncluded(selections: LineSelection[] | undefined, within: LineSelection[] | undefined): boolean {
	if (selections == null && within == null) return true;
	if (selections == null || selections.length !== within?.length) return false;

	return selections.every((s, i) => {
		const match = within[i];
		return s.active === match.active && s.anchor === match.anchor;
	});
}

function toLineSelections(selections: readonly Selection[]): LineSelection[];
function toLineSelections(selections: readonly Selection[] | undefined): LineSelection[] | undefined;
function toLineSelections(selections: readonly Selection[] | undefined) {
	return selections?.map(s => ({ active: s.active.line, anchor: s.anchor.line }));
}
