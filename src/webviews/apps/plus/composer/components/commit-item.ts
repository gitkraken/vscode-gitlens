import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../../../shared/components/code-icon';

@customElement('gl-commit-item')
export class CommitItem extends LitElement {
	static override styles = css`
		:host {
			display: block;
			margin-bottom: 0.2rem;
		}

		.commit-item {
			display: flex;
			align-items: stretch;
			border-radius: 12px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			cursor: pointer;
			transition: all 0.2s ease;
			position: relative;
			user-select: none;
			min-height: 60px;
		}

		.commit-item:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.commit-item:hover .commit-icon::after {
			background: var(--vscode-list-hoverBackground);
		}

		.commit-item.selected {
			background: var(--vscode-list-activeSelectionBackground);
		}

		.commit-item.selected .commit-icon::after {
			background: var(--vscode-list-activeSelectionBackground);
		}

		.commit-item.multi-selected {
			background: var(--vscode-list-activeSelectionBackground);
		}

		.commit-item.multi-selected .commit-icon::after {
			background: var(--vscode-list-activeSelectionBackground);
		}

		.commit-item.multi-selected.selected {
			background: var(--vscode-list-activeSelectionBackground);
		}

		.commit-item.sortable-ghost {
			opacity: 0.5;
		}

		.commit-item.sortable-chosen {
			transform: scale(1.02);
		}

		.commit-item.sortable-drag {
			transform: rotate(2deg);
		}

		.commit-item.drop-target {
			background: var(--vscode-list-dropBackground);
		}

		.commit-icon {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 2.4rem;
			flex-shrink: 0;
			position: relative;
			padding-left: 0.4rem;
		}

		.commit-icon::before {
			content: '';
			position: absolute;
			left: calc(50% + 0.2rem);
			top: 0;
			bottom: 0;
			width: 0;
			border-left: 2px dashed var(--vscode-foreground);
			transform: translateX(-50%);
		}

		.commit-icon::after {
			content: '';
			position: absolute;
			left: calc(50% + 0.2rem);
			top: 50%;
			width: 20px;
			height: 20px;
			background: var(--vscode-editor-background);
			border: 2px dashed var(--vscode-foreground);
			border-radius: 50%;
			transform: translate(-50%, -50%);
			z-index: 1;
		}

		/* Hide the top portion of the vertical line for the first commit */
		:host(:first-child) .commit-icon::before {
			top: 50%;
		}

		.commit-content {
			flex: 1;
			display: flex;
			flex-direction: column;
			justify-content: center;
			padding: 1.2rem;
			gap: 0.4rem;
			min-width: 0;
			overflow: hidden;
		}

		.commit-message {
			font-weight: 500;
			color: var(--vscode-foreground);
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
			line-height: 1.4;
			min-width: 0;
			flex: 1;
		}

		.commit-stats {
			display: flex;
			align-items: center;
			gap: 0.8rem;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		.file-count {
			color: var(--vscode-descriptionForeground);
		}

		.diff-stats {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			font-size: 0.8rem;
			font-weight: 500;
		}

		.additions {
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.deletions {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.drag-handle {
			position: absolute;
			left: 0.4rem;
			top: 50%;
			transform: translateY(-50%);
			color: var(--vscode-descriptionForeground);
			opacity: 0.3;
			transition: opacity 0.2s ease;
			cursor: grab;
			padding: 0.2rem;
		}

		.drag-handle:hover,
		.commit-item:hover .drag-handle {
			opacity: 1;
		}

		.drag-handle:active {
			cursor: grabbing;
		}
	`;

	@property()
	commitId!: string;

	@property()
	message!: string;

	@property({ type: Number })
	fileCount!: number;

	@property({ type: Number })
	additions!: number;

	@property({ type: Number })
	deletions!: number;

	@property({ type: Boolean })
	selected = false;

	@property({ type: Boolean })
	multiSelected = false;

	@property({ type: Boolean })
	isPreviewMode = false;

	override connectedCallback() {
		super.connectedCallback?.();
		// Set the data attribute for sortable access
		this.dataset.commitId = this.commitId;
	}

	private handleClick(e: MouseEvent) {
		// Don't select commit if clicking on drag handle
		if ((e.target as HTMLElement).closest('.drag-handle')) {
			return;
		}

		// Prevent text selection when shift-clicking
		if (e.shiftKey) {
			e.preventDefault();
		}

		this.dispatchEvent(
			new CustomEvent('commit-selected', {
				detail: {
					commitId: this.commitId,
					shiftKey: e.shiftKey,
				},
				bubbles: true,
			}),
		);
	}

	override render() {
		return html`
			<div
				class="commit-item ${this.selected ? 'selected' : ''} ${this.multiSelected ? 'multi-selected' : ''}"
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
				<div class="commit-icon"></div>
				<div class="commit-content">
					<div class="commit-message">${this.message}</div>
					<div class="commit-stats">
						<div class="file-count">${this.fileCount} ${this.fileCount === 1 ? 'file' : 'files'}</div>
						<div class="diff-stats">
							<span class="additions">+${this.additions}</span>
							<span class="deletions">-${this.deletions}</span>
						</div>
					</div>
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-item': CommitItem;
	}
}
