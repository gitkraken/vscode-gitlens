import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css as cssLang } from '@codemirror/lang-css';
import { html as htmlLang } from '@codemirror/lang-html';
import { javascript as jsLang } from '@codemirror/lang-javascript';
import { json as jsonLang } from '@codemirror/lang-json';
import { markdown as mdLang } from '@codemirror/lang-markdown';
import { python as pyLang } from '@codemirror/lang-python';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	foldKeymap,
	indentOnInput,
	indentUnit,
	syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import type { Extension, Range } from '@codemirror/state';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { BlockInfo, DecorationSet } from '@codemirror/view';
import {
	Decoration,
	EditorView,
	gutter,
	GutterMarker,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
} from '@codemirror/view';
import type { PropertyValues } from 'lit';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type CmLanguage = 'plain' | 'javascript' | 'json' | 'markdown' | 'html' | 'css' | 'python' | 'yaml';

function languageExtensionFor(lang: CmLanguage): Extension {
	switch (lang) {
		case 'javascript':
			return jsLang({ typescript: true, jsx: true });
		case 'json':
			return jsonLang();
		case 'markdown':
			return mdLang();
		case 'html':
			return htmlLang();
		case 'css':
			return cssLang();
		case 'python':
			return pyLang();
		case 'yaml':
			return yamlLang();
		case 'plain':
		default:
			return [];
	}
}

/**
 * Map a file extension or basename to a supported CM6 language. Defaults to `plain` so unknown
 * file types still render correctly without syntax highlighting.
 */
export function detectLanguage(pathOrName: string): CmLanguage {
	const lower = pathOrName.toLowerCase();
	if (/\.(jsx?|tsx?|mjs|cjs)$/.test(lower)) return 'javascript';
	if (/\.json[5c]?$/.test(lower)) return 'json';
	if (/\.(md|markdown)$/.test(lower)) return 'markdown';
	if (/\.(html?|svelte|vue)$/.test(lower)) return 'html';
	if (/\.(css|scss|sass|less)$/.test(lower)) return 'css';
	if (/\.pyi?$/.test(lower)) return 'python';
	if (/\.ya?ml$/.test(lower)) return 'yaml';
	return 'plain';
}

const addLineDecorations = StateEffect.define<{ ranges: Range<Decoration>[] }>();
const clearLineDecorations = StateEffect.define();

const lineDecorationsField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update: function (decos, tr) {
		let next = decos.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(clearLineDecorations)) {
				next = Decoration.none;
			} else if (effect.is(addLineDecorations)) {
				next = next.update({ add: effect.value.ranges, sort: true });
			}
		}
		return next;
	},
	provide: f => EditorView.decorations.from(f),
});

export type GutterMarkerKind = 'available' | 'taken';

const setGutterMarkersEffect = StateEffect.define<Map<number, GutterMarkerKind>>();

const gutterMarkersField = StateField.define<Map<number, GutterMarkerKind>>({
	create: () => new Map(),
	update: function (value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setGutterMarkersEffect)) return effect.value;
		}
		return value;
	},
});

class TakeGutterMarker extends GutterMarker {
	constructor(
		public kind: GutterMarkerKind,
		private readonly lineNumber: number,
	) {
		super();
	}

	override eq(other: TakeGutterMarker): boolean {
		return this.kind === other.kind && this.lineNumber === other.lineNumber;
	}

	override toDOM(): HTMLElement {
		const el = document.createElement('button');
		el.type = 'button';
		el.className = `cm-take-marker cm-take-marker--${this.kind}`;
		el.dataset.line = String(this.lineNumber);
		el.setAttribute(
			'aria-label',
			this.kind === 'taken' ? `Don't take line ${this.lineNumber}` : `Take line ${this.lineNumber}`,
		);
		el.title = this.kind === 'taken' ? "Don't take this line" : 'Take this line';
		return el;
	}
}

