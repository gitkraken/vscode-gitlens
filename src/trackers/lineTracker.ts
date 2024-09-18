import type { Event, Selection, TextEditor, TextEditorSelectionChangeEvent } from 'vscode';
import { Disposable, EventEmitter, window } from 'vscode';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { debug } from '../system/decorators/log';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { getLogScope, setLogScopeExit } from '../system/logger.scope';
import { isTrackableTextEditor } from '../system/vscode/utils';
import type {
	DocumentBlameStateChangeEvent,
	DocumentContentChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentTracker,
} from './documentTracker';

export interface LinesChangeEvent {
	readonly editor: TextEditor | undefined;
	readonly selections: LineSelection[] | undefined;

	readonly reason: 'editor' | 'selection';
	readonly pending?: boolean;
	readonly suspended?: boolean;
}

export interface LineSelection {
	anchor: number;
	active: number;
}

export interface LineState {
	commit: GitCommit;
}

export class LineTracker {
	private _onDidChangeActiveLines = new EventEmitter<LinesChangeEvent>();
	get onDidChangeActiveLines(): Event<LinesChangeEvent> {
		return this._onDidChangeActiveLines.event;
	}

	protected _disposable: Disposable | undefined;
	private _editor: TextEditor | undefined;
	private readonly _state = new Map<number, LineState | undefined>();
	private _subscriptions = new Map<unknown, Disposable[]>();
	private _subscriptionOnlyWhenTracking: Disposable | undefined;

	constructor(
		private readonly container: Container,
		private readonly documentTracker: GitDocumentTracker,
	) {}

	dispose() {
		for (const subscriber of this._subscriptions.keys()) {
			this.unsubscribe(subscriber);
		}
	}

