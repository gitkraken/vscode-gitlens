import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
import './hunk-item';

@customElement('gl-details-panel')
export class DetailsPanel extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
				position: relative;
			}

			.details-panel {
				flex: 1;
				display: flex;
				flex-direction: column;
				overflow: hidden;
			}

			.details-panel.split-view {
				flex-direction: column;
				overflow-y: auto;
				scroll-behavior: smooth;
			}

			.commit-details {
				display: flex;
				flex-direction: column;
				min-width: 0;
				border-bottom: 1px solid var(--vscode-panel-border);
				margin-bottom: 1.5rem;
				background: var(--vscode-editor-background);
			}

			/* Single commit: take full height */
			:host(:not([multiple-commits])) .commit-details {
				flex: 1;
				margin-bottom: 0;
			}

			/* Multiple commits: fixed height containers that stack */
			:host([multiple-commits]) .commit-details {
				height: 100vh;
				flex: none;
				margin-bottom: 2rem;
			}

			.commit-details:last-child {
				border-bottom: none;
				margin-bottom: 0;
			}

			.commit-header {
				padding: 1rem;
				border-bottom: 1px solid var(--vscode-panel-border);
				background: var(--vscode-editor-background);
			}

			.commit-message {
				font-weight: 500;
				margin-bottom: 0.5rem;
				word-wrap: break-word;
				max-width: 100%;
				overflow-wrap: break-word;
				white-space: pre-wrap;
			}

			.commit-message.truncated {
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: normal;
			}

			.section {
				border-bottom: 1px solid var(--vscode-panel-border);
				display: flex;
				flex-direction: column;
			}

			.section.files-changed-section {
				flex: 1;
				min-height: 0;
				max-height: 75vh;
			}

			.section:last-child {
				border-bottom: none;
			}

			.section-header {
				padding: 0.75rem 1rem;
				background: var(--vscode-sideBar-background);
				border-bottom: 1px solid var(--vscode-panel-border);
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.5rem;
				font-weight: 500;
			}

			.section-header-left {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				cursor: pointer;
				user-select: none;
				flex: 1;
			}

			.section-header:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.section-content {
				transition: max-height 0.3s ease;
			}

			.section-content.collapsed {
				max-height: 0 !important;
				overflow: hidden !important;
			}

			.section-content.commit-message {
				padding: 1rem;
				max-height: 200px;
				overflow-y: auto;
			}

			.section-content.ai-explanation {
				padding: 1rem;
				max-height: 300px;
				overflow-y: auto;
			}

			.section-content.files-changed {
				padding: 0;
				flex: 1;
				overflow-y: auto;
				min-height: 0;
				max-height: 100%;
			}

			.section-content.files-changed.collapsed {
				overflow: hidden !important;
			}

			.section-content.files-changed.drag-over {
				border: 2px solid var(--vscode-focusBorder);
				background: var(--vscode-list-dropBackground);
			}

			.ai-explanation {
				line-height: 1.5;
				color: var(--vscode-editor-foreground);
			}

			.ai-explanation.placeholder {
				color: var(--vscode-descriptionForeground);
				font-style: italic;
			}

			.hunks-list {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
				padding: 0.5rem;
			}

			.files-list {
				display: flex;
				flex-direction: column;
				gap: 1rem;
				padding: 0.5rem;
			}

			.file-group {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				overflow: hidden;
			}

			.file-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 0.5rem 0.75rem;
				background: var(--vscode-editorGroupHeader-tabsBackground);
				border-bottom: 1px solid var(--vscode-panel-border);
			}

			.file-name {
				display: flex;
				align-items: center;
				gap: 0.5rem;
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

			.commit-message-textarea {
				width: 100%;
				min-width: 0;
				resize: vertical;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				padding: 0.5rem;
				font-family: inherit;
				font-size: inherit;
				box-sizing: border-box;
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

	private hunksSortables: Sortable[] = [];
	private isDraggingHunks = false;
	private draggedHunkIds: string[] = [];
	private autoScrollInterval?: number;
	private dragOverCleanupTimeout?: number;

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		// Reinitialize sortables when commits or hunks change
		if (changedProperties.has('selectedCommits') || changedProperties.has('hunks')) {
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

		// Find all file hunks containers (could be multiple in split view)
		const fileHunksContainers = this.shadowRoot?.querySelectorAll('.file-hunks');
		if (fileHunksContainers && fileHunksContainers.length > 0) {
			fileHunksContainers.forEach(hunksContainer => {
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
		}

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
		const detailsPanel = this.shadowRoot?.querySelector('.details-panel');
		if (!detailsPanel) return;

		// Remove existing listeners
		this.cleanupAutoScroll();

		// Add dragover listener for auto-scroll
		detailsPanel.addEventListener('dragover', this.handleDragOverForAutoScroll);
		// Add global dragend listener as a safety net to clean up drag state
		document.addEventListener('dragend', this.handleGlobalDragEnd);
	}

	private cleanupAutoScroll() {
		const detailsPanel = this.shadowRoot?.querySelector('.details-panel');
		if (detailsPanel) {
			detailsPanel.removeEventListener('dragover', this.handleDragOverForAutoScroll);
		}
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
		const detailsPanel = this.shadowRoot?.querySelector('.details-panel');
		if (!detailsPanel?.classList.contains('split-view') || !this.isDraggingHunks) {
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
					<div class="file-group">
						<div class="file-header">
							<div class="file-name">
								<code-icon icon="file-code"></code-icon>
								${fileName}
							</div>
							<div class="file-stats">
								<span class="additions">+${fileChanges.additions}</span>
								<span class="deletions">-${fileChanges.deletions}</span>
							</div>
						</div>
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
										@hunk-selected=${(e: CustomEvent) =>
											this.dispatchHunkSelect(e.detail.hunkId, e.detail.shiftKey)}
									></gl-hunk-item>
								`,
							)}
						</div>
					</div>
				`;
			});
	}

	private toggleSection(section: 'commitMessage' | 'aiExplanation' | 'filesChanged') {
		let eventName: string;
		switch (section) {
			case 'commitMessage':
				eventName = 'toggle-commit-message';
				break;
			case 'aiExplanation':
				eventName = 'toggle-ai-explanation';
				break;
			case 'filesChanged':
				eventName = 'toggle-files-changed';
				break;
		}

		this.dispatchEvent(
			new CustomEvent(eventName, {
				bubbles: true,
			}),
		);
	}

	private dispatchHunkSelect(hunkId: string, shiftKey: boolean = false) {
		this.dispatchEvent(
			new CustomEvent('hunk-selected', {
				detail: { hunkId: hunkId, shiftKey: shiftKey },
				bubbles: true,
			}),
		);
	}

	private renderUnassignedSectionDetails() {
		if (!this.selectedUnassignedSection) return nothing;

		const hunks = this.getHunksForSection(this.selectedUnassignedSection);

		return html`
			<div class="commit-details">
				<div class="commit-header">
					<div class="commit-message">${this.getSectionTitle(this.selectedUnassignedSection)}</div>
				</div>

				<div class="section files-changed-section">
					<div class="section-header">
						<div class="section-header-left" @click=${() => this.toggleSection('filesChanged')}>
							<code-icon icon=${this.filesChangedExpanded ? 'chevron-down' : 'chevron-right'}></code-icon>
							Files Changed (${hunks.length})
						</div>
					</div>
					<div class="section-content files-changed ${this.filesChangedExpanded ? '' : 'collapsed'}">
						<div class="files-list" data-source="${this.selectedUnassignedSection}">
							${this.renderFileHierarchy(hunks)}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	private renderCommitDetails(commit: ComposerCommit) {
		const commitHunks = getHunksForCommit(commit, this.hunks);
		return html`
			<div class="commit-details" data-commit-id=${commit.id}>
				<div class="commit-header">
					<div class="commit-message truncated">${commit.message}</div>
				</div>

				<div class="section">
					<div class="section-header">
						<div class="section-header-left" @click=${() => this.toggleSection('commitMessage')}>
							<code-icon
								icon=${this.commitMessageExpanded ? 'chevron-down' : 'chevron-right'}
							></code-icon>
							Commit Message
						</div>
						${this.aiEnabled
							? html`
									<gl-button
										appearance="secondary"
										size="small"
										?disabled=${this.generatingCommitMessage === commit.id || this.committing}
										@click=${() => this.handleGenerateCommitMessage(commit.id)}
										title=${this.generatingCommitMessage === commit.id
											? 'Generating...'
											: 'Generate Commit Message with AI'}
									>
										<code-icon
											icon=${this.generatingCommitMessage === commit.id
												? 'loading~spin'
												: 'sparkle'}
										></code-icon>
									</gl-button>
								`
							: ''}
					</div>
					<div class="section-content commit-message ${this.commitMessageExpanded ? '' : 'collapsed'}">
						<textarea
							class="commit-message-textarea"
							.value=${commit.message}
							placeholder="Enter commit message..."
							rows="3"
							@input=${(e: InputEvent) =>
								this.handleCommitMessageChange(commit.id, (e.target as HTMLTextAreaElement).value)}
						></textarea>
					</div>
				</div>

				<div class="section">
					<div class="section-header">
						<div class="section-header-left" @click=${() => this.toggleSection('aiExplanation')}>
							<code-icon
								icon=${this.aiExplanationExpanded ? 'chevron-down' : 'chevron-right'}
							></code-icon>
							AI Explanation
						</div>
					</div>
					<div class="section-content ai-explanation ${this.aiExplanationExpanded ? '' : 'collapsed'}">
						<p class="ai-explanation ${commit.aiExplanation ? '' : 'placeholder'}">
							${commit.aiExplanation || 'No AI explanation available for this commit.'}
						</p>
					</div>
				</div>

				<div class="section files-changed-section">
					<div class="section-header">
						<div class="section-header-left" @click=${() => this.toggleSection('filesChanged')}>
							<code-icon icon=${this.filesChangedExpanded ? 'chevron-down' : 'chevron-right'}></code-icon>
							Files Changed (${getFileCountForCommit(commit, this.hunks)})
						</div>
					</div>
					<div class="section-content files-changed ${this.filesChangedExpanded ? '' : 'collapsed'}">
						<div class="files-list" data-commit-id=${commit.id}>
							${this.renderFileHierarchy(commitHunks)}
						</div>
					</div>
				</div>
			</div>
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
								html`<div
									style="padding: 2rem; text-align: center; color: var(--vscode-descriptionForeground);"
								>
									Select a commit or unassigned changes to view details
								</div>`,
						),
				)}
			</div>
		`;
	}
}
