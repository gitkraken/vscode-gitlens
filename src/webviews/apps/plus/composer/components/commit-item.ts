import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css';
import { composerItemCommitStyles, composerItemContentStyles, composerItemStyles } from './composer.css';
import '../../../shared/components/code-icon';

@customElement('gl-commit-item')
export class CommitItem extends LitElement {
	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		composerItemStyles,
		composerItemContentStyles,
		composerItemCommitStyles,
		css`
			:host {
				display: block;
				margin-bottom: 0.2rem;
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
		`,
	];

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

	@property({ type: Boolean })
	isRecomposeLocked = false;

	@property({ type: Boolean })
	locked = false;

	@property({ type: Boolean })
	first = false;

	@property({ type: Boolean })
	last = false;

	override connectedCallback() {
		super.connectedCallback?.();
		// Set the data attribute for sortable access
		this.dataset.commitId = this.commitId;
	}

	private handleMouseDown(e: MouseEvent) {
		// Prevent text selection when shift-clicking
		if (e.shiftKey) {
			e.preventDefault();
		}
	}

	private handleClick(e: MouseEvent | KeyboardEvent) {
		if ((e.target as HTMLElement).closest('.drag-handle') || (e instanceof KeyboardEvent && e.key !== 'Enter')) {
			return;
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
		const isPlaceholder = !this.message || this.message.trim().length === 0;
		return html`
			<div
				class="composer-item commit-item ${this.selected ? ' is-selected' : ''}${this.multiSelected
					? ' multi-selected'
					: ''}${this.first ? ' is-first' : ''}${this.last ? ' is-last' : ''}${this.isRecomposeLocked
					? ' is-recompose-locked'
					: ''}${this.locked ? ' is-locked' : ''}"
				data-commit-id=${this.commitId}
				tabindex="0"
				@click=${this.handleClick}
				@keydown=${this.handleClick}
				@mousedown=${this.handleMouseDown}
			>
				${when(
					!this.isPreviewMode,
					() => html`
						<div class="drag-handle">
							<code-icon icon="gripper"></code-icon>
						</div>
					`,
				)}
				<div class="composer-item__commit"></div>
				<div class="composer-item__content">
					<div class="composer-item__header${isPlaceholder ? ' is-placeholder' : ''}">
						${isPlaceholder ? 'Draft commit (add a commit message)' : this.message}
					</div>
					<div class="composer-item__body change-stats">
						<div class="file-count">${this.fileCount} ${this.fileCount === 1 ? 'file' : 'files'}</div>
						<div class="diff-stats">
							<span class="diff-stats__additions">+${this.additions}</span>
							<span class="diff-stats__deletions">-${this.deletions}</span>
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
