import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import Sortable from 'sortablejs';
import type { ComposerCommit, ComposerHunk } from '../../../../plus/composer/protocol';
import {
	getFileChanges,
	getFileCountForCommit,
	getHunksForCommit,
	getUnassignedHunks,
	groupHunksByFile,
} from '../../../../plus/composer/utils';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import '../../../shared/components/button';
import './hunk-item';
import './explaination';

@customElement('gl-details-panel')
export class DetailsPanel extends LitElement {
	static override styles = [
		boxSizingBase,
		scrollableBase,
		focusableBaseStyles,
		css`
			[hidden] {
				display: none !important;
			}

			:host {
				display: contents;
			}

			.details-panel {
				flex: 1;
				display: flex;
				flex-direction: column;
				overflow: hidden;
				gap: 1.6rem;
			}

			.details-panel.split-view {
				flex-direction: column;
				overflow-y: auto;
				scroll-behavior: smooth;
			}

			.history-actions {
				flex: none;
				display: flex;
				gap: 0.8rem;
				justify-content: flex-end;
			}

			.changes-list {
				flex: 1;
				overflow-y: auto;
				display: flex;
				flex-direction: column;
				gap: 3.2rem;
			}

			.commit-details {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.commit-message {
				position: relative;
			}

			.commit-message__text {
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				padding: 0.5rem 0.8rem;
				font-size: 1.3rem;
				line-height: 1.4;
				overflow-wrap: break-word;
				word-wrap: break-word;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 0.4rem;
			}

			.commit-message__input {
				width: 100%;
				padding: 0.5rem;
				font-family: inherit;
				font-size: 1.3rem;
				line-height: 1.4;
				border: 1px solid var(--vscode-input-border);
				border-radius: 0.2rem;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
			}

			textarea.commit-message__input {
				box-sizing: content-box;
				width: calc(100% - 1rem);
				resize: vertical;
				field-sizing: content;
				min-height: 2lh;
				max-height: 4lh;
			}

			.commit-message__input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.commit-message__input:invalid {
				border-color: var(--vscode-inputValidation-errorBorder);
				background-color: var(--vscode-inputValidation-errorBackground);
			}

			.commit-message__input:disabled {
				opacity: 0.4;
				cursor: not-allowed;
				pointer-events: none;
			}

			.commit-message__action {
				position: absolute;
				top: 0.5rem;
				right: 0.5rem;
			}

			.ai-explanation {
				margin-block: 0;
				line-height: 1.5;
				color: var(--vscode-editor-foreground);
			}

			.ai-explanation.placeholder {
				color: var(--vscode-descriptionForeground);
				font-style: italic;
			}

			.files-headline {
				font-size: 1.4rem;
				margin-block: 0 0.8rem;
			}

			.files-list {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.files-list.drag-over {
				border: 2px solid var(--vscode-focusBorder);
				background: var(--vscode-list-dropBackground);
			}

			.file-group {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 0.4rem;
				overflow: hidden;
			}

			.file-group__header {
				display: flex;
				align-items: center;
				padding: 0.5rem 0.8rem;
				background: var(--vscode-editorGroupHeader-tabsBackground);
				cursor: pointer;
			}

			.file-group[open] .file-group__header {
				border-bottom: 1px solid var(--vscode-panel-border);
			}

			.file-group__header:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.file-group__icon {
			}

			.file-group:not([open]) .file-group__icon--open,
			.file-group[open] .file-group__icon--closed {
				display: none;
			}

			.file-name {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				font-size: 1.4rem;
				font-weight: 500;
				color: var(--vscode-foreground);
			}

			.file-stats {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				font-size: 0.8rem;
				font-weight: 500;
			}

			.file-stats .additions {
				color: var(--vscode-gitDecoration-addedResourceForeground);
			}

			.file-stats .deletions {
				color: var(--vscode-gitDecoration-deletedResourceForeground);
			}

			.file-hunks {
				display: flex;
				flex-direction: column;
			}

			.empty-state {
				padding: 2rem;
				margin-block: 0;
				font-weight: bold;
				text-align: center;
				color: var(--vscode-descriptionForeground);
				background: var(--vscode-editor-background);
				border: 0.1rem solid var(--vscode-panel-border);
				border-radius: 0.3rem;
			}

			.empty-state__icon {
				font-size: 7.2rem;
				margin-block-end: 0.8rem;
				opacity: 0.75;
			}
		`,
	];