	private onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor === this._editor) return;
		if (editor != null && !isTrackableTextEditor(editor)) return;

		this._editor = editor;
		this._selections = toLineSelections(editor?.selections);

		if (this._suspended) {
			this.resume({ force: true });
		} else {
			this.notifyLinesChanged('editor');
		}
	}

	@debug<LineTracker['onBlameStateChanged']>({
		args: {
			0: e => `editor/doc=${e.editor?.document.uri.toString(true)}, blameable=${e.blameable}`,
		},
	})
	private onBlameStateChanged(_e: DocumentBlameStateChangeEvent) {
		this.notifyLinesChanged('editor');
	}

	@debug<LineTracker['onContentChanged']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}`,
		},
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
			this.notifyLinesChanged('editor');
		}
	}

	@debug<LineTracker['onDirtyIdleTriggered']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}`,
		},
	})
	private onDirtyIdleTriggered(_e: DocumentDirtyIdleTriggerEvent) {
		this.resume();
	}

	@debug<LineTracker['onDirtyStateChanged']>({
		args: {
			0: e => `editor/doc=${e.editor.document.uri.toString(true)}, dirty=${e.dirty}`,
		},
	})
	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent) {
		if (e.dirty) {
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

		this._editor = e.textEditor;
		this._selections = selections;

		this.notifyLinesChanged(this._editor === e.textEditor ? 'selection' : 'editor');
	}

	private _selections: LineSelection[] | undefined;
	get selections(): LineSelection[] | undefined {
		return this._selections;
	}

	private _suspended = false;
	get suspended() {
		return this._suspended;
	}

	getState(line: number): LineState | undefined {
		return this._state.get(line);
	}

	resetState(line?: number) {
		if (line != null) {
			this._state.delete(line);
			return;
		}

		this._state.clear();
	}

	setState(line: number, state: LineState | undefined) {
		this._state.set(line, state);
	}

	includes(selections: LineSelection[]): boolean;
	includes(line: number, options?: { activeOnly: boolean }): boolean;
	includes(lineOrSelections: number | LineSelection[], options?: { activeOnly: boolean }): boolean {
		if (typeof lineOrSelections !== 'number') {
			return isIncluded(lineOrSelections, this._selections);
		}

		if (this._selections == null || this._selections.length === 0) return false;

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

	refresh() {
		this.notifyLinesChanged('editor');
	}

	@debug()
	resume(options?: { force?: boolean; silent?: boolean }) {
		if (!options?.force && !this._suspended) return;

		this._suspended = false;
		this._subscriptionOnlyWhenTracking ??= this.documentTracker.onDidChangeContent(this.onContentChanged, this);

		if (!options?.silent) {
			this.notifyLinesChanged('editor');
		}
	}

	@debug()
	suspend(options?: { force?: boolean; silent?: boolean }) {
		if (!options?.force && this._suspended) return;

		this._suspended = true;
		this._subscriptionOnlyWhenTracking?.dispose();
		this._subscriptionOnlyWhenTracking = undefined;

		if (!options?.silent) {
			this.notifyLinesChanged('editor');
		}
	}

	subscribed(subscriber: unknown) {
		return this._subscriptions.has(subscriber);
	}

	@debug({ args: false, singleLine: true })
	subscribe(subscriber: unknown, subscription: Disposable): Disposable {
		const scope = getLogScope();

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
			setLogScopeExit(scope, ' \u2022 starting line tracker...');

			this.resume({ force: true, silent: true });

			this._disposable = Disposable.from(
				{ dispose: () => this.suspend({ force: true, silent: true }) },
				window.onDidChangeActiveTextEditor(debounce(this.onActiveTextEditorChanged, 0), this),
				window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this),
				this.documentTracker.onDidChangeBlameState(this.onBlameStateChanged, this),
				this.documentTracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
				this.documentTracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
			);

			queueMicrotask(() => this.onActiveTextEditorChanged(window.activeTextEditor));
		} else {
			setLogScopeExit(scope, ' \u2022 already started...');
		}

		return disposable;
	}

	@debug({ args: false, singleLine: true })
	unsubscribe(subscriber: unknown) {
		const subs = this._subscriptions.get(subscriber);
		if (subs == null) return;

		this._subscriptions.delete(subscriber);
		for (const sub of subs) {
			sub.dispose();
		}

		if (this._subscriptions.size !== 0) return;

		this._fireLinesChangedDebounced?.cancel();
		this._disposable?.dispose();
		this._disposable = undefined;
	}

	private async fireLinesChanged(e: LinesChangeEvent) {
		let updated = false;
		if (!this.suspended && !e.pending && e.selections != null && e.editor != null) {
			updated = await this.updateState(e.selections, e.editor);
		}

		this._onDidChangeActiveLines.fire(updated ? e : { ...e, selections: undefined, suspended: this.suspended });
	}

	private _fireLinesChangedDebounced: Deferrable<(e: LinesChangeEvent) => void> | undefined;
	private notifyLinesChanged(reason: 'editor' | 'selection') {
		if (reason === 'editor') {
			this.resetState();
		}

		const e: LinesChangeEvent = { editor: this._editor, selections: this.selections, reason: reason };
		if (e.selections == null) {
			queueMicrotask(() => {
				if (e.editor !== window.activeTextEditor) return;

				this._fireLinesChangedDebounced?.cancel();

				void this.fireLinesChanged(e);
			});

			return;
		}

		if (this._fireLinesChangedDebounced == null) {
			this._fireLinesChangedDebounced = debounce((e: LinesChangeEvent) => {
				if (e.editor !== window.activeTextEditor) return;

				// Make sure we are still on the same lines
				if (!isIncluded(e.selections, toLineSelections(e.editor?.selections))) {
					return;
				}

				void this.fireLinesChanged(e);
			}, 250);
		}

		// If we have no pending moves, then fire an immediate pending event, and defer the real event
		if (!this._fireLinesChangedDebounced.pending()) {
			void this.fireLinesChanged({ ...e, pending: true });
		}

		this._fireLinesChangedDebounced(e);
	}

	@debug<LineTracker['updateState']>({
		args: { 0: selections => selections?.map(s => s.active).join(','), 1: e => e.document.uri.toString(true) },
		exit: true,
	})
	private async updateState(selections: LineSelection[], editor: TextEditor): Promise<boolean> {
		const scope = getLogScope();

		if (!this.includes(selections)) {
			setLogScopeExit(scope, ` \u2022 lines no longer match`);

			return false;
		}

		const document = await this.documentTracker.getOrAdd(editor.document);
		let status = await document.getStatus();
		if (!status.blameable) {
			setLogScopeExit(scope, ` \u2022 document is not blameable`);

			return false;
		}

		if (selections.length === 1) {
			const blameLine = await this.container.git.getBlameForLine(
				document.uri,
				selections[0].active,
				editor?.document,
			);
			if (blameLine == null) {
				setLogScopeExit(scope, ` \u2022 blame failed`);

				return false;
			}

			if (blameLine.commit != null && blameLine.commit.file == null) {
				debugger;
			}

			this.setState(blameLine.line.line - 1, { commit: blameLine.commit });
		} else {
			const blame = await this.container.git.getBlame(document.uri, editor.document);
			if (blame == null) {
				setLogScopeExit(scope, ` \u2022 blame failed`);

				return false;
			}

			for (const selection of selections) {
				const commitLine = blame.lines[selection.active];
				const commit = blame.commits.get(commitLine.sha);
				if (commit != null && commit.file == null) {
					debugger;
				}

				if (commit == null) {
					debugger;
					this.resetState(selection.active);
				} else {
					this.setState(selection.active, { commit: commit });
				}
			}
		}

		// Check again because of the awaits above

		if (!this.includes(selections)) {
			setLogScopeExit(scope, ` \u2022 lines no longer match`);

			return false;
		}

		status = await document.getStatus();

		if (!status.blameable) {
			setLogScopeExit(scope, ` \u2022 document is not blameable`);

			return false;
		}

		if (editor.document.isDirty) {
			document.setForceDirtyStateChangeOnNextDocumentChange();
		}

		return true;
	}
}

function isIncluded(selections: LineSelection[] | undefined, within: LineSelection[] | undefined): boolean {
	if (selections == null && within == null) return true;
	if (selections == null || within == null || selections.length !== within.length) return false;

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
