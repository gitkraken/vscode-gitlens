import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { MergeConflictHunk, MergeConflictResolution } from '../../../mergeConflict/protocol.js';
import type { CmLanguage, GlCmEditor, GutterMarkerKind } from './gl-cm-editor.js';
import { detectLanguage } from './gl-cm-editor.js';

interface LineMeta {
	/** Hunk index this line belongs to, or undefined for context lines. */
	hunkIndex?: number;
	/** 0-based offset within the hunk's side lines. */
	lineIndexInSide?: number;
	/** True when this line differs from base on this side. */
	changed?: boolean;
}

export type PaneDisplayMode = 'full' | 'hunks';

@customElement('gl-merge-conflict-pane')
export class GlMergeConflictPane extends LitElement {
	static override styles = css`
		:host {
			display: block;
			min-height: 0;
			overflow: hidden;
		}
		.hunk-header {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			padding: 0.25rem 0.75rem;
			background-color: var(--vscode-editorGutter-background);
			border-bottom: 1px solid var(--vscode-editorWidget-border);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		.hunk-header__label {
			font-weight: 600;
		}
		.hunk-header__pick-all {
			margin-left: auto;
			background: transparent;
			color: inherit;
			border: 1px solid var(--vscode-button-border, transparent);
			padding: 0.125rem 0.5rem;
			border-radius: 2px;
			cursor: pointer;
			font: inherit;
		}
		.hunk-header__pick-all:hover {
			background-color: var(--vscode-toolbar-hoverBackground);
		}
		.layout {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
		}
		gl-cm-editor {
			flex: 1;
			min-height: 0;
			display: block;
		}
	`;

	@property({ type: String }) side!: 'current' | 'incoming';
	@property({ attribute: false }) hunks: MergeConflictHunk[] = [];
	@property({ attribute: false }) resolutions: MergeConflictResolution[] = [];
	@property({ type: Number, attribute: 'focused-hunk-index' }) focusedHunkIndex = 0;
	@property({ type: String, attribute: 'file-path' }) filePath = '';
	/** Full stage-2 (for current) or stage-3 (for incoming) text. Required in 'full' mode. */
	@property({ attribute: false }) stageText = '';
	@property({ type: String, attribute: 'display-mode' }) displayMode: PaneDisplayMode = 'full';

	@query('gl-cm-editor') private readonly _editor!: GlCmEditor;

	/** Map line number (1-based) → line metadata. Populated by `rebuildLineMap`. */
	private _lineMeta = new Map<number, LineMeta>();
	private _text = '';

	override willUpdate(changed: PropertyValues<this>): void {
		if (changed.has('hunks') || changed.has('side') || changed.has('stageText') || changed.has('displayMode')) {
			this.rebuildLineMap();
		}
	}

	private _initializedScroll = false;

	override updated(changed: PropertyValues<this>): void {
		// Only scroll on explicit user navigation, layout swap, or first-render initialization.
		// Reacting to every `hunks` reference change snapped the pane back on every state push —
		// including the state push triggered by the user's own line pick, which felt like the
		// editor was fighting the click.
		if (changed.has('focusedHunkIndex') || changed.has('displayMode')) {
			this.scrollToFocused();
			return;
		}

		if (!this._initializedScroll && this.hunks.length > 0) {
			this._initializedScroll = true;
			this.scrollToFocused();
		}
	}

	protected override render(): unknown {
		if (this.hunks.length === 0) return nothing;

		const language: CmLanguage = detectLanguage(this.filePath);
		const decorationsCls = this.side === 'current' ? 'cm-mergeConflict-current' : 'cm-mergeConflict-incoming';
		const decorations = new Map<number, string>();
		const gutterMarkers = new Map<number, GutterMarkerKind>();
		const takenLines = this.computeTakenLines();

		for (const [lineNumber, meta] of this._lineMeta) {
			if (meta.hunkIndex == null || meta.lineIndexInSide == null) continue;

			if (meta.changed) {
				decorations.set(lineNumber, decorationsCls);
				gutterMarkers.set(
					lineNumber,
					takenLines.has(encodeTaken(meta.hunkIndex, meta.lineIndexInSide)) ? 'taken' : 'available',
				);
			}
		}

		const focused = this.hunks[this.focusedHunkIndex];
		const focusedLabel =
			this.side === 'current' ? focused?.currentLabel || 'Current' : focused?.incomingLabel || 'Incoming';
		const focusedTaken = focused != null && this.isWholeSideTaken(focused.index);

		return html`
			<div class="layout">
				<div class="hunk-header">
					<span class="hunk-header__label">${focusedLabel}</span>
					<button
						class="hunk-header__pick-all"
						type="button"
						?disabled=${focused == null}
						@click=${() => focused != null && this.emitPickHunk(focused.index)}
					>
						${focusedTaken ? "Don't take this side" : 'Take this side'}
					</button>
				</div>
				<gl-cm-editor
					.value=${this._text}
					.language=${language}
					.lineDecorations=${decorations}
					.gutterMarkers=${gutterMarkers}
					readOnly
					show-line-numbers
					@cm-line-click=${this.onLineClick}
					@cm-gutter-take=${this.onGutterTake}
					@cm-scroll=${this.onCmScroll}
				></gl-cm-editor>
			</div>
		`;
	}

	private computeTakenLines(): Set<number> {
		// A line is "taken" only when there's a SYNCED entry (source intact) for it. Once the user
		// edits a taken line, the entry drops its source attribution and the checkbox unchecks.
		const taken = new Set<number>();
		for (const r of this.resolutions) {
			for (const entry of r.entries) {
				if (entry.source?.side === this.side) {
					taken.add(encodeTaken(r.hunkIndex, entry.source.lineIndex));
				}
			}
		}
		return taken;
	}