	@property({ type: Array })
	selectedCommits: ComposerCommit[] = [];

	@property({ type: Array })
	hunks: ComposerHunk[] = [];

	@property({ type: Object })
	selectedUnassignedSection: string | null = null;

	@property({ type: Boolean })
	commitMessageExpanded = true;

	@property({ type: Boolean })
	aiExplanationExpanded = true;

	@property({ type: Boolean })
	filesChangedExpanded = true;

	@property({ type: Set })
	selectedHunkIds: Set<string> = new Set();

	@property({ type: String })
	generatingCommitMessage: string | null = null;

	@property({ type: Boolean })
	committing: boolean = false;

	@property({ type: Boolean })
	aiEnabled: boolean = false;

	@property({ type: Boolean })
	isAIPreviewMode: boolean = false;

	@property({ type: Boolean })
	showHistoryButtons: boolean = false;

	@property({ type: Boolean })
	canUndo: boolean = false;

	@property({ type: Boolean })
	canRedo: boolean = false;

	private hunksSortables: Sortable[] = [];
	private isDraggingHunks = false;
	private draggedHunkIds: string[] = [];
	private autoScrollInterval?: number;
	private dragOverCleanupTimeout?: number;

	@query('.details-panel')
	private detailsPanel!: HTMLDivElement;

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		// Reinitialize sortables when commits, hunks, or AI preview mode change
		if (
			changedProperties.has('selectedCommits') ||
			changedProperties.has('hunks') ||
			changedProperties.has('isAIPreviewMode')
		) {
			this.initializeHunksSortable();
			this.setupAutoScroll();
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback?.();
		this.destroyHunksSortables();
		this.cleanupAutoScroll();
		if (this.dragOverCleanupTimeout) {
			clearTimeout(this.dragOverCleanupTimeout);
			this.dragOverCleanupTimeout = undefined;
		}
	}

	private destroyHunksSortables() {
		this.hunksSortables.forEach(sortable => sortable.destroy());
		this.hunksSortables = [];
	}

	private initializeHunksSortable() {
		this.destroyHunksSortables();

		// Don't initialize sortable in AI preview mode
		if (this.isAIPreviewMode) {
			return;
		}

		// Find all file hunks containers (could be multiple in split view)
		const fileHunksContainers = this.shadowRoot?.querySelectorAll('.file-hunks');
		fileHunksContainers?.forEach(hunksContainer => {
			const sortable = Sortable.create(hunksContainer as HTMLElement, {
				group: {
					name: 'hunks',
					pull: true, // Allow pulling hunks out
					put: false, // Allow dropping hunks between commits
				},
				animation: 0,
				dragClass: 'sortable-drag',
				selectedClass: 'sortable-selected',
				sort: false, // Don't allow reordering within the same container
				onStart: evt => {
					const draggedHunkId = evt.item.dataset.hunkId;
					if (draggedHunkId && this.selectedHunkIds.has(draggedHunkId) && this.selectedHunkIds.size > 1) {
						// Multi-hunk drag - collect all selected hunks
						this.dispatchHunkDragStart(Array.from(this.selectedHunkIds));
					} else {
						// Single hunk drag
						this.dispatchHunkDragStart(draggedHunkId ? [draggedHunkId] : []);
					}

					// Store original element for restoration if needed
					evt.item.setAttribute('data-original-parent', evt.from.id || 'unknown');
				},
				onEnd: () => {
					this.dispatchHunkDragEnd();
				},
			});
			this.hunksSortables.push(sortable);
		});

		// Add drag event listeners to files-list containers for visual feedback
		const filesListContainers = this.shadowRoot?.querySelectorAll('.files-changed');
		filesListContainers?.forEach(container => {
			container.addEventListener('dragover', this.handleFilesListDragOver);
			container.addEventListener('drop', this.handleFilesListDrop);
		});
	}

	private handleFilesListDragOver = (e: Event) => {
		e.preventDefault();
		const target = e.currentTarget as HTMLElement;

		// Only add drag-over if we're actually dragging hunks
		if (this.isDraggingHunks) {
			target.classList.add('drag-over');

			// Clear any existing cleanup timeout for this container
			if (this.dragOverCleanupTimeout) {
				clearTimeout(this.dragOverCleanupTimeout);
			}

			// Only set cleanup timeout if we're not auto-scrolling
			// (auto-scrolling can cause dragover events to be inconsistent)
			if (!this.autoScrollInterval) {
				this.dragOverCleanupTimeout = window.setTimeout(() => {
					target.classList.remove('drag-over');
				}, 150); // Remove highlight after 150ms of no dragover events
			}
		}
	};

