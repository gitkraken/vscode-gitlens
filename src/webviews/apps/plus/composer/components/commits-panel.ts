import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import Sortable from 'sortablejs';
import type { ComposerCommit, ComposerHunk } from '../../../../plus/composer/protocol';
import {
	getCommitChanges,
	getFileChanges,
	getFileCountForCommit,
	getUnassignedHunks,
	getUniqueFileNames,
} from '../../../../plus/composer/utils';
import '../../../shared/components/button';
import './commit-item';

@customElement('gl-commits-panel')
export class CommitsPanel extends LitElement {
	static override styles = [
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
				gap: 1.2rem;
			}

			.commits-header {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.commits-header h3 {
				margin: 0;
			}

			.commits-header small {
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
			}

			.commits-actions {
				min-height: 40px;
				display: flex;
				align-items: center;
				justify-content: center;
				gap: 0.8rem;
				padding: 0.8rem;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				background: var(--vscode-editorGroupHeader-tabsBackground);
			}

			.commits-actions:empty {
				display: none;
			}

			.commits-actions gl-button {
				min-width: 160px;
				padding-left: 1.6rem;
				padding-right: 1.6rem;
			}

			.commits-list {
				flex: 1;
				overflow-y: auto;
				padding: 0.5rem;
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
			}

			.commits-only {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
			}

			.unassigned-section {
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				padding: 0.75rem;
				cursor: pointer;
				transition: background-color 0.2s ease;
			}

			.unassigned-section:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.unassigned-section.selected {
				background: var(--vscode-list-activeSelectionBackground);
				border-color: var(--vscode-focusBorder);
			}

			.unassigned-header {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				font-weight: 500;
			}

			.unassigned-summary {
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				margin-top: 0.25rem;
				display: flex;
				align-items: center;
				gap: 0.5rem;
			}

			.unassigned-summary .file-count {
				color: var(--vscode-foreground);
			}

			.unassigned-summary .diff-stats {
				display: flex;
				align-items: center;
				gap: 0.3rem;
				font-weight: 500;
			}

			.unassigned-summary .additions {
				color: var(--vscode-gitDecoration-addedResourceForeground);
			}

			.unassigned-summary .deletions {
				color: var(--vscode-gitDecoration-deletedResourceForeground);
			}

			.new-commit-drop-zone {
				min-height: 60px;
				border: 2px dashed var(--vscode-panel-border);
				border-radius: 4px;
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
				margin-top: 0.5rem;
				transition: all 0.2s ease;
				position: relative;
				z-index: 5; /* Lower z-index than unassign zone */
			}

			.new-commit-drop-zone.drag-over {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-list-dropBackground);
				box-shadow: 0 0 8px var(--vscode-focusBorder);
			}

			.sortable-ghost-hidden {
				display: none !important;
			}

