import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import Sortable from 'sortablejs';
import type { ComposerCommit, ComposerHunk } from '../../../../plus/composer/protocol';
import {
	generateComposerMarkdown,
	getFileCountForCommit,
	getHunksForCommit,
	getUnassignedHunks,
	getUniqueFileNames,
	groupHunksByFile,
} from '../../../../plus/composer/utils/composer.utils';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import type { CommitMessage } from './commit-message';
import '../../../shared/components/button';
import '../../../shared/components/markdown/markdown';
import './hunk-item';
// import './diff/diff';
import './diff/diff-file';
import './commit-message';

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

			.changes-list {
				flex: 1;
				overflow-y: auto;
				display: flex;
				flex-direction: column;
				gap: 3.2rem;
				--commit-message-sticky-top: 0;
			}

			.change-details gl-commit-message {
				--sticky-top: var(--commit-message-sticky-top);
			}

			.change-details {
				display: flex;
				flex-direction: column;
				gap: 1.2rem;
			}

			.files-headline {
				font-size: 1.4rem;
				margin-block: 0 0.8rem;
				display: flex;
				align-items: center;
				justify-content: space-between;
			}

			.files-headline__title {
				margin: 0;
			}

			.files-headline__actions {
				display: flex;
				gap: 0.4rem;
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

			.empty-state,
			.no-changes-state {
				padding: 2rem;
				max-width: 80rem;
				background: var(--vscode-editor-background);
				border: 0.1rem solid var(--vscode-panel-border);
				border-radius: 0.3rem;
				color: var(--color-foreground--85);
			}

			.change-details.composition-summary {
				border: 0.1rem solid var(--vscode-panel-border);
				border-radius: 0.3rem;
				padding: 1.6rem;
				gap: 0;
			}

			.empty-state {
				margin-block: 0;
				font-weight: bold;
				text-align: center;
			}

			.empty-state__icon {
				font-size: 7.2rem;
				margin-block-end: 0.8rem;
				opacity: 0.75;
			}

			.no-changes-state {
			}

			.no-changes-title {
				font-size: 1.6rem;
				font-weight: 600;
				margin-block: 0;
				color: var(--color-foreground);
			}

			.no-changes-description {
				line-height: 1.5;
				margin-block: 1.6rem;
				text-wrap: pretty;
			}

			.no-changes-actions {
				display: flex;
				gap: 1.2rem;
				margin-block-start: 1.6rem;
			}
		`,
	];

	@property({ type: Array })
	commits: ComposerCommit[] = [];

	@property({ type: Array })
	selectedCommits: ComposerCommit[] = [];

	@property({ type: Array })
	hunks: ComposerHunk[] = [];

	@property()
	selectedUnassignedSection: 'staged' | 'unstaged' | 'unassigned' | null = null;

	@property({ type: Boolean })
	commitMessageExpanded = true;

	@property({ type: Boolean })
	aiExplanationExpanded = true;

	@property({ type: Boolean })
	filesChangedExpanded = true;

	@property({ type: Object })
	selectedHunkIds: Set<string> = new Set();

	@property({ type: String })
	generatingCommitMessage: string | null = null;

	@property({ type: Boolean })
	committing: boolean = false;

	@property({ type: Boolean })
	aiEnabled: boolean = false;

	@property({ type: String })
	aiDisabledReason: string | null = null;

	@property({ type: Boolean })
	isPreviewMode: boolean = false;

	@property({ type: Boolean })
	compositionSummarySelected: boolean = false;

	@property({ type: Boolean })
	hasChanges: boolean = true;

	@property({ type: Boolean })
	canEditCommitMessages: boolean = true;

	@property({ type: Boolean })
	canMoveHunks: boolean = true;

	@state()
	private defaultFilesExpanded: boolean = true;

	private hunksSortables: Sortable[] = [];
	private isDraggingHunks = false;
	private draggedHunkIds: string[] = [];
	private autoScrollInterval?: number;
	private dragOverCleanupTimeout?: number;
	private commitMessageResizeObserver?: ResizeObserver;

	@query('.details-panel')
	private detailsPanel!: HTMLDivElement;

	@query('.changes-list')
	private changesList?: HTMLDivElement;

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		// Reinitialize sortables when commits, hunks, or AI preview mode change
		if (
			changedProperties.has('selectedCommits') ||
			changedProperties.has('hunks') ||
			changedProperties.has('isPreviewMode') ||
			changedProperties.has('canMoveHunks')
		) {
			this.initializeHunksSortable();
			this.setupAutoScroll();
		}

		if (changedProperties.has('selectedCommits')) {
			this.updateCommitMessageStickyOffset();
		}
	}

	private updateCommitMessageStickyOffset() {
		if (!this.commitMessageResizeObserver) {
			this.commitMessageResizeObserver = new ResizeObserver(() => {
				const commitMessage = this.shadowRoot?.querySelector('gl-commit-message');
				if (commitMessage && this.changesList) {
					const height = commitMessage.getBoundingClientRect().height;
					this.changesList.style.setProperty('--file-header-sticky-top', `${height}px`);
				}
			});
		}

		this.commitMessageResizeObserver.disconnect();

		const commitMessage = this.shadowRoot?.querySelector('gl-commit-message');
		if (commitMessage) {
			this.commitMessageResizeObserver.observe(commitMessage);
			if (this.changesList) {
				const height = commitMessage.getBoundingClientRect().height;
				this.changesList.style.setProperty('--file-header-sticky-top', `${height}px`);
			}
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
		if (this.commitMessageResizeObserver) {
			this.commitMessageResizeObserver.disconnect();
			this.commitMessageResizeObserver = undefined;
		}
	}

	private destroyHunksSortables() {
		this.hunksSortables.forEach(sortable => sortable.destroy());
		this.hunksSortables = [];
	}

	private initializeHunksSortable() {
		this.destroyHunksSortables();

		// Don't initialize sortable in AI preview mode or when hunk moving is disabled
		if (this.isPreviewMode || !this.canMoveHunks) {
			return;
		}

		// Find all file hunks containers (could be multiple in split view)
		const fileHunksContainers = this.shadowRoot?.querySelectorAll('.file-hunks');
		fileHunksContainers?.forEach(hunksContainer => {
			const commitId = (hunksContainer as HTMLElement)
				.closest('[data-commit-id]')
				?.getAttribute('data-commit-id');
			const commit = this.selectedCommits.find(c => c.id === commitId);
			const isLocked = commit?.locked === true;

			const sortable = Sortable.create(hunksContainer as HTMLElement, {
				group: {
					name: 'hunks',
					pull: !isLocked,
					put: false,
				},
				animation: 0,
				dragClass: 'sortable-drag',
				selectedClass: 'sortable-selected',
				sort: false,
				filter: isLocked ? () => true : undefined,
				onStart: evt => {
					const draggedHunkId = evt.item.dataset.hunkId;
					if (draggedHunkId && this.selectedHunkIds.has(draggedHunkId) && this.selectedHunkIds.size > 1) {
						this.dispatchHunkDragStart(Array.from(this.selectedHunkIds));
					} else {
						this.dispatchHunkDragStart(draggedHunkId ? [draggedHunkId] : []);
					}

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

	private handleGenerateCommitMessage(commitId: string, e?: CustomEvent) {
		e?.preventDefault();
		e?.stopPropagation();

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

	private handleCollapseAllFiles() {
		this.defaultFilesExpanded = false;
	}

	private handleExpandAllFiles() {
		this.defaultFilesExpanded = true;
	}

	private renderFilesChangedHeader(fileCount: number | string) {
		return html`
			<div class="files-headline">
				<h3 class="files-headline__title">Files Changed (${fileCount})</h3>
				<div class="files-headline__actions">
					<gl-button appearance="toolbar" @click=${this.handleExpandAllFiles} tooltip="Expand All">
						<code-icon icon="expand-all"></code-icon>
					</gl-button>
					<gl-button appearance="toolbar" @click=${this.handleCollapseAllFiles} tooltip="Collapse All">
						<code-icon icon="collapse-all"></code-icon>
					</gl-button>
				</div>
			</div>
		`;
	}

	private renderFileHierarchy(hunks: ComposerHunk[]) {
		const fileGroups = groupHunksByFile(hunks);

		return Array.from(fileGroups.entries())
			.filter(([, fileHunks]) => fileHunks.length > 0) // Only show files that have hunks
			.map(([fileName, fileHunks]) => {
				return this.renderFile(fileName, fileHunks);
				// return this.renderFileOld(fileName, fileHunks);
			});
	}

	private renderFile(fileName: string, fileHunks: ComposerHunk[]) {
		// const fileChanges = getFileChanges(fileHunks);

		return html`<gl-diff-file
			.filename=${fileName}
			.hunks=${fileHunks}
			.defaultExpanded=${this.defaultFilesExpanded}
		></gl-diff-file>`;
	}

	// private renderFileOld(fileName: string, fileHunks: ComposerHunk[]) {
	// 	const fileChanges = getFileChanges(fileHunks);

	// 	return html`
	// 		<details open class="file-group">
	// 			<summary class="file-group__header">
	// 				<code-icon class="file-group__icon file-group__icon--open" icon="chevron-down"></code-icon>
	// 				<code-icon class="file-group__icon file-group__icon--closed" icon="chevron-right"></code-icon>
	// 				<div class="file-name">${fileName}</div>
	// 				<div class="file-stats" hidden>
	// 					<span class="additions">+${fileChanges.additions}</span>
	// 					<span class="deletions">-${fileChanges.deletions}</span>
	// 				</div>
	// 			</summary>
	// 			<div class="file-hunks">
	// 				${repeat(
	// 					fileHunks,
	// 					hunk => hunk.index,
	// 					hunk => html`
	// 						<gl-hunk-item
	// 							hidden
	// 							data-hunk-id=${hunk.index.toString()}
	// 							.hunkId=${hunk.index.toString()}
	// 							.fileName=${hunk.fileName}
	// 							.hunkHeader=${hunk.hunkHeader}
	// 							.content=${hunk.content}
	// 							.additions=${hunk.additions}
	// 							.deletions=${hunk.deletions}
	// 							.selected=${this.selectedHunkIds.has(hunk.index.toString())}
	// 							.isRename=${hunk.isRename || false}
	// 							.originalFileName=${hunk.originalFileName}
	// 							.isAIPreviewMode=${this.isAIPreviewMode}
	// 							@hunk-selected=${(e: CustomEvent) =>
	// 								this.dispatchHunkSelect(e.detail.hunkId, e.detail.shiftKey)}
	// 						></gl-hunk-item>
	// 						<gl-diff-hunk
	// 							.diffHeader=${hunk.diffHeader}
	// 							.hunkHeader=${hunk.hunkHeader}
	// 							.hunkContent=${hunk.content}
	// 						></gl-diff-hunk>
	// 					`,
	// 				)}
	// 			</div>
	// 		</details>
	// 	`;
	// }

	private dispatchHunkSelect(hunkId: string, shiftKey: boolean = false) {
		this.dispatchEvent(
			new CustomEvent('hunk-selected', {
				detail: { hunkId: hunkId, shiftKey: shiftKey },
				bubbles: true,
			}),
		);
	}

	public focusCommitMessageInput(commitId: string, checkValidity = false) {
		// Find the commit message textarea for the specified commit
		const commitElement = this.shadowRoot?.querySelector(
			`[data-commit-id="${commitId}"] gl-commit-message`,
		) as CommitMessage;
		if (commitElement) {
			commitElement.focus();
			// Select all text so user can start typing immediately
			commitElement.select(checkValidity);
		}
	}

	private renderUnassignedSectionDetails() {
		if (!this.selectedUnassignedSection) return nothing;

		const hunks = this.getHunksForSection(this.selectedUnassignedSection);

		return html`
			<article class="change-details">
				<gl-commit-message .message=${this.getSectionTitle(this.selectedUnassignedSection)}></gl-commit-message>

				<section>
					${this.renderFilesChangedHeader(getUniqueFileNames(hunks).length)}
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
			<article class="change-details" data-commit-id=${commit.id}>
				<gl-commit-message
					.message=${commit.message.content}
					.commitId=${commit.id}
					.explanation=${commit.aiExplanation}
					?ai-generated=${commit.message.isGenerated}
					?generating=${this.generatingCommitMessage === commit.id}
					?ai-enabled=${this.aiEnabled}
					.aiDisabledReason=${this.aiDisabledReason}
					?editable=${this.canEditCommitMessages && commit.locked !== true}
					@message-change=${(e: CustomEvent) => this.handleCommitMessageChange(commit.id, e.detail.message)}
					@generate-commit-message=${(e: CustomEvent) => this.handleGenerateCommitMessage(commit.id, e)}
				></gl-commit-message>

				<section>
					${this.renderFilesChangedHeader(getFileCountForCommit(commit, this.hunks))}
					<div class="files-list" data-commit-id=${commit.id}>${this.renderFileHierarchy(commitHunks)}</div>
				</section>
			</article>
		`;
	}

	private getHunksForSection(section: 'staged' | 'unstaged' | 'unassigned'): ComposerHunk[] {
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

	private getSectionTitle(section: 'staged' | 'unstaged' | 'unassigned'): string {
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

	private renderCompositionSummary() {
		if (!this.compositionSummarySelected) return nothing;

		// Generate the composition summary markdown
		const summaryMarkdown = generateComposerMarkdown(this.commits, this.hunks);

		return html`
			<article class="change-details composition-summary">
				<gl-markdown density="document" .markdown=${summaryMarkdown}></gl-markdown>
			</article>
		`;
	}

	override render() {
		// Handle no changes state
		if (!this.hasChanges) {
			return html`
				<div class="details-panel" @click=${this.handlePanelClick}>
					<div class="changes-list scrollable">${this.renderNoChangesState()}</div>
				</div>
			`;
		}

		const isMultiSelect = this.selectedCommits.length > 1;

		return html`
			<div class="details-panel ${isMultiSelect ? 'split-view' : ''}" @click=${this.handlePanelClick}>
				<div class="changes-list scrollable">${this.renderDetails()}</div>
			</div>
		`;
	}

	private handlePanelClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		const tagName = target.tagName.toLowerCase();

		const interactiveTags = ['input', 'textarea', 'button', 'a', 'select', 'gl-button', 'gl-commit-message'];
		const isInteractive =
			interactiveTags.includes(tagName) ||
			target.closest('gl-commit-message, gl-button, button, a, input, textarea, select');

		if (!isInteractive) {
			const activeElement = this.shadowRoot?.activeElement;
			if (activeElement && 'blur' in activeElement && typeof activeElement.blur === 'function') {
				activeElement.blur();
			}
		}
	}

	private renderNoChangesState() {
		return html`
			<div class="no-changes-state">
				<h2 class="no-changes-title">Commit Composer Needs Something to Compose</h2>
				<p class="no-changes-description">
					Commit Composer helps you organize changes into meaningful commits before committing them and can
					leverage AI to do this automatically.
				</p>
				<p class="no-changes-description">
					Make some working directory changes and Reload or come back to this view to see how it works.
				</p>
				<!-- <nav class="no-changes-actions"> -->
				<button-container layout="editor" grouping="gap-wide">
					<gl-button full appearance="secondary" @click=${this.handleClose}>Close</gl-button>
					<gl-button full @click=${this.handleReload}>Reload</gl-button>
				</button-container>
			</div>
		`;
	}

	private handleClose() {
		this.dispatchEvent(
			new CustomEvent('close-composer', {
				bubbles: true,
			}),
		);
	}

	private handleReload() {
		this.dispatchEvent(
			new CustomEvent('reload-composer', {
				bubbles: true,
			}),
		);
	}

	private renderDetails() {
		if (this.compositionSummarySelected) {
			return this.renderCompositionSummary();
		}

		if (this.selectedUnassignedSection) {
			return this.renderUnassignedSectionDetails();
		}

		if (this.selectedCommits.length === 0) {
			return html`<p class="empty-state">
				<code-icon class="empty-state__icon" icon="list-unordered"></code-icon><br />
				Select a commit or unassigned changes to view details
			</p>`;
		}

		return repeat(
			this.selectedCommits,
			commit => commit.id,
			commit => this.renderCommitDetails(commit),
		);
	}
}
