import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type {
	MergeConflictHunk,
	MergeConflictResolution,
	OutputLineMeta,
	OutputLineSource,
} from '../../../mergeConflict/protocol.js';
import type { CmLanguage, GlCmEditor, GutterMarkerKind } from './gl-cm-editor.js';
import { detectLanguage } from './gl-cm-editor.js';

/**
 * Editable output pane backed by CodeMirror 6. Bidirectional sync: the host pushes the composed
 * output text via `text`; the user's edits bubble out as `output-change` events with the full
 * replacement text.
 */
@customElement('gl-merge-conflict-output')
export class GlMergeConflictOutput extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			min-height: 0;
			border-top: 1px solid var(--vscode-editorWidget-border);
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		.output__header {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			padding: 0.25rem 0.75rem;
			background-color: var(--vscode-editorGutter-background);
			border-bottom: 1px solid var(--vscode-editorWidget-border);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		.output__title {
			font-weight: 600;
		}
		.output__hint {
			opacity: 0.7;
			font-size: 0.9em;
		}
		.output__resets {
			margin-left: auto;
			display: flex;
			gap: 0.25rem;
			flex-wrap: wrap;
		}
		.output__reset-btn {
			background: transparent;
			color: inherit;
			border: 1px solid var(--vscode-button-border, transparent);
			padding: 0.125rem 0.5rem;
			border-radius: 2px;
			cursor: pointer;
			font: inherit;
		}
		.output__reset-btn:hover {
			background-color: var(--vscode-toolbar-hoverBackground);
		}
		gl-cm-editor {
			flex: 1;
			min-height: 0;
			display: block;
		}
	`;

	@property({ attribute: false }) text = '';
	@property({ attribute: false }) resolutions: MergeConflictResolution[] = [];
	@property({ attribute: false }) hunks: MergeConflictHunk[] = [];
	@property({ attribute: false }) lineSources: OutputLineSource[] = [];
	@property({ attribute: false }) lineMeta: (OutputLineMeta | null)[] = [];
	@property({ type: String, attribute: 'file-path' }) filePath = '';

	@query('gl-cm-editor') private readonly _editor!: GlCmEditor;
	private _externalText = '';

	override willUpdate(changed: PropertyValues<this>): void {
		if (changed.has('text')) {
			this._externalText = this.text;
		}
	}

	protected override render(): unknown {
		const resolvedHunks = this.resolutions.filter(r => r.resolved);
		const language: CmLanguage = detectLanguage(this.filePath);
		const gutterMarkers = new Map<number, GutterMarkerKind>();
		const lineDecorations = new Map<number, string>();
		this.lineSources.forEach((source, idx) => {
			const lineNumber = idx + 1;
			if (source === 'current' || source === 'incoming') {
				gutterMarkers.set(lineNumber, 'taken');
				lineDecorations.set(
					lineNumber,
					source === 'current' ? 'cm-mergeConflict-current' : 'cm-mergeConflict-incoming',
				);
			} else if (source === 'manual') {
				// Edited lines lose their side attribution — show a neutral background to signal
				// "this line is no longer in sync with either source".
				lineDecorations.set(lineNumber, 'cm-mergeConflict-manual');
			}
		});

		return html`
			<div class="output__header">
				<span class="output__title">Merged Output</span>
				<span class="output__hint">${resolvedHunks.length} of ${this.hunks.length} resolved</span>
				<div class="output__resets">
					${resolvedHunks.map(
						r => html`
							<button
								class="output__reset-btn"
								type="button"
								title="Reset conflict ${r.hunkIndex + 1}"
								@click=${() => this.emitReset(r.hunkIndex)}
							>
								Reset ${r.hunkIndex + 1}
							</button>
						`,
					)}
				</div>
			</div>
			<gl-cm-editor
				.value=${this._externalText}
				.language=${language}
				.gutterMarkers=${gutterMarkers}
				.lineDecorations=${lineDecorations}
				show-line-numbers
				@cm-change=${this.onChange}
				@cm-gutter-take=${this.onGutterUncheck}
			></gl-cm-editor>
		`;
	}

	private onChange = (e: CustomEvent<{ value: string }>): void => {
		// CodeMirror normalizes its internal doc to LF, so when the host pushes a CRLF-serialized
		// `outputText` (Windows file endings) the cm-change event fires with LF text that doesn't
		// strict-equal our CRLF `_externalText`. Without normalizing, every state push would be
		// mis-detected as a user edit and the host would flip into manual-override mode, losing
		// per-line source tags. Compare normalized values so the echo guard works.
		if (normalizeEol(e.detail.value) === normalizeEol(this._externalText)) return;

		this.dispatchEvent(
			new CustomEvent('output-change', {
				detail: { text: e.detail.value },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onGutterUncheck = (e: CustomEvent<{ line: number }>): void => {
		// Output lines from a side pick carry meta with the source coordinates. Re-emit pick-line
		// so the host toggles the line off on the side it came from — the next state push will
		// drop the green check on this output line and the matching source pane's checkbox.
		const meta = this.lineMeta[e.detail.line - 1];
		if (meta == null) return;

		this.dispatchEvent(
			new CustomEvent('pick-line', {
				detail: { hunkIndex: meta.hunkIndex, side: meta.side, lineIndex: meta.lineIndexInSide },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private emitReset(hunkIndex: number): void {
		this.dispatchEvent(
			new CustomEvent('reset-hunk', {
				detail: { hunkIndex: hunkIndex },
				bubbles: true,
				composed: true,
			}),
		);
	}

	focusOutput(): void {
		this._editor?.scrollToLine(1, true);
	}
}

function normalizeEol(s: string): string {
	return s.replace(/\r\n/g, '\n');
}
