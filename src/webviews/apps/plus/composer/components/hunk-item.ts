import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../../../shared/components/code-icon';

@customElement('gl-hunk-item')
export class HunkItem extends LitElement {
	static override styles = css`
		:host {
			display: block;
			margin-bottom: 0.8rem;
		}

		.hunk-item {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-editor-background);
			cursor: grab;
			transition: all 0.2s ease;
			position: relative;
			user-select: none;
		}

		.hunk-item:hover {
			border-color: var(--vscode-list-hoverForeground);
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		}

		.hunk-item:active {
			cursor: grabbing;
		}

		.hunk-item.sortable-ghost {
			opacity: 0.5;
		}

		.hunk-item.sortable-chosen {
			transform: scale(1.02);
		}

		.hunk-item.sortable-drag {
			transform: rotate(1deg);
			box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
		}

		.hunk-item.selected {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-activeSelectionBackground);
		}

		.hunk-item.multi-selected {
			border-color: var(--vscode-focusBorder);
			border-style: dashed;
			background: var(--vscode-list-inactiveSelectionBackground);
		}

		.hunk-item.multi-selected.selected {
			border-style: solid;
			background: var(--vscode-list-activeSelectionBackground);
		}

		.hunk-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.8rem 1.2rem;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.file-info {
			display: flex;
			align-items: center;
			gap: 0.6rem;
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
			align-items: center;
			gap: 0.8rem;
			font-size: 0.9em;
		}

		.stat {
			display: flex;
			align-items: center;
			gap: 0.2rem;
		}

		.additions {
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.deletions {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.hunk-content {
			padding: 1.2rem;
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
			line-height: 1.4;
			background: var(--vscode-editor-background);
			border-radius: 0 0 4px 4px;
		}

		.code-block {
			background: var(--vscode-textCodeBlock-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 0.8rem;
			white-space: pre-wrap;
			overflow-x: auto;
			font-family: var(--vscode-editor-font-family);
			font-size: 0.9em;
			line-height: 1.3;
		}

		.diff-line {
			display: block;
		}

		.diff-line.addition {
			background: var(--vscode-diffEditor-insertedTextBackground);
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.diff-line.deletion {
			background: var(--vscode-diffEditor-removedTextBackground);
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.drag-handle {
			position: absolute;
			left: 0.4rem;
			top: 50%;
			transform: translateY(-50%);
			color: var(--vscode-descriptionForeground);
			opacity: 0;
			transition: opacity 0.2s ease;
		}

		.hunk-item:hover .drag-handle {
			opacity: 1;
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

	private renderDiffContent() {
		if (!this.content || typeof this.content !== 'string') {
			return html`<span class="diff-line">No content available</span>`;
		}
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

	override connectedCallback() {
		super.connectedCallback?.();
		// Set the data attribute on the host element for sortable
		this.dataset.hunkId = this.hunkId;
	}

	private handleClick(e: MouseEvent) {
		// Don't select hunk if clicking on drag handle
		if ((e.target as HTMLElement).closest('.drag-handle')) {
			return;
		}

		// Prevent text selection when shift-clicking
		if (e.shiftKey) {
			e.preventDefault();
		}

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
				<div class="drag-handle">
					<code-icon icon="gripper"></code-icon>
				</div>
				<div class="hunk-header">
					<div class="file-info">
						<code-icon class="file-icon" icon="file-code"></code-icon>
						<span class="file-name">${this.hunkHeader || this.fileName}</span>
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
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-hunk-item': HunkItem;
	}
}