const takeGutter = gutter({
	class: 'cm-take-gutter',
	lineMarker: function (view: EditorView, line: BlockInfo): TakeGutterMarker | null {
		const markers = view.state.field(gutterMarkersField, false);
		if (markers == null) return null;

		const lineNumber = view.state.doc.lineAt(line.from).number;
		const kind = markers.get(lineNumber);
		return kind != null ? new TakeGutterMarker(kind, lineNumber) : null;
	},
	// Without this predicate, CodeMirror only refreshes the gutter when the document changes —
	// our custom state field updates would be silently ignored and the checkbox wouldn't reflect
	// the new taken/available state until some other interaction forced a re-render.
	lineMarkerChange: update =>
		update.startState.field(gutterMarkersField, false) !== update.state.field(gutterMarkersField, false),
	domEventHandlers: {
		click: function (view: EditorView, line: BlockInfo, event: Event): boolean {
			const markers = view.state.field(gutterMarkersField, false);
			if (markers == null) return false;

			const lineNumber = view.state.doc.lineAt(line.from).number;
			if (!markers.has(lineNumber)) return false;

			view.dom.dispatchEvent(
				new CustomEvent('cm-gutter-take', {
					detail: { line: lineNumber },
					bubbles: true,
					composed: true,
				}),
			);
			// `event.preventDefault` only blocks CodeMirror's own handlers; our `onClick` listener
			// on view.dom is a separate addEventListener path. Stop propagation so the click
			// doesn't double-fire as a line-click.
			event.preventDefault();
			event.stopPropagation();
			return true;
		},
	},
});

const themeExt = EditorView.theme(
	{
		'&': {
			color: 'var(--vscode-editor-foreground)',
			backgroundColor: 'var(--vscode-editor-background)',
			height: '100%',
		},
		'.cm-content': {
			fontFamily: 'var(--vscode-editor-font-family, var(--vscode-font-family))',
			fontSize: 'var(--vscode-editor-font-size, var(--vscode-font-size))',
			caretColor: 'var(--vscode-editorCursor-foreground)',
		},
		'.cm-gutters': {
			backgroundColor: 'var(--vscode-editorGutter-background)',
			color: 'var(--vscode-editorLineNumber-foreground)',
			border: '0',
		},
		'.cm-activeLineGutter, .cm-activeLine': {
			backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)',
		},
		'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
			backgroundColor: 'var(--vscode-editor-selectionBackground)',
		},
		'.cm-cursor, .cm-dropCursor': {
			borderLeftColor: 'var(--vscode-editorCursor-foreground)',
		},
		'.cm-mergeConflict-current': {
			backgroundColor: 'var(--vscode-merge-currentContentBackground, rgba(64, 200, 174, 0.08))',
		},
		'.cm-mergeConflict-incoming': {
			backgroundColor: 'var(--vscode-merge-incomingContentBackground, rgba(64, 166, 255, 0.08))',
		},
		'.cm-mergeConflict-manual': {
			backgroundColor: 'var(--vscode-editorWarning-background, rgba(255, 184, 0, 0.10))',
			borderLeft: '2px solid var(--vscode-editorWarning-foreground, rgba(255, 184, 0, 0.7))',
			paddingLeft: '2px',
		},
		'.cm-mergeConflict-focused': {
			outline: '1px solid var(--vscode-focusBorder)',
			outlineOffset: '-1px',
		},
		'.cm-take-gutter': {
			width: '20px',
			borderRight: '1px solid var(--vscode-editorWidget-border)',
		},
		'.cm-take-marker': {
			width: '16px',
			height: '16px',
			margin: '2px',
			padding: '0',
			border: '1px solid var(--vscode-checkbox-border, var(--vscode-editorWidget-border))',
			borderRadius: '3px',
			background: 'var(--vscode-checkbox-background, transparent)',
			color: 'var(--vscode-checkbox-foreground, inherit)',
			cursor: 'pointer',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			fontSize: '11px',
			lineHeight: '1',
		},
		'.cm-take-marker:hover': {
			background: 'var(--vscode-toolbar-hoverBackground)',
			borderColor: 'var(--vscode-focusBorder)',
		},
		'.cm-take-marker--available::before': {
			content: '""',
		},
		'.cm-take-marker--available:hover::before': {
			content: '"+"',
			color: 'var(--vscode-gitDecoration-addedResourceForeground, #4caf50)',
			fontWeight: '700',
		},
		'.cm-take-marker--taken': {
			background: 'var(--vscode-gitDecoration-addedResourceForeground, #4caf50)',
			borderColor: 'var(--vscode-gitDecoration-addedResourceForeground, #4caf50)',
			color: 'var(--vscode-editor-background, white)',
		},
		'.cm-take-marker--taken::before': {
			content: '"✓"',
			fontWeight: '700',
		},
		'.cm-take-marker--taken:hover': {
			background: 'var(--vscode-gitDecoration-deletedResourceForeground, #f44336)',
			borderColor: 'var(--vscode-gitDecoration-deletedResourceForeground, #f44336)',
		},
		'.cm-take-marker--taken:hover::before': {
			content: '"−"',
		},
	},
	{ dark: false },
);