			.unassign-drop-zone {
				min-height: 60px;
				border: 2px dashed var(--vscode-errorForeground);
				border-radius: 4px;
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--vscode-errorForeground);
				font-size: 0.9em;
				margin-top: 0.5rem;
				transition: all 0.2s ease;
				background-color: var(--vscode-inputValidation-errorBackground);
				position: relative;
				z-index: 10; /* Higher z-index to prioritize over new commit zone */
			}

			.unassign-drop-zone.hidden {
				display: none;
			}

			.unassign-drop-zone.drag-over {
				border-color: var(--vscode-errorForeground);
				background-color: var(--vscode-inputValidation-errorBackground);
			}

			.drop-zone-content {
				display: flex;
				align-items: center;
				justify-content: center;
				gap: 0.5rem;
			}

			gl-commit-item {
				display: block;
				cursor: grab;
			}

			gl-commit-item:active {
				cursor: grabbing;
			}

			.commit-item.sortable-chosen {
				opacity: 0.5;
			}

			.commit-item.sortable-ghost {
				opacity: 0.3;
			}

			.commit-item.drag-over {
				box-shadow: 0 0 8px var(--vscode-focusBorder);
				border: 2px solid var(--vscode-focusBorder);
			}

			.sortable-ghost-hidden {
				display: none !important;
			}
		`,
	];

	@property({ type: Array })
	commits: ComposerCommit[] = [];

	@property({ type: Array })
	hunks: ComposerHunk[] = [];

	@property({ type: String })
	selectedCommitId: string | null = null;

	@property({ type: Object })
	selectedCommitIds: Set<string> = new Set();

	@property({ type: String })
	selectedUnassignedSection: string | null = null;

	@property({ type: Boolean })
	canFinishAndCommit: boolean = true;

	@property({ type: Boolean })
	generating: boolean = false;

	@property({ type: Boolean })
	committing: boolean = false;

	private commitsSortable?: Sortable;
	private isDraggingHunks = false;
	private draggedHunkIds: string[] = [];

	override firstUpdated() {
		this.initializeSortable();
		this.initializeDropZones();
		this.addEventListener('hunk-drag-start', this.handleHunkDragStart.bind(this));
		this.addEventListener('hunk-drag-end', this.handleHunkDragEnd.bind(this));
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		// Reinitialize sortables when commits change
		if (changedProperties.has('commits')) {
			// Destroy existing sortable first
			this.commitsSortable?.destroy();

			// Reinitialize both commit sortable and drop zones
			this.initializeSortable();
			this.initializeCommitDropZones();
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback?.();
		this.commitsSortable?.destroy();
	}

	private initializeSortable() {
		const commitsContainer = this.shadowRoot?.querySelector('.commits-only');
		if (commitsContainer) {
			this.commitsSortable = Sortable.create(commitsContainer as HTMLElement, {
				animation: 150,
				ghostClass: 'sortable-ghost',
				chosenClass: 'sortable-chosen',
				dragClass: 'sortable-drag',
				group: {
					name: 'commits',
					pull: false,
					put: false,
				},
				onEnd: evt => {
					if (evt.oldIndex !== undefined && evt.newIndex !== undefined && evt.oldIndex !== evt.newIndex) {
						this.dispatchCommitReorder(evt.oldIndex, evt.newIndex);
					}
				},
			});
		}
	}

	private initializeDropZones() {
		// Initialize drop zone for creating new commits (native drag and drop)
		const newCommitZone = this.shadowRoot?.querySelector('.new-commit-drop-zone');
		if (newCommitZone) {
			this.setupNativeDropZone(newCommitZone as HTMLElement, 'new-commit');
		}

		// Initialize drop zone for unassigning hunks (native drag and drop)
		const unassignZone = this.shadowRoot?.querySelector('.unassign-drop-zone');
		if (unassignZone) {
			this.setupNativeDropZone(unassignZone as HTMLElement, 'unassign');
		}

		// Initialize drop zones for existing commits (native drag and drop)
		this.initializeCommitDropZones();
	}

	private initializeCommitDropZones() {
		const commitItems = this.shadowRoot?.querySelectorAll('gl-commit-item');

		commitItems?.forEach(commitItem => {
			this.setupNativeDropZone(commitItem as HTMLElement, 'commit');
		});
	}

	private setupNativeDropZone(element: HTMLElement, type: 'new-commit' | 'unassign' | 'commit') {
		// Make element accept drops
		element.addEventListener('dragover', e => {
			e.preventDefault();
			const dragEvent = e;
			if (dragEvent.dataTransfer) {
				dragEvent.dataTransfer.dropEffect = 'move';
			}
			element.classList.add('drag-over');
		});

		element.addEventListener('dragleave', e => {
			e.preventDefault();
			const dragEvent = e;
			// Only remove if we're actually leaving the element
			if (!element.contains(dragEvent.relatedTarget as Node)) {
				element.classList.remove('drag-over');
			}
		});

		element.addEventListener('drop', e => {
			e.preventDefault();
			element.classList.remove('drag-over');

			// Get dragged hunk IDs from the global drag state
			const hunkIds = this.isDraggingHunks ? this.draggedHunkIds : [];

			if (hunkIds.length > 0) {
				switch (type) {
					case 'new-commit':
						this.dispatchCreateNewCommit(hunkIds);
						break;
					case 'unassign':
						this.dispatchUnassignHunks(hunkIds);
						break;
					case 'commit': {
						const commitId = (element as any).commitId;
						if (commitId) {
							this.dispatchMoveHunksToCommit(hunkIds, commitId);
						}
						break;
					}
				}
			}
		});
	}

	private dispatchCommitReorder(oldIndex: number, newIndex: number) {
		this.dispatchEvent(
			new CustomEvent('commit-reorder', {
				detail: { oldIndex: oldIndex, newIndex: newIndex },
				bubbles: true,
			}),
		);
	}

	private dispatchCreateNewCommit(hunkIds: string[]) {
		this.dispatchEvent(
			new CustomEvent('create-new-commit', {
				detail: { hunkIds: hunkIds },
				bubbles: true,
			}),
		);
	}

	private dispatchUnassignHunks(hunkIds: string[]) {
		this.dispatchEvent(
			new CustomEvent('unassign-hunks', {
				detail: { hunkIds: hunkIds },
				bubbles: true,
			}),
		);
	}

	private dispatchMoveHunksToCommit(hunkIds: string[], targetCommitId: string) {
		this.dispatchEvent(
			new CustomEvent('move-hunks-to-commit', {
				detail: { hunkIds: hunkIds, targetCommitId: targetCommitId },
				bubbles: true,
			}),
		);
	}

	private handleHunkDragStart(event: Event) {
		const customEvent = event as CustomEvent;
		this.isDraggingHunks = true;
		this.draggedHunkIds = customEvent.detail.hunkIds || [];
		this.requestUpdate(); // Re-render to show unassign drop zone

		// Add hover effects to drop zones
		this.addDropZoneHoverEffects();
	}

	private addDropZoneHoverEffects() {
		const commitItems = this.shadowRoot?.querySelectorAll('.commit-item');
		const newCommitZone = this.shadowRoot?.querySelector('.new-commit-drop-zone');
		const unassignZone = this.shadowRoot?.querySelector('.unassign-drop-zone');

		commitItems?.forEach(item => {
			item.addEventListener('dragenter', this.handleDragEnter);
			item.addEventListener('dragleave', this.handleDragLeave);
		});

		if (newCommitZone) {
			newCommitZone.addEventListener('dragenter', this.handleDragEnter);
			newCommitZone.addEventListener('dragleave', this.handleDragLeave);
		}

		if (unassignZone) {
			unassignZone.addEventListener('dragenter', this.handleDragEnter);
			unassignZone.addEventListener('dragleave', this.handleDragLeave);
		}
	}

	private removeDropZoneHoverEffects() {
		const commitItems = this.shadowRoot?.querySelectorAll('.commit-item');
		const newCommitZone = this.shadowRoot?.querySelector('.new-commit-drop-zone');
		const unassignZone = this.shadowRoot?.querySelector('.unassign-drop-zone');

		commitItems?.forEach(item => {
			item.removeEventListener('dragenter', this.handleDragEnter);
			item.removeEventListener('dragleave', this.handleDragLeave);
			item.classList.remove('drag-over');
		});

		if (newCommitZone) {
			newCommitZone.removeEventListener('dragenter', this.handleDragEnter);
			newCommitZone.removeEventListener('dragleave', this.handleDragLeave);
			newCommitZone.classList.remove('drag-over');
		}

		if (unassignZone) {
			unassignZone.removeEventListener('dragenter', this.handleDragEnter);
			unassignZone.removeEventListener('dragleave', this.handleDragLeave);
			unassignZone.classList.remove('drag-over');
		}
	}

	private handleDragEnter = (e: Event) => {
		e.preventDefault();
		(e.currentTarget as HTMLElement).classList.add('drag-over');
	};

	private handleDragLeave = (e: Event) => {
		e.preventDefault();
		(e.currentTarget as HTMLElement).classList.remove('drag-over');
	};

	private get shouldShowUnassignZone(): boolean {
		if (!this.isDraggingHunks || this.draggedHunkIds.length === 0) return false;

		// Check if any of the dragged hunks are assigned to commits
		const draggedIndices = this.draggedHunkIds.map(id => parseInt(id, 10));

		// A hunk is assigned if it's in any commit's hunkIndices
		const assignedIndices = new Set<number>();
		this.commits.forEach(commit => {
			commit.hunkIndices.forEach(index => assignedIndices.add(index));
		});

		return draggedIndices.some(index => assignedIndices.has(index));
	}

	private handleHunkDragEnd() {
		this.isDraggingHunks = false;
		this.draggedHunkIds = [];
		this.removeDropZoneHoverEffects();
		this.requestUpdate(); // Re-render to hide unassign drop zone
	}

	private dispatchCommitSelect(commitId: string, multiSelect: boolean = false) {
		this.dispatchEvent(
			new CustomEvent('commit-select', {
				detail: { commitId: commitId, multiSelect: multiSelect },
				bubbles: true,
			}),
		);
	}

	private dispatchUnassignedSelect(section: string) {
		this.dispatchEvent(
			new CustomEvent('unassigned-select', {
				detail: { section: section },
				bubbles: true,
			}),
		);
	}

	private dispatchCombineCommits() {
		this.dispatchEvent(
			new CustomEvent('combine-commits', {
				bubbles: true,
			}),
		);
	}

	private dispatchFinishAndCommit() {
		this.dispatchEvent(
			new CustomEvent('finish-and-commit', {
				bubbles: true,
			}),
		);
	}

	private dispatchGenerateCommitsWithAI() {
		this.dispatchEvent(
			new CustomEvent('generate-commits-with-ai', {
				bubbles: true,
			}),
		);
	}

	private renderUnassignedSection() {
		const unassignedHunks = getUnassignedHunks(this.hunks);
		const sections = [];

		if (unassignedHunks.staged.length > 0) {
			const fileCount = getUniqueFileNames(unassignedHunks.staged).length;
			const changes = getFileChanges(unassignedHunks.staged);
			sections.push({
				key: 'staged',
				title: 'Staged Changes',
				fileCount: fileCount,
				changes: changes,
			});
		}
		if (unassignedHunks.unstaged.length > 0) {
			const fileCount = getUniqueFileNames(unassignedHunks.unstaged).length;
			const changes = getFileChanges(unassignedHunks.unstaged);
			sections.push({
				key: 'unstaged',
				title: 'Unstaged Changes',
				fileCount: fileCount,
				changes: changes,
			});
		}
		if (unassignedHunks.unassigned.length > 0) {
			const fileCount = getUniqueFileNames(unassignedHunks.unassigned).length;
			const changes = getFileChanges(unassignedHunks.unassigned);
			sections.push({
				key: 'unassigned',
				title: 'Unassigned Changes',
				fileCount: fileCount,
				changes: changes,
			});
		}

		return sections.map(
			section => html`
				<div
					class="unassigned-section ${this.selectedUnassignedSection === section.key ? 'selected' : ''}"
					@click=${() => this.dispatchUnassignedSelect(section.key)}
				>
					<div class="unassigned-header">
						<code-icon icon="diff"></code-icon>
						${section.title}
					</div>
					<div class="unassigned-summary">
						<span class="file-count"
							>${section.fileCount} ${section.fileCount === 1 ? 'file' : 'files'}</span
						>
						<span class="diff-stats">
							<span class="additions">+${section.changes.additions}</span>
							<span class="deletions">-${section.changes.deletions}</span>
						</span>
					</div>
				</div>
			`,
		);
	}

	override render() {
		return html`
			<div class="commits-header">
				<h3>Commits (${this.commits.length})</h3>
				<small>Shift+click to multi-select</small>
			</div>
			<div class="commits-actions">
				${when(
					this.selectedCommitIds.size > 1,
					() => html`
						<gl-button
							appearance="secondary"
							?disabled=${this.generating || this.committing}
							@click=${this.dispatchCombineCommits}
						>
							Combine ${this.selectedCommitIds.size} Commits
						</gl-button>
					`,
					() =>
						when(
							this.commits.length === 0,
							() => html`
								<gl-button
									appearance="primary"
									?disabled=${this.generating || this.committing}
									@click=${this.dispatchGenerateCommitsWithAI}
								>
									<code-icon
										icon=${this.generating ? 'loading~spin' : 'sparkle'}
										slot="prefix"
									></code-icon>
									${this.generating ? 'Generating Commits...' : 'Generate Commits with AI'}
								</gl-button>
							`,
							() => html`
								<gl-button
									appearance="primary"
									?disabled=${!this.canFinishAndCommit || this.generating || this.committing}
									@click=${this.dispatchFinishAndCommit}
								>
									<code-icon icon=${this.committing ? 'loading~spin' : ''} slot="prefix"></code-icon>
									${this.committing ? 'Committing...' : 'Finish and Commit'}
								</gl-button>
							`,
						),
				)}
			</div>
			<div class="commits-list">
				${this.renderUnassignedSection()}

				<div class="commits-only">
					${repeat(
						this.commits,
						commit => commit.id,
						commit => {
							const changes = getCommitChanges(commit, this.hunks);
							return html`
								<gl-commit-item
									.commitId=${commit.id}
									.message=${commit.message}
									.fileCount=${getFileCountForCommit(commit, this.hunks)}
									.additions=${changes.additions}
									.deletions=${changes.deletions}
									.selected=${this.selectedCommitId === commit.id}
									.multiSelected=${this.selectedCommitIds.has(commit.id)}
									@click=${(e: MouseEvent) => this.dispatchCommitSelect(commit.id, e.shiftKey)}
								></gl-commit-item>
							`;
						},
					)}
				</div>

				<!-- Drop zone for creating new commits -->
				<div class="new-commit-drop-zone">
					<div class="drop-zone-content">
						<code-icon icon="plus"></code-icon>
						<span>Drop hunks here to create new commit</span>
					</div>
				</div>

				<!-- Drop zone for unassigning hunks (hidden when not dragging) -->
				<div class="unassign-drop-zone ${this.shouldShowUnassignZone ? '' : 'hidden'}">
					<div class="drop-zone-content">
						<code-icon icon="trash"></code-icon>
						<span>Drop hunks here to unassign</span>
					</div>
				</div>
			</div>
		`;
	}
}
