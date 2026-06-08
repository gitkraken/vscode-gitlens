import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../../../shared/components/code-icon.js';

const hunkHeaderRegex = /@@ -(\d+),(\d+) \+(\d+),(\d+) @@/;

@customElement('gl-hunk-item')
export class HunkItem extends LitElement {
	static override styles = css`
		:host {
			display: block;

			/* margin-bottom: 0.8rem; */
		}

		.hunk-item {
			position: relative;
			cursor: grab;
			user-select: none;
			background: var(--vscode-editor-background);
			border: 1px solid transparent;
			border-radius: 0.4rem;
			transition: all 0.2s ease;
		}

		.hunk-item:hover {
			border-color: var(--vscode-list-hoverForeground);
			box-shadow: 0 2px 4px rgb(0 0 0 / 10%);
		}

		.hunk-item:active {
			cursor: grabbing;
		}

		.hunk-item.sortable-ghost {
			opacity: 0.5;
			transform: scale(0.5);
		}

		.hunk-item.sortable-chosen {
			transform: scale(1.02);
		}

		.hunk-item.sortable-drag {
			box-shadow: 0 4px 8px rgb(0 0 0 / 20%);
			opacity: 0.5;
			transform: scale(0.5);
		}

		.hunk-item.sortable-selected {
			background: var(--vscode-list-activeSelectionBackground);
			border-color: var(--vscode-focusBorder);
		}

		.hunk-item.multi-selected {
			background: var(--vscode-list-inactiveSelectionBackground);
			border-color: var(--vscode-focusBorder);
			border-style: dashed;
		}

		.hunk-item.multi-selected.selected {
			background: var(--vscode-list-activeSelectionBackground);
			border-style: solid;
		}

		.hunk-header {
			display: flex;

			/* justify-content: space-between; */
			gap: 0.8rem;
			align-items: center;
			padding: 0.8rem;
		}

		.file-info {
			display: flex;
			gap: 0.6rem;
			align-items: center;
		}

		.file-icon {
			color: var(--vscode-symbolIcon-fileForeground);
		}

		.file-name {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.hunk-stats {
			display: flex;
			gap: 0.8rem;
			align-items: center;
			font-size: 0.9em;
		}

		.stat {
			display: flex;
			gap: 0.2rem;
			align-items: center;
		}

		.additions {
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.deletions {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.hunk-content {
			/* padding: 1.2rem; */
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
			line-height: 1.4;
			background: var(--vscode-editor-background);
			border-radius: 0 0 4px 4px;
		}

		.code-block {
			/* border: 1px solid var(--vscode-panel-border);
		border-radius: 4px; */
			padding: 0.8rem;
			overflow-x: auto;
			font-family: var(--vscode-editor-font-family);
			font-size: 0.9em;
			line-height: 1.3;
			white-space: pre-wrap;
			background: var(--vscode-textCodeBlock-background);
		}

		.diff-line {
			display: block;
		}

		.diff-line.addition {
			color: var(--vscode-gitDecoration-addedResourceForeground);
			background: var(--vscode-diffEditor-insertedTextBackground);
		}

		.diff-line.deletion {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
			background: var(--vscode-diffEditor-removedTextBackground);
		}

		.drag-handle {
			position: absolute;
			top: 50%;
			left: 0.4rem;
			color: var(--vscode-descriptionForeground);
			opacity: 0;
			transform: translateY(-50%);
			transition: opacity 0.2s ease;
		}

		.hunk-item:hover .drag-handle {
			opacity: 1;
		}

		/* Rename-specific styles */
		.rename-info {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}

		.rename-line {
			display: flex;
			gap: 0.8rem;
			align-items: center;
			font-weight: 500;
		}

		.rename-text {
			display: flex;
			gap: 0.5rem;
			align-items: center;
		}

		.original-name {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
			text-decoration: line-through;
		}

		.arrow {
			font-weight: bold;
			color: var(--vscode-descriptionForeground);
		}

		.new-name {
			font-weight: 500;
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.similarity-info {
			font-size: 0.9em;
			font-style: italic;
			color: var(--vscode-descriptionForeground);
		}
	`;