@customElement('gl-cm-editor')
export class GlCmEditor extends LitElement {
	@property({ attribute: false }) value = '';
	@property({ type: Boolean }) readOnly = false;
	@property({ type: String }) language: CmLanguage = 'plain';
	@property({ type: Boolean, attribute: 'show-line-numbers' }) showLineNumbers = true;
	/** Map of 1-based line numbers → CSS class name applied to that line via decoration. */
	@property({ attribute: false }) lineDecorations: ReadonlyMap<number, string> | undefined;
	/** Map of 1-based line numbers → take-marker kind. Lines absent from the map get no marker. */
	@property({ attribute: false }) gutterMarkers: ReadonlyMap<number, GutterMarkerKind> | undefined;

	private _view: EditorView | undefined;
	private readonly _languageCompartment = new Compartment();
	private readonly _readOnlyCompartment = new Compartment();
	private _emitOnChange = true;
	private _suppressScroll = false;
	private _suppressTimer: ReturnType<typeof setTimeout> | undefined;

	protected override createRenderRoot(): HTMLElement {
		// Render in light DOM so CM6's styles (which target generic class names) inherit cleanly
		// and theme CSS variables propagate via the host's stylesheet without slot acrobatics.
		return this;
	}

	override render(): unknown {
		return html``;
	}

	override firstUpdated(_: PropertyValues): void {
		const initialDoc = this.value;
		const extensions: Extension[] = [
			this._readOnlyCompartment.of(EditorState.readOnly.of(this.readOnly)),
			this._languageCompartment.of(languageExtensionFor(this.language)),
			lineDecorationsField,
			gutterMarkersField,
			takeGutter,
			themeExt,
			history(),
			indentOnInput(),
			bracketMatching(),
			closeBrackets(),
			autocompletion(),
			indentUnit.of('\t'),
			highlightActiveLine(),
			highlightActiveLineGutter(),
			highlightSelectionMatches(),
			highlightSpecialChars(),
			syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
			keymap.of([
				...defaultKeymap,
				...historyKeymap,
				...searchKeymap,
				...closeBracketsKeymap,
				...foldKeymap,
				indentWithTab,
			]),
		];

		if (this.showLineNumbers) {
			extensions.push(lineNumbers(), foldGutter());
		}

		const view = new EditorView({
			parent: this,
			state: EditorState.create({ doc: initialDoc, extensions: extensions }),
			dispatch: (tr, root) => {
				root.update([tr]);
				if (!tr.docChanged) return;

				this._emitOnChange = false;
				this.value = root.state.doc.toString();
				this._emitOnChange = true;
				this.dispatchEvent(
					new CustomEvent('cm-change', {
						detail: { value: this.value },
						bubbles: true,
						composed: true,
					}),
				);
			},
		});
		this._view = view;
		this.applyLineDecorations();
		this.applyGutterMarkers();

		view.dom.addEventListener('click', this.onClick);
		view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
	}

