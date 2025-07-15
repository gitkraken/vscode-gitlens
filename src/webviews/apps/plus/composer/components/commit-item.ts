import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../../../shared/components/code-icon';

@customElement('gl-commit-item')
export class CommitItem extends LitElement {
	static override styles = css`
		:host {
			display: block;
			margin-bottom: 0.8rem;
		}

		.commit-item {
			padding: 1.2rem;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-list-inactiveSelectionBackground);
			cursor: pointer;
			transition: all 0.2s ease;
			position: relative;
		}

		.commit-item:hover {
			background: var(--vscode-list-hoverBackground);
			border-color: var(--vscode-list-hoverForeground);
		}

		.commit-item.selected {
			background: var(--vscode-list-activeSelectionBackground);
			border-color: var(--vscode-focusBorder);
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
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-dropBackground);
		}

		.commit-header {
			display: flex;
			align-items: center;
			gap: 0.8rem;
			margin-bottom: 0.4rem;
		}

		.commit-icon {
			color: var(--vscode-gitDecoration-modifiedResourceForeground);
		}

		.commit-message {
			font-weight: 500;
			color: var(--vscode-foreground);
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.commit-stats {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		.hunk-count {
			display: flex;
			align-items: center;
			gap: 0.2rem;
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

		.drop-zone {
			min-height: 40px;
			border: 2px dashed var(--vscode-panel-border);
			border-radius: 4px;
			margin-top: 0.4rem;
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
			transition: all 0.2s ease;
			opacity: 0.7;
		}

		.drop-zone:hover,
		.drop-zone.drag-over {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-dropBackground);
			opacity: 1;
		}
	`;

	@property()
	commitId!: string;

	@property()
	message!: string;

	@property({ type: Number })
	hunkCount!: number;

	@property({ type: Boolean })
	selected = false;

	override connectedCallback() {
		super.connectedCallback?.();
		// Set the data attribute for sortable access
		this.dataset.commitId = this.commitId;
	}

	private handleClick(e: Event) {
		// Don't select commit if clicking on drag handle
		if ((e.target as HTMLElement).closest('.drag-handle')) {
			return;
		}

		this.dispatchEvent(
			new CustomEvent('commit-selected', {
				detail: { commitId: this.commitId },
				bubbles: true,
			}),
		);
	}

	override render() {
		return html`
			<div class="commit-item ${this.selected ? 'selected' : ''}" @click=${this.handleClick}>
				<div class="drag-handle">
					<code-icon icon="gripper"></code-icon>
				</div>
				<div class="commit-header">
					<code-icon class="commit-icon" icon="git-commit"></code-icon>
					<div class="commit-message">${this.message}</div>
				</div>
				<div class="commit-stats">
					<div class="hunk-count">
						<code-icon icon="file-code"></code-icon>
						${this.hunkCount} ${this.hunkCount === 1 ? 'file' : 'files'}
					</div>
				</div>
				<div class="drop-zone">Drop hunks here</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-item': CommitItem;
	}
}