	@property()
	hunkId!: string;

	@property()
	fileName!: string;

	@property()
	hunkHeader?: string;

	@property()
	content!: string;

	@property({ type: Number })
	additions!: number;

	@property({ type: Number })
	deletions!: number;

	@property({ type: Boolean })
	selected = false;

	@property({ type: Boolean })
	multiSelected = false;

	@property({ type: Boolean })
	isRename = false;

	@property()
	originalFileName?: string;

	@property({ type: Boolean })
	isPreviewMode = false;

	override connectedCallback() {
		super.connectedCallback?.();
		// Set the data attribute on the host element for sortable
		this.dataset.hunkId = this.hunkId;
	}

	private handleClick(e: MouseEvent) {
		/*// Don't select hunk if clicking on drag handle
		if ((e.target as HTMLElement).closest('.drag-handle')) {
			return;
		} */

		// Prevent text selection when shift-clicking
		/* if (e.shiftKey) {
			e.preventDefault();
		} */

		this.dispatchEvent(
			new CustomEvent('hunk-selected', {
				detail: {
					hunkId: this.hunkId,
					shiftKey: e.shiftKey,
				},
				bubbles: true,
			}),
		);
	}

	override render() {
		return html`
			<div
				class="hunk-item ${this.selected ? 'selected' : ''} ${this.multiSelected ? 'multi-selected' : ''}"
				@click=${this.handleClick}
			>
				${when(
					!this.isPreviewMode,
					() => html`
						<div class="drag-handle">
							<code-icon icon="gripper"></code-icon>
						</div>
					`,
				)}
				<div class="hunk-header">
					<div class="file-info">
						${when(
							this.isRename,
							() =>
								html`<code-icon class="file-icon" icon="arrow-right"></code-icon
									><span class="file-name">File Rename</span>`,
							() => html`<span class="file-name">${this.renderHunkHeader()}</span>`,
						)}
					</div>
					<div class="hunk-stats">
						<div class="stat additions">
							<code-icon icon="add"></code-icon>
							${this.additions}
						</div>
						<div class="stat deletions">
							<code-icon icon="remove"></code-icon>
							${this.deletions}
						</div>
					</div>
				</div>
				<div class="hunk-content">
					<div class="code-block">${this.renderDiffContent()}</div>
				</div>
			</div>
		`;
	}

	private renderHunkHeader() {
		if (!this.hunkHeader) {
			return this.fileName;
		}

		let hunkHeader = this.hunkHeader;
		// Convert hunk header to a more readable format. E.g., "@@ -1,5 +1,7 @@" to "Lines 1-7"
		if (hunkHeader.startsWith('@@')) {
			const match = hunkHeader.match(hunkHeaderRegex);
			if (match) {
				const [_, _oldStart, _oldLines, newStart, newLines] = match;
				const startLine = parseInt(newStart, 10);
				const endLine = startLine + parseInt(newLines, 10) - 1;
				hunkHeader = `Lines ${startLine}-${endLine}`;
			}
		}

		return hunkHeader;
	}

	private renderDiffContent() {
		if (!this.content || typeof this.content !== 'string') {
			return html`<span class="diff-line">No content available</span>`;
		}

		// Special rendering for rename hunks
		if (this.isRename) {
			return html`
				<div class="rename-info">
					<div class="rename-line">
						<code-icon icon="arrow-right"></code-icon>
						<span class="rename-text">
							<span class="original-name">${this.originalFileName}</span>
							<span class="arrow">→</span>
							<span class="new-name">${this.fileName}</span>
						</span>
					</div>
					<div class="similarity-info">
						${this.content.split('\n').find(line => line.includes('similarity'))}
					</div>
				</div>
			`;
		}

		// Regular diff content rendering
		const lines = this.content.split('\n');
		return lines.map(line => {
			if (line.startsWith('+')) {
				return html`<span class="diff-line addition">${line}</span>`;
			}
			if (line.startsWith('-')) {
				return html`<span class="diff-line deletion">${line}</span>`;
			}
			return html`<span class="diff-line">${line}</span>`;
		});
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-hunk-item': HunkItem;
	}
}