	override updated(changed: PropertyValues<this>): void {
		const view = this._view;
		if (view == null) return;

		if (changed.has('value') && this._emitOnChange) {
			// CodeMirror normalizes the doc to LF; consumers may hold the value as CRLF (Windows
			// file endings). A direct strict-equality comparison would fire on every keystroke
			// round-trip and replace the entire doc — which collapses the user's selection to the
			// start. Normalize both sides so we only dispatch when content actually changed.
			const incoming = this.value.replace(/\r\n/g, '\n');
			if (incoming !== view.state.doc.toString()) {
				view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: incoming } });
			}
		}
		if (changed.has('readOnly')) {
			view.dispatch({ effects: this._readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.readOnly)) });
		}
		if (changed.has('language')) {
			view.dispatch({ effects: this._languageCompartment.reconfigure(languageExtensionFor(this.language)) });
		}
		if (changed.has('lineDecorations')) {
			this.applyLineDecorations();
		}
		if (changed.has('gutterMarkers')) {
			this.applyGutterMarkers();
		}
	}

	override disconnectedCallback(): void {
		this._view?.dom.removeEventListener('click', this.onClick);
		this._view?.scrollDOM.removeEventListener('scroll', this.onScroll);
		this._view?.destroy();
		this._view = undefined;
		super.disconnectedCallback?.();
	}

	scrollToLine(line: number, focus: boolean = false): void {
		const view = this._view;
		if (view == null) return;

		const lineIndex = Math.max(1, Math.min(line, view.state.doc.lines));
		const lineInfo = view.state.doc.line(lineIndex);
		view.dispatch({
			effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
		});
		if (focus) {
			view.focus();
		}
	}

	private applyLineDecorations(): void {
		const view = this._view;
		if (view == null) return;

		const ranges: Range<Decoration>[] = [];
		if (this.lineDecorations != null && this.lineDecorations.size > 0) {
			for (const [lineNumber, cls] of this.lineDecorations) {
				if (lineNumber < 1 || lineNumber > view.state.doc.lines) continue;

				const line = view.state.doc.line(lineNumber);
				ranges.push(Decoration.line({ class: cls }).range(line.from));
			}
		}
		view.dispatch({ effects: [clearLineDecorations.of(null), addLineDecorations.of({ ranges: ranges })] });
	}

	private applyGutterMarkers(): void {
		const view = this._view;
		if (view == null) return;

		const next = new Map<number, GutterMarkerKind>(this.gutterMarkers ?? []);
		view.dispatch({ effects: setGutterMarkersEffect.of(next) });
	}

	private onScroll = (): void => {
		if (this._suppressScroll) return;

		const view = this._view;
		if (view == null) return;

		const topPos = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
		const lineNumber = view.state.doc.lineAt(topPos.from).number;
		this.dispatchEvent(
			new CustomEvent('cm-scroll', {
				detail: { topLine: lineNumber },
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Programmatically scroll without firing `cm-scroll`. Used by sync-scroll consumers. */
	scrollToLineSilent(line: number): void {
		const view = this._view;
		if (view == null) return;

		this._suppressScroll = true;
		if (this._suppressTimer != null) {
			clearTimeout(this._suppressTimer);
		}
		// CodeMirror's scroll-into-view dispatch can fan out into several scrollDOM events across
		// multiple frames (measure cycle + browser smooth-scroll). One `requestAnimationFrame`
		// isn't enough — the resulting `scroll` events leak through and cause sync ping-pong.
		// Hold suppression for ~150 ms; if another sync arrives we just reset the timer.
		this._suppressTimer = setTimeout(() => {
			this._suppressScroll = false;
			this._suppressTimer = undefined;
		}, 150);

		const lineIndex = Math.max(1, Math.min(line, view.state.doc.lines));
		const info = view.state.doc.line(lineIndex);
		view.dispatch({ effects: EditorView.scrollIntoView(info.from, { y: 'start' }) });
	}

	private onClick = (e: MouseEvent): void => {
		if (!this.readOnly) return;

		// Clicks on the gutter (line numbers, fold, take-checkbox) have dedicated handlers via
		// CodeMirror's `gutter({domEventHandlers})`. Don't double-fire as a line click.
		const target = e.target as HTMLElement | null;
		if (target?.closest('.cm-gutters') != null) return;

		const view = this._view;
		if (view == null) return;

		const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
		if (pos == null) return;

		const line = view.state.doc.lineAt(pos);

		this.dispatchEvent(
			new CustomEvent('cm-line-click', {
				detail: { line: line.number, text: line.text },
				bubbles: true,
				composed: true,
			}),
		);
	};
}