	private isWholeSideTaken(hunkIndex: number): boolean {
		const hunk = this.hunks[hunkIndex];
		const res = this.resolutions.find(r => r.hunkIndex === hunkIndex);
		if (hunk == null || res == null) return false;

		const sideLines = (this.side === 'current' ? hunk.current : hunk.incoming).lines;
		if (sideLines.length === 0) return false;
		return sideLines.every((_, i) =>
			res.entries.some(e => e.source?.side === this.side && e.source.lineIndex === i),
		);
	}

	private rebuildLineMap(): void {
		this._lineMeta = new Map();
		if (this.displayMode === 'full') {
			this._text = this.stageText;
			// In full-file mode, lines belong to a hunk only when they fall inside that hunk's
			// stage range. Context lines outside any hunk get no metadata (no checkbox).
			for (const hunk of this.hunks) {
				const range = this.side === 'current' ? hunk.currentStageRange : hunk.incomingStageRange;
				const changedSet = new Set(
					this.side === 'current' ? hunk.currentChangedLines : hunk.incomingChangedLines,
				);
				for (let line = range.start; line < range.end; line++) {
					const indexInSide = line - range.start;
					this._lineMeta.set(line, {
						hunkIndex: hunk.index,
						lineIndexInSide: indexInSide,
						changed: changedSet.has(indexInSide),
					});
				}
			}
			return;
		}

		// Hunks-only mode: concat hunks separated by visual rulers. Recover line numbers as we go.
		const buf: string[] = [];
		let cursor = 1;
		this.hunks.forEach((hunk, idx) => {
			const sideRegion = this.side === 'current' ? hunk.current : hunk.incoming;
			const changedSet = new Set(this.side === 'current' ? hunk.currentChangedLines : hunk.incomingChangedLines);
			sideRegion.lines.forEach((line, i) => {
				this._lineMeta.set(cursor, {
					hunkIndex: hunk.index,
					lineIndexInSide: i,
					changed: changedSet.has(i),
				});
				buf.push(line);
				cursor++;
			});
			if (idx < this.hunks.length - 1) {
				buf.push(`──────── conflict ${hunk.index + 2} ────────`);
				cursor++;
			}
		});
		this._text = buf.join('\n');
	}

	private scrollToFocused(): void {
		if (this.hunks.length === 0 || this._editor == null) return;

		const target = this.focusedHunkIndex;
		for (const [line, meta] of this._lineMeta) {
			if (meta.hunkIndex === target) {
				this._editor.scrollToLine(line);
				return;
			}
		}
	}

	private onLineClick = (e: CustomEvent<{ line: number }>): void => {
		this.toggleLineByLineNumber(e.detail.line);
	};

	private onGutterTake = (e: CustomEvent<{ line: number }>): void => {
		this.toggleLineByLineNumber(e.detail.line);
	};

	private onCmScroll = (e: CustomEvent<{ topLine: number }>): void => {
		// Anchor the sync on the nearest hunk that's at or below the top-visible line.
		const meta = this._lineMeta.get(e.detail.topLine);
		const anchor =
			meta?.hunkIndex != null
				? {
						hunkIndex: meta.hunkIndex,
						offsetInHunk: meta.lineIndexInSide ?? 0,
						side: this.side,
					}
				: this.nearestHunkAnchor(e.detail.topLine);
		if (anchor == null) return;

		this.dispatchEvent(
			new CustomEvent('pane-scroll', {
				detail: anchor,
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** When the user is scrolled in a context region, anchor the sync to the next hunk below. */
	private nearestHunkAnchor(
		line: number,
	): { hunkIndex: number; offsetInHunk: number; side: 'current' | 'incoming' } | null {
		let bestHunkIndex: number | undefined;
		let bestStartLine = Number.POSITIVE_INFINITY;
		for (const [l, meta] of this._lineMeta) {
			if (meta.hunkIndex == null) continue;

			if (l >= line && l < bestStartLine) {
				bestStartLine = l;
				bestHunkIndex = meta.hunkIndex;
			}
		}
		if (bestHunkIndex == null) return null;
		return { hunkIndex: bestHunkIndex, offsetInHunk: 0, side: this.side };
	}

	private toggleLineByLineNumber(lineNumber: number): void {
		const meta = this._lineMeta.get(lineNumber);
		if (meta?.hunkIndex == null || meta.lineIndexInSide == null) return;
		if (!meta.changed) return;

		this.dispatchEvent(
			new CustomEvent('pick-line', {
				detail: { hunkIndex: meta.hunkIndex, side: this.side, lineIndex: meta.lineIndexInSide },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private emitPickHunk(hunkIndex: number): void {
		this.dispatchEvent(
			new CustomEvent('pick-hunk', {
				detail: { hunkIndex: hunkIndex, side: this.side },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Externally-driven scroll: find the first line for the anchor's hunk and silently scroll. */
	syncScrollToAnchor(anchor: { hunkIndex: number; offsetInHunk: number }): void {
		if (this._editor == null) return;

		let firstLine: number | undefined;
		let pickedLine: number | undefined;
		for (const [l, meta] of this._lineMeta) {
			if (meta.hunkIndex !== anchor.hunkIndex) continue;

			firstLine ??= l;
			if (meta.lineIndexInSide === anchor.offsetInHunk) {
				pickedLine = l;
				break;
			}
		}
		const target = pickedLine ?? firstLine;
		if (target != null) {
			this._editor.scrollToLineSilent(target);
		}
	}
}

/** Encode `(hunkIndex, lineIndexInSide)` into a single number for fast Set membership tests. */
function encodeTaken(hunkIndex: number, lineIndex: number): number {
	return hunkIndex * 10_000_000 + lineIndex;
}