	private handleFilesListDrop = (e: Event) => {
		e.preventDefault();
		(e.currentTarget as HTMLElement).classList.remove('drag-over');

		// Find the target commit ID
		const targetCommitId = (e.currentTarget as HTMLElement)
			.closest('[data-commit-id]')
			?.getAttribute('data-commit-id');

		if (targetCommitId && this.isDraggingHunks && this.draggedHunkIds.length > 0) {
			this.dispatchEvent(
				new CustomEvent('move-hunks-to-commit', {
					detail: { hunkIds: this.draggedHunkIds, targetCommitId: targetCommitId },
					bubbles: true,
				}),
			);
		}

		// Always end the drag operation to clean up state
		this.dispatchHunkDragEnd();
	};

	private setupAutoScroll() {
		// Remove existing listeners
		this.cleanupAutoScroll();

		// Add dragover listener for auto-scroll
		this.detailsPanel.addEventListener('dragover', this.handleDragOverForAutoScroll);
		// Add global dragend listener as a safety net to clean up drag state
		document.addEventListener('dragend', this.handleGlobalDragEnd);
	}

	private cleanupAutoScroll() {
		this.detailsPanel.removeEventListener('dragover', this.handleDragOverForAutoScroll);
		document.removeEventListener('dragend', this.handleGlobalDragEnd);
		if (this.autoScrollInterval) {
			clearInterval(this.autoScrollInterval);
			this.autoScrollInterval = undefined;
		}
	}

	private handleGlobalDragEnd = () => {
		// Safety net: always clean up drag state when any drag operation ends
		if (this.isDraggingHunks) {
			this.dispatchHunkDragEnd();
		}
	};

