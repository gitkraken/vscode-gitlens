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

		this.reset();
		this._editor = editor;
		this._selections = LineTracker.toLineSelections(editor?.selections);

		this.trigger('editor');
	}

	private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
		// If this isn't for our cached editor and its not a real editor -- kick out
		if (this._editor !== e.textEditor && !isTextEditor(e.textEditor)) return;

		const selections = LineTracker.toLineSelections(e.selections);
		if (this._editor === e.textEditor && this.includes(selections)) return;

		this.reset();
		this._editor = e.textEditor;
		this._selections = selections;

		this.trigger(this._editor === e.textEditor ? 'selection' : 'editor');
	}

	getState(line: number): T | undefined {
		return this._state.get(line);
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
			return LineTracker.includes(lineOrSelections, this._selections);
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
		this.trigger('editor');
	}

	reset() {
		this._state.clear();
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

		if (this._linesChangedDebounced != null) {
			this._linesChangedDebounced.cancel();
		}

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
		this.trigger('editor');
	}

	protected onSuspend?(): void;

	@debug()
	suspend(options?: { force?: boolean }) {
		if (!options?.force && this._suspended) return;

		this._suspended = true;
		this.onSuspend?.();
		this.trigger('editor');
	}

	protected fireLinesChanged(e: LinesChangeEvent) {
		this._onDidChangeActiveLines.fire(e);
	}

	protected trigger(reason: 'editor' | 'selection') {
		this.onLinesChanged({ editor: this._editor, selections: this.selections, reason: reason });
	}

	private _linesChangedDebounced: Deferrable<(e: LinesChangeEvent) => void> | undefined;

	private onLinesChanged(e: LinesChangeEvent) {
		if (e.selections == null) {
			queueMicrotask(() => {
				if (e.editor !== window.activeTextEditor) return;

				if (this._linesChangedDebounced != null) {
					this._linesChangedDebounced.cancel();
				}

				this.fireLinesChanged(e);
			});

			return;
		}

		if (this._linesChangedDebounced == null) {
			this._linesChangedDebounced = debounce(
				(e: LinesChangeEvent) => {
					if (e.editor !== window.activeTextEditor) return;
					// Make sure we are still on the same lines
					if (!LineTracker.includes(e.selections, LineTracker.toLineSelections(e.editor?.selections))) {
						return;
					}

					this.fireLinesChanged(e);
				},
				250,
				{ track: true },
			);
		}

		// If we have no pending moves, then fire an immediate pending event, and defer the real event
		if (!this._linesChangedDebounced.pending?.()) {
			this.fireLinesChanged({ ...e, pending: true });
		}

		this._linesChangedDebounced(e);
	}

	static includes(selections: LineSelection[] | undefined, inSelections: LineSelection[] | undefined): boolean {
		if (selections == null && inSelections == null) return true;
		if (selections == null || inSelections == null || selections.length !== inSelections.length) return false;

		let match;

		return selections.every((s, i) => {
			match = inSelections[i];
			return s.active === match.active && s.anchor === match.anchor;
		});
	}

	static toLineSelections(selections: readonly Selection[]): LineSelection[];
	static toLineSelections(selections: readonly Selection[] | undefined): LineSelection[] | undefined;
	static toLineSelections(selections: readonly Selection[] | undefined) {
		return selections?.map(s => ({ active: s.active.line, anchor: s.anchor.line }));
	}
}
