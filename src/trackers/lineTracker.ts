import type { Event, Selection, TextEditor, TextEditorSelectionChangeEvent } from 'vscode';
import { Disposable, EventEmitter, window } from 'vscode';
import { debug } from '../system/decorators/log';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { isTextEditor } from '../system/utils';

export interface LinesChangeEvent {
	readonly editor: TextEditor | undefined;
	readonly selections: LineSelection[] | undefined;

	readonly reason: 'editor' | 'selection';
	readonly pending?: boolean;
}

export interface LineSelection {
	anchor: number;
	active: number;
}

export class LineTracker<T> implements Disposable {
	private _onDidChangeActiveLines = new EventEmitter<LinesChangeEvent>();
	get onDidChangeActiveLines(): Event<LinesChangeEvent> {
		return this._onDidChangeActiveLines.event;
	}

	protected _disposable: Disposable | undefined;
	private _editor: TextEditor | undefined;
	private readonly _state = new Map<number, T | undefined>();

	dispose() {
		for (const subscriber of this._subscriptions.keys()) {
			this.unsubscribe(subscriber);
		}
	}

	private onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor === this._editor) return;
		if (editor != null && !isTextEditor(editor)) return;

		this._editor = editor;
		this._selections = toLineSelections(editor?.selections);

		this.notifyLinesChanged('editor');
	}

	private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
		// If this isn't for our cached editor and its not a real editor -- kick out
		if (this._editor !== e.textEditor && !isTextEditor(e.textEditor)) return;

		const selections = toLineSelections(e.selections);
		if (this._editor === e.textEditor && this.includes(selections)) return;

		this._editor = e.textEditor;
		this._selections = selections;

		this.notifyLinesChanged(this._editor === e.textEditor ? 'selection' : 'editor');
	}

	getState(line: number): T | undefined {
		return this._state.get(line);
	}

	resetState(line?: number) {
		if (line != null) {
			this._state.delete(line);
			return;
		}

		this._state.clear();
	}

	setState(line: number, state: T | undefined) {
		this._state.set(line, state);
	}

	private _selections: LineSelection[] | undefined;
	get selections(): LineSelection[] | undefined {
		return this._selections;
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

	private _subscriptions = new Map<unknown, Disposable[]>();

	subscribed(subscriber: unknown) {
		return this._subscriptions.has(subscriber);
	}

	protected onStart?(): Disposable | undefined;

	@debug({ args: false })
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
			Logger.debug(scope, 'Starting line tracker...');

			this._disposable = Disposable.from(
				window.onDidChangeActiveTextEditor(debounce(this.onActiveTextEditorChanged, 0), this),
				window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this),
				this.onStart?.() ?? { dispose: () => {} },
			);

			queueMicrotask(() => this.onActiveTextEditorChanged(window.activeTextEditor));
		}

		return disposable;
	}

	@debug({ args: false })
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

	private _suspended = false;
	get suspended() {
		return this._suspended;
	}

	protected onResume?(): void;

	@debug()
	resume(options?: { force?: boolean }) {
		if (!options?.force && !this._suspended) return;

		this._suspended = false;
		this.onResume?.();
		this.notifyLinesChanged('editor');
	}

	protected onSuspend?(): void;

	@debug()
	suspend(options?: { force?: boolean }) {
		if (!options?.force && this._suspended) return;

		this._suspended = true;
		this.onSuspend?.();
		this.notifyLinesChanged('editor');
	}

	protected fireLinesChanged(e: LinesChangeEvent) {
		this._onDidChangeActiveLines.fire(e);
	}

	private _fireLinesChangedDebounced: Deferrable<(e: LinesChangeEvent) => void> | undefined;
	protected notifyLinesChanged(reason: 'editor' | 'selection') {
		if (reason === 'editor') {
			this.resetState();
		}

		const e: LinesChangeEvent = { editor: this._editor, selections: this.selections, reason: reason };
		if (e.selections == null) {
			queueMicrotask(() => {
				if (e.editor !== window.activeTextEditor) return;

				this._fireLinesChangedDebounced?.cancel();

				this.fireLinesChanged(e);
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

				this.fireLinesChanged(e);
			}, 250);
		}

		// If we have no pending moves, then fire an immediate pending event, and defer the real event
		if (!this._fireLinesChangedDebounced.pending?.()) {
			this.fireLinesChanged({ ...e, pending: true });
		}

		this._fireLinesChangedDebounced(e);
	}
}

function isIncluded(selections: LineSelection[] | undefined, within: LineSelection[] | undefined): boolean {
	if (selections == null && within == null) return true;
	if (selections == null || within == null || selections.length !== within.length) return false;

	let match;
	return selections.every((s, i) => {
		match = within[i];
		return s.active === match.active && s.anchor === match.anchor;
	});
}

function toLineSelections(selections: readonly Selection[]): LineSelection[];
function toLineSelections(selections: readonly Selection[] | undefined): LineSelection[] | undefined;
function toLineSelections(selections: readonly Selection[] | undefined) {
	return selections?.map(s => ({ active: s.active.line, anchor: s.anchor.line }));
}