	private handleDragOverForAutoScroll = (e: Event) => {
		// Only auto-scroll when in split-view (multiple commits) and we're dragging hunks
		if (!this.detailsPanel?.classList.contains('split-view') || !this.isDraggingHunks) {
			return;
		}

		const dragEvent = e as DragEvent;
		dragEvent.preventDefault();

		const scrollContainer = dragEvent.currentTarget as HTMLElement;
		const rect = scrollContainer.getBoundingClientRect();
		const scrollZone = 120;
		const scrollSpeed = 25;

		const mouseY = dragEvent.clientY;
		const relativeY = mouseY - rect.top;

		// Clear existing interval
		if (this.autoScrollInterval) {
			clearInterval(this.autoScrollInterval);
			this.autoScrollInterval = undefined;
		}

		// Check if we're near the top or bottom
		if (relativeY < scrollZone && scrollContainer.scrollTop > 0) {
			// Scroll up
			this.autoScrollInterval = window.setInterval(() => {
				if (scrollContainer.scrollTop <= 0) {
					// Stop scrolling when we reach the top
					clearInterval(this.autoScrollInterval);
					this.autoScrollInterval = undefined;
					return;
				}
				scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - scrollSpeed);
			}, 16); // ~60fps
		} else if (
			relativeY > rect.height - scrollZone &&
			scrollContainer.scrollTop < scrollContainer.scrollHeight - scrollContainer.clientHeight
		) {
			// Scroll down
			this.autoScrollInterval = window.setInterval(() => {
				const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
				if (scrollContainer.scrollTop >= maxScroll) {
					// Stop scrolling when we reach the bottom
					clearInterval(this.autoScrollInterval);
					this.autoScrollInterval = undefined;
					return;
				}
				scrollContainer.scrollTop = Math.min(maxScroll, scrollContainer.scrollTop + scrollSpeed);
			}, 16); // ~60fps
		}
	};

	private dispatchHunkDragStart(hunkIds: string[]) {
		this.isDraggingHunks = true;
		this.draggedHunkIds = hunkIds;
		this.dispatchEvent(
			new CustomEvent('hunk-drag-start', {
				detail: { hunkIds: hunkIds },
				bubbles: true,
			}),
		);
	}

	private dispatchHunkDragEnd() {
		this.isDraggingHunks = false;
		this.draggedHunkIds = [];

		// Stop auto-scroll when drag ends
		if (this.autoScrollInterval) {
			clearInterval(this.autoScrollInterval);
			this.autoScrollInterval = undefined;
		}

		// Clear drag over cleanup timeout
		if (this.dragOverCleanupTimeout) {
			clearTimeout(this.dragOverCleanupTimeout);
			this.dragOverCleanupTimeout = undefined;
		}

		// Remove drag-over class from all files-changed containers
		const filesListContainers = this.shadowRoot?.querySelectorAll('.files-changed');
		filesListContainers?.forEach(container => {
			container.classList.remove('drag-over');
		});

		this.dispatchEvent(
			new CustomEvent('hunk-drag-end', {
				bubbles: true,
			}),
		);
	}

	private handleCommitMessageChange(commitId: string, message: string) {
		this.dispatchEvent(
			new CustomEvent('update-commit-message', {
				detail: { commitId: commitId, message: message },
				bubbles: true,
			}),
		);
	}

	private handleGenerateCommitMessage(commitId: string) {
		// Get hunk indices for this commit
		const commit = this.selectedCommits.find(c => c.id === commitId);
		const hunkIndices = commit?.hunkIndices || [];

		this.dispatchEvent(
			new CustomEvent('generate-commit-message', {
				detail: { commitId: commitId, hunkIndices: hunkIndices },
				bubbles: true,
			}),
		);
	}

	private renderFileHierarchy(hunks: ComposerHunk[]) {
		const fileGroups = groupHunksByFile(hunks);

		return Array.from(fileGroups.entries())
			.filter(([, fileHunks]) => fileHunks.length > 0) // Only show files that have hunks
			.map(([fileName, fileHunks]) => {
				const fileChanges = getFileChanges(fileHunks);

				return html`
					<details open class="file-group">
						<summary class="file-group__header">
							<code-icon class="file-group__icon file-group__icon--open" icon="chevron-down"></code-icon>
							<code-icon
								class="file-group__icon file-group__icon--closed"
								icon="chevron-right"
							></code-icon>
							<div class="file-name">${fileName}</div>
							<div class="file-stats" hidden>
								<span class="additions">+${fileChanges.additions}</span>
								<span class="deletions">-${fileChanges.deletions}</span>
							</div>
						</summary>
						<div class="file-hunks">
							${repeat(
								fileHunks,
								hunk => hunk.index,
								hunk => html`
									<gl-hunk-item
										data-hunk-id=${hunk.index.toString()}
										.hunkId=${hunk.index.toString()}
										.fileName=${hunk.fileName}
										.hunkHeader=${hunk.hunkHeader}
										.content=${hunk.content}
										.additions=${hunk.additions}
										.deletions=${hunk.deletions}
										.selected=${this.selectedHunkIds.has(hunk.index.toString())}
										.isRename=${hunk.isRename || false}
										.originalFileName=${hunk.originalFileName}
										.isAIPreviewMode=${this.isAIPreviewMode}
										@hunk-selected=${(e: CustomEvent) =>
											this.dispatchHunkSelect(e.detail.hunkId, e.detail.shiftKey)}
									></gl-hunk-item>
								`,
							)}
						</div>
					</details>
				`;
			});
	}

	private dispatchHunkSelect(hunkId: string, shiftKey: boolean = false) {
		this.dispatchEvent(
			new CustomEvent('hunk-selected', {
				detail: { hunkId: hunkId, shiftKey: shiftKey },
				bubbles: true,
			}),
		);
	}

	private dispatchHistoryUndo() {
		this.dispatchEvent(
			new CustomEvent('history-undo', {
				bubbles: true,
			}),
		);
	}

	private dispatchHistoryRedo() {
		this.dispatchEvent(
			new CustomEvent('history-redo', {
				bubbles: true,
			}),
		);
	}

	private dispatchHistoryReset() {
		this.dispatchEvent(
			new CustomEvent('history-reset', {
				bubbles: true,
			}),
		);
	}

	public focusCommitMessageInput(commitId: string) {
		// Find the commit message textarea for the specified commit
		const commitElement = this.shadowRoot?.querySelector(`[data-commit-id="${commitId}"]`);
		if (commitElement) {
			const textarea = commitElement.querySelector('textarea') as HTMLTextAreaElement;
			if (textarea) {
				textarea.focus();
				// Select all text so user can start typing immediately
				textarea.select();
			}
		}
	}

	private renderUnassignedSectionDetails() {
		if (!this.selectedUnassignedSection) return nothing;

		const hunks = this.getHunksForSection(this.selectedUnassignedSection);

		return html`
			<article class="commit-details">
				<header class="commit-message">
					<div class="commit-message__text">${this.getSectionTitle(this.selectedUnassignedSection)}</div>
				</header>

				<section>
					<h3 class="files-headline">Files Changed (${hunks.length})</h3>
					<div class="files-list" data-source="${this.selectedUnassignedSection}">
						${this.renderFileHierarchy(hunks)}
					</div>
				</section>
			</article>
		`;
	}

	private renderCommitDetails(commit: ComposerCommit) {
		const commitHunks = getHunksForCommit(commit, this.hunks);
		return html`
			<article class="commit-details" data-commit-id=${commit.id}>
				<header class="commit-message">
					<textarea
						class="commit-message__input"
						.value=${commit.message}
						placeholder="Enter commit message..."
						rows="3"
						@input=${(e: InputEvent) =>
							this.handleCommitMessageChange(commit.id, (e.target as HTMLTextAreaElement).value)}
					></textarea>
					${this.aiEnabled
						? html`
								<gl-button
									class="commit-message__action"
									appearance="toolbar"
									?disabled=${this.generatingCommitMessage === commit.id || this.committing}
									@click=${() => this.handleGenerateCommitMessage(commit.id)}
									title=${this.generatingCommitMessage === commit.id
										? 'Generating...'
										: 'Generate Commit Message'}
								>
									<code-icon
										icon=${this.generatingCommitMessage === commit.id ? 'loading~spin' : 'sparkle'}
									></code-icon>
								</gl-button>
							`
						: nothing}
				</header>

				<gl-explaination>
					${commit.aiExplanation || 'No AI explanation available for this commit.'}
				</gl-explaination>

				<section>
					<h3 class="files-headline">Files Changed (${getFileCountForCommit(commit, this.hunks)})</h3>
					<div class="files-list" data-commit-id=${commit.id}>${this.renderFileHierarchy(commitHunks)}</div>
				</section>
			</article>
		`;
	}

	private getHunksForSection(section: string): ComposerHunk[] {
		const unassignedHunks = getUnassignedHunks(this.hunks);

		switch (section) {
			case 'staged':
				return unassignedHunks.staged;
			case 'unstaged':
				return unassignedHunks.unstaged;
			case 'unassigned':
				return unassignedHunks.unassigned;
			default:
				return [];
		}
	}

	private getSectionTitle(section: string): string {
		switch (section) {
			case 'staged':
				return 'Staged Changes';
			case 'unstaged':
				return 'Unstaged Changes';
			case 'unassigned':
				return 'Unassigned Changes';
			default:
				return 'Changes';
		}
	}

	override render() {
		const isMultiSelect = this.selectedCommits.length > 1;

		return html`
			<div class="details-panel ${isMultiSelect ? 'split-view' : ''}">
				${when(
					this.showHistoryButtons,
					() => html`
						<nav class="history-actions" aria-label="History actions">
							<gl-button
								?disabled=${!this.canUndo}
								@click=${this.dispatchHistoryUndo}
								tooltip="Undo last action"
								appearance="secondary"
								><code-icon icon="discard" slot="prefix"></code-icon>Undo</gl-button
							>
							<gl-button
								?disabled=${!this.canRedo}
								@click=${this.dispatchHistoryRedo}
								tooltip="Redo last undone action"
								appearance="secondary"
								><code-icon icon="discard" flip="inline" slot="prefix"></code-icon>Redo</gl-button
							>
							<gl-button
								@click=${this.dispatchHistoryReset}
								tooltip="Reset to initial state"
								appearance="secondary"
								><code-icon icon="trash" slot="prefix"></code-icon>Reset</gl-button
							>
						</nav>
					`,
				)}
				<div class="changes-list scrollable">
					${when(
						this.selectedUnassignedSection,
						() => this.renderUnassignedSectionDetails(),
						() =>
							when(
								this.selectedCommits.length > 0,
								() =>
									repeat(
										this.selectedCommits,
										commit => commit.id,
										commit => this.renderCommitDetails(commit),
									),
								() =>
									html`<p class="empty-state">
										<code-icon class="empty-state__icon" icon="list-unordered"></code-icon><br />
										Select a commit or unassigned changes to view details
									</p>`,
							),
					)}
				</div>
			</div>
		`;
	}

	// private renderDetails(commit: ComposerCommit) {
}
