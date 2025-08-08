import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import Sortable from 'sortablejs';
import type { ComposerBaseCommit, ComposerCommit, ComposerHunk } from '../../../../plus/composer/protocol';
import {
	getCommitChanges,
	getFileChanges,
	getFileCountForCommit,
	getUnassignedHunks,
	getUniqueFileNames,
} from '../../../../plus/composer/utils';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import './commit-item';

@customElement('gl-commits-panel')
export class CommitsPanel extends LitElement {
	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		scrollableBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
				gap: 1.2rem;
			}

			.commits-header {
				font-size: 1.4rem;
				margin-block: 1.7rem 0.4rem;
			}

			.commits-actions {
				min-height: 40px;
				padding: 0.8rem;
				border-top: 1px solid var(--vscode-panel-border);
				background: var(--vscode-sideBar-background);
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
				overflow-y: auto;
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.commits-only {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.unassigned-section {
				background: var(--composer-background-05);
				border: 1px dashed var(--vscode-panel-border);
				border-radius: 12px;
				padding: 0.75rem;
				cursor: pointer;
				transition: background-color 0.2s ease;
				/* margin-bottom: 0.5rem; */
			}

			.unassigned-section:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.unassigned-section.selected {
				background: var(--vscode-list-activeSelectionBackground);
			}

			.add-to-draft-button-container {
				margin-top: 0.8rem;
			}

			.auto-compose-review-text {
				text-align: center;
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				margin-top: 0.8rem;
			}

			.ai-model-picker {
				display: inline-flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4rem;
				padding: 0.3rem 0.8rem;
				margin-bottom: 0.8rem;
				background: rgba(255, 255, 255, 0.15);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 50px;
				cursor: pointer;
				transition: background-color 0.2s ease;
				max-width: 100%;
				text-decoration: none;
				color: var(--vscode-foreground);
				font-size: 1.2rem;
			}

			.ai-model-picker:hover {
				text-decoration: none;
				background: rgba(255, 255, 255, 0.2);
			}

			.ai-model-picker-text {
			}

			.ai-model-picker-icon {
				transform: translateY(-1px);
			}

			.composition-summary-section {
				margin-bottom: 1.2rem;
			}

			.composition-summary-header {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
				margin: 1.2rem 0 0.8rem 0;
			}

			.composition-summary-header h3 {
				margin: 0;
			}

			.composition-summary-card {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				padding: 0.8rem;
				background: var(--vscode-editorGroupHeader-tabsBackground);
				border: 1px solid var(--d2h-file-header-border-color);
				border-radius: 4px;
				cursor: pointer;
				transition: background-color 0.2s ease;
			}

			.composition-summary-card:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.composition-summary-card.selected {
				background: var(--vscode-list-activeSelectionBackground);
			}

			.composition-summary-label {
				font-weight: 500;
				color: var(--vscode-foreground);
			}

			.composition-feedback-row {
				display: flex;
				align-items: center;
				justify-content: space-between;
				margin: 0.8rem 0;
				font-size: 0.9em;
			}

			.composition-feedback-text {
				color: var(--vscode-foreground);
			}

			.composition-feedback-icons {
				display: flex;
				gap: 0.5rem;
			}

			.composition-feedback-icon {
				cursor: pointer;
				padding: 0.2rem;
				border-radius: 3px;
				transition: background-color 0.2s ease;
				color: var(--vscode-foreground);
			}

			.composition-feedback-icon:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.composition-feedback-icon.selected {
				color: var(--vscode-button-foreground);
				background: var(--vscode-button-background);
			}

			.composition-instructions {
				font-size: 0.85em;
				color: var(--vscode-descriptionForeground);
				margin-top: 0.8rem;
				line-height: 1.4;
			}

			/* Finish & Commit section styles */
			.finish-commit-section {
			}

			.finish-commit-header {
				margin-block-end: 1.2rem;
			}

			.finish-commit-header h3 {
				font-size: 1.4rem;
				margin-block: 0 0.4rem;
			}

			.finish-commit-subtext {
				font-size: 1.2rem;
				color: var(--vscode-descriptionForeground);
				margin-block: 0;
			}

			.commit-message-row {
				display: flex;
				align-items: center;
				gap: 0.8rem;
			}

			.commit-message-button {
				flex: 1;
			}

			.cancel-button-container {
				margin-top: 1.2rem;
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

			/* Base commit styles */
			.base-commit {
				background: var(--vscode-editor-background);
				border-radius: 12px;
				opacity: 0.7;
				pointer-events: none;
				display: flex;
				align-items: stretch;
				min-height: 60px;
			}

			.base-commit-icon {
				display: flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				flex-shrink: 0;
				position: relative;
				padding-left: 0.4rem;
			}

			.base-commit-icon::before {
				content: '';
				position: absolute;
				left: calc(50% + 0.4rem);
				top: 0;
				bottom: 0;
				width: 2px;
				background: var(--vscode-descriptionForeground);
				transform: translateX(-50%);
				opacity: 0.7;
			}

			.base-commit-icon::after {
				content: '';
				position: absolute;
				left: calc(50% + 0.4rem);
				top: 50%;
				width: 20px;
				height: 20px;
				background: var(--vscode-editorGroupHeader-tabsBackground);
				border: 2px solid var(--vscode-descriptionForeground);
				border-radius: 50%;
				transform: translate(-50%, -50%);
				z-index: 1;
			}

			.base-commit-content {
				flex: 1;
				display: flex;
				flex-direction: column;
				justify-content: center;
				padding: 1.2rem;
				gap: 0.4rem;
			}

			.base-commit-message {
				color: var(--vscode-descriptionForeground);
				font-weight: 500;
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
				line-height: 1.4;
			}

			.base-commit-details {
				display: flex;
				align-items: center;
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
			}

			.repo-name,
			.branch-name {
				color: var(--vscode-descriptionForeground);
			}

			/* Auto-Compose container styles */
			.auto-compose-container {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				padding: 1.2rem;
				background: linear-gradient(135deg, #a100ff1a 0%, #255ed11a 100%);
			}

			.auto-compose-header {
				font-size: 1.2rem;
				color: var(--vscode-foreground);
				margin-block: 0 0.4rem;
			}

			.auto-compose-description {
				font-size: 1.2rem;
				color: var(--vscode-descriptionForeground);
				line-height: 1.4;
				margin-block: 0 1.6rem;
			}

			.custom-instructions-container {
				margin-bottom: 1rem;
			}

			.custom-instructions-input {
				width: 100%;
				padding: 0.6rem;
				border: 1px solid var(--vscode-input-border);
				border-radius: 3px;
				background: transparent;
				color: var(--vscode-input-foreground);
				font-family: inherit;
				font-size: 1rem;
				resize: vertical;
				min-height: 2.4rem;
			}

			.custom-instructions-input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.custom-instructions-input:focus {
				outline: none;
				border-color: var(--vscode-focusBorder);
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

	@property({ type: Boolean })
	aiEnabled: boolean = false;

	@property({ type: Boolean })
	isPreviewMode: boolean = false;

	@property({ type: Object })
	baseCommit: ComposerBaseCommit | null = null;

	@property({ type: String })
	customInstructions: string = '';

	@property({ type: Boolean })
	hasUsedAutoCompose: boolean = false;

	@property({ type: Object })
	aiModel: any = undefined;

	@property({ type: Boolean })
	compositionSummarySelected: boolean = false;

	@property({ type: String })
	compositionFeedback: 'helpful' | 'unhelpful' | null = null;

	@property({ type: String })
	compositionSessionId: string | null = null;

	@property({ type: Boolean })
	isReadyToCommit: boolean = false;

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

		// Reinitialize sortables when commits change or AI preview mode changes
		if (changedProperties.has('commits') || changedProperties.has('isPreviewMode')) {
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
		// Don't initialize sortable in AI preview mode
		if (this.isPreviewMode) {
			return;
		}

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
		// Don't initialize drop zones in AI preview mode
		if (this.isPreviewMode) {
			return;
		}

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
		// Don't initialize commit drop zones in AI preview mode
		if (this.isPreviewMode) {
			return;
		}

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
			// Only add drag-over class if we're dragging hunks, not commits
			if (this.isDraggingHunks) {
				element.classList.add('drag-over');
			}
		});

		element.addEventListener('dragleave', e => {
			e.preventDefault();
			const dragEvent = e;
			// Only remove if we're actually leaving the element and we were dragging hunks
			if (!element.contains(dragEvent.relatedTarget as Node) && this.isDraggingHunks) {
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

	private get shouldShowNewCommitZone(): boolean {
		return this.isDraggingHunks && this.draggedHunkIds.length > 0;
	}

	private get firstCommitWithoutMessage(): ComposerCommit | null {
		// Find the first commit that doesn't have a message
		return this.commits.find(commit => !commit.message || commit.message.trim().length === 0) || null;
	}

	private get shouldShowAddToDraftButton(): boolean {
		// Show button only when there is exactly one commit (regardless of message content)
		return this.commits.length === 1;
	}

	private get aiModelDisplayName(): string {
		if (!this.aiModel) {
			return 'Choose AI Model';
		}
		return (this.aiModel.name as string) || 'Unknown Model';
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

	private dispatchFocusCommitMessage(commitId?: string) {
		// Focus the commit message input for the specified commit or first commit
		const targetCommitId = commitId || (this.commits.length > 0 ? this.commits[0].id : null);
		if (targetCommitId) {
			this.dispatchEvent(
				new CustomEvent('focus-commit-message', {
					detail: { commitId: targetCommitId, checkValidity: true },
					bubbles: true,
				}),
			);
		}
	}

	private dispatchGenerateCommitsWithAI() {
		// Mark that auto-compose has been used
		this.hasUsedAutoCompose = true;

		this.dispatchEvent(
			new CustomEvent('generate-commits-with-ai', {
				detail: {
					customInstructions: this.customInstructions,
				},
				bubbles: true,
			}),
		);
	}

	private handleAddAllToDraftCommit(sectionKey: string) {
		// Get all hunks from the specified section
		const unassignedHunks = getUnassignedHunks(this.hunks);
		let hunksToAdd: ComposerHunk[] = [];

		switch (sectionKey) {
			case 'unstaged':
				hunksToAdd = unassignedHunks.unstaged;
				break;
			case 'staged':
				hunksToAdd = unassignedHunks.staged;
				break;
			case 'unassigned':
				hunksToAdd = unassignedHunks.unassigned;
				break;
		}

		if (hunksToAdd.length === 0 || this.commits.length !== 1) return;

		// Dispatch event to add all hunks to the draft commit
		this.dispatchEvent(
			new CustomEvent('add-hunks-to-commit', {
				detail: {
					commitId: this.commits[0].id,
					hunkIndices: hunksToAdd.map(hunk => hunk.index),
				},
				bubbles: true,
			}),
		);
	}

	private handleGenerateCommitMessageWithAI() {
		if (this.commits.length !== 1) return;

		// Dispatch event to generate commit message for the draft commit
		this.dispatchEvent(
			new CustomEvent('generate-commit-message', {
				detail: {
					commitId: this.commits[0].id,
				},
				bubbles: true,
			}),
		);
	}

	private handleAIModelPickerClick() {
		// Dispatch event to open AI model picker
		this.dispatchEvent(
			new CustomEvent('select-ai-model', {
				bubbles: true,
			}),
		);
	}

	private handleCompositionSummaryClick() {
		// Dispatch event to show composition summary
		this.dispatchEvent(
			new CustomEvent('select-composition-summary', {
				bubbles: true,
			}),
		);
	}

	private handleCompositionFeedbackHelpful() {
		// Prevent duplicate feedback for the same session
		if (this.compositionFeedback === 'helpful') return;

		this.compositionFeedback = 'helpful';
		this.dispatchEvent(
			new CustomEvent('composition-feedback-helpful', {
				detail: { sessionId: this.compositionSessionId },
				bubbles: true,
			}),
		);
	}

	private handleCompositionFeedbackUnhelpful() {
		// Prevent duplicate feedback for the same session
		if (this.compositionFeedback === 'unhelpful') return;

		this.compositionFeedback = 'unhelpful';
		this.dispatchEvent(
			new CustomEvent('composition-feedback-unhelpful', {
				detail: { sessionId: this.compositionSessionId },
				bubbles: true,
			}),
		);
	}

	private handleCreateCommitsClick() {
		if (this.isReadyToCommit) {
			// All commits have messages, proceed with committing
			this.dispatchFinishAndCommit();
		} else {
			// Find first commit without message and focus it
			const firstCommitWithoutMessage = this.firstCommitWithoutMessage;
			if (firstCommitWithoutMessage) {
				this.dispatchFocusCommitMessage(firstCommitWithoutMessage.id);
			}
		}
	}

	private handleCancel() {
		// Dispatch event to close the composer webview
		this.dispatchEvent(
			new CustomEvent('cancel-composer', {
				bubbles: true,
			}),
		);
	}

	private handleCustomInstructionsChange(e: Event) {
		const input = e.target as HTMLInputElement;
		this.customInstructions = input.value;

		// Dispatch event to notify app component of custom instructions change
		this.dispatchEvent(
			new CustomEvent('custom-instructions-change', {
				detail: { customInstructions: this.customInstructions },
				bubbles: true,
			}),
		);
	}

	private renderUnassignedSection() {
		const unassignedHunks = getUnassignedHunks(this.hunks);
		const sections = [];

		// Order: Unstaged first, then Staged, then Changes from Commits
		if (unassignedHunks.unstaged.length > 0) {
			const fileCount = getUniqueFileNames(unassignedHunks.unstaged).length;
			const changes = getFileChanges(unassignedHunks.unstaged);
			sections.push({
				key: 'unstaged',
				title: 'Working Changes (Unstaged)',
				fileCount: fileCount,
				changes: changes,
			});
		}
		if (unassignedHunks.staged.length > 0) {
			const fileCount = getUniqueFileNames(unassignedHunks.staged).length;
			const changes = getFileChanges(unassignedHunks.staged);
			sections.push({
				key: 'staged',
				title: 'Working Changes (Staged)',
				fileCount: fileCount,
				changes: changes,
			});
		}
		if (unassignedHunks.unassigned.length > 0) {
			const fileCount = getUniqueFileNames(unassignedHunks.unassigned).length;
			const changes = getFileChanges(unassignedHunks.unassigned);
			sections.push({
				key: 'unassigned',
				title: 'Changes from Commits',
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
						<code-icon icon="diff-single"></code-icon>
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
					${when(
						this.shouldShowAddToDraftButton,
						() => html`
							<button-container layout="editor" class="add-to-draft-button-container">
								<gl-button
									full
									appearance="secondary"
									@click=${(e: Event) => {
										e.stopPropagation();
										this.handleAddAllToDraftCommit(section.key);
									}}
								>
									<code-icon icon="plus" slot="prefix"></code-icon>
									Add All to Draft Commit
								</gl-button>
							</button-container>
						`,
					)}
				</div>
			`,
		);
	}

	private renderCompositionSummarySection() {
		return html`
			<div class="composition-summary-section">
				<div class="composition-summary-header">
					<h3>Composition Summary</h3>
				</div>
				<div
					class="composition-summary-card ${this.compositionSummarySelected ? 'selected' : ''}"
					@click=${this.handleCompositionSummaryClick}
				>
					<code-icon icon="note"></code-icon>
					<span class="composition-summary-label">Auto-composition Summary</span>
				</div>

				<!-- Feedback row -->
				<div class="composition-feedback-row">
					<span class="composition-feedback-text">Was this composition helpful?</span>
					<div class="composition-feedback-icons">
						<code-icon
							icon=${this.compositionFeedback === 'helpful' ? 'thumbsup-filled' : 'thumbsup'}
							class="composition-feedback-icon ${this.compositionFeedback === 'helpful'
								? 'selected'
								: ''}"
							@click=${this.handleCompositionFeedbackHelpful}
						></code-icon>
						<code-icon
							icon=${this.compositionFeedback === 'unhelpful' ? 'thumbsdown-filled' : 'thumbsdown'}
							class="composition-feedback-icon ${this.compositionFeedback === 'unhelpful'
								? 'selected'
								: ''}"
							@click=${this.handleCompositionFeedbackUnhelpful}
						></code-icon>
					</div>
				</div>

				<!-- Instructions -->
				<div class="composition-instructions">
					Review the auto-generated draft commits below to inspect diffs and modify commit messages.
				</div>
			</div>
		`;
	}

	override render() {
		return html`
			<div class="commits-list scrollable">
				${this.hasUsedAutoCompose ? this.renderCompositionSummarySection() : this.renderUnassignedSection()}

				<h3 class="commits-header">Draft Commits</h3>

				<!-- Drop zone for creating new commits (only visible when dragging hunks in interactive mode) -->
				${when(
					!this.isPreviewMode && this.shouldShowNewCommitZone,
					() => html`
						<div class="new-commit-drop-zone">
							<div class="drop-zone-content">
								<code-icon icon="plus"></code-icon>
								<span>Drop hunks here to create new commit</span>
							</div>
						</div>
					`,
				)}

				<div class="commits-only">
					${repeat(
						this.commits.slice().reverse(), // Reverse order - bottom to top
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
									.isPreviewMode=${this.isPreviewMode}
									@click=${(e: MouseEvent) => this.dispatchCommitSelect(commit.id, e.shiftKey)}
								></gl-commit-item>
							`;
						},
					)}
				</div>

				<!-- Base commit (informational only) -->
				<div class="base-commit">
					<div class="base-commit-icon"></div>
					<div class="base-commit-content">
						<div class="base-commit-message">${this.baseCommit?.message || 'HEAD'}</div>
						<div class="base-commit-details">
							<span class="repo-name">${this.baseCommit?.repoName || 'Repository'}</span>
							<span>/</span>
							<span class="branch-name">${this.baseCommit?.branchName || 'main'}</span>
						</div>
					</div>
				</div>

				<!-- Drop zone for unassigning hunks (hidden when not dragging or in AI preview mode) -->
				${when(
					!this.isPreviewMode && this.shouldShowUnassignZone,
					() => html`
						<div class="unassign-drop-zone">
							<div class="drop-zone-content">
								<code-icon icon="trash"></code-icon>
								<span>Drop hunks here to unassign</span>
							</div>
						</div>
					`,
				)}
			</div>

			<!-- Auto-Compose Commits with AI container -->
			${when(
				this.aiEnabled,
				() => html`
					<div class="auto-compose-container">
						<h4 class="auto-compose-header">Auto-Compose Commits with AI (Preview)</h4>
						${when(
							!this.hasUsedAutoCompose,
							() => html`
								<p class="auto-compose-description">
									Let AI organize your working changes into well-formed commits with clear messages
									and descriptions that help reviewers.
								</p>
							`,
						)}

						<!-- AI Model Picker -->
						<a href="#" class="ai-model-picker" @click=${this.handleAIModelPickerClick}>
							<span class="ai-model-picker-text">${this.aiModelDisplayName}</span>
							<code-icon icon="chevron-down" class="ai-model-picker-icon"></code-icon>
						</a>

						<!-- Custom instructions input -->
						<div class="custom-instructions-container">
							<input
								type="text"
								class="custom-instructions-input"
								placeholder="Add custom instructions"
								.value=${this.customInstructions}
								@input=${this.handleCustomInstructionsChange}
							/>
						</div>

						<!-- Auto-Compose button -->
						<button-container layout="editor">
							<gl-button
								full
								appearance=${this.hasUsedAutoCompose ? 'secondary' : undefined}
								?disabled=${this.generating || this.committing}
								@click=${this.dispatchGenerateCommitsWithAI}
							>
								<code-icon
									icon=${this.generating ? 'loading~spin' : 'sparkle'}
									slot="prefix"
								></code-icon>
								${this.generating
									? 'Generating Commits...'
									: this.hasUsedAutoCompose
										? 'Recompose Commits'
										: 'Auto-Compose Commits'}
							</gl-button>
						</button-container>

						<!-- Review text (always visible) -->
						<div class="auto-compose-review-text">You will be able to review before committing</div>
					</div>
				`,
			)}

			<!-- Finish & Commit section -->
			<div class="finish-commit-section">
				${when(
					this.selectedCommitIds.size > 1 && !this.isPreviewMode,
					() => html`
						<div class="finish-commit-header">
							<h3>Finish & Commit</h3>
							<p class="finish-commit-subtext">
								New commits will be added to your current branch and a stash will be created with your
								original changes.
							</p>
						</div>
						<button-container layout="editor">
							<gl-button
								full
								appearance="secondary"
								?disabled=${this.generating || this.committing}
								@click=${this.dispatchCombineCommits}
							>
								Combine ${this.selectedCommitIds.size} Commits
							</gl-button>
						</button-container>

						<!-- Cancel button -->
						<button-container layout="editor" class="cancel-button-container">
							<gl-button full appearance="secondary" @click=${this.handleCancel}> Cancel </gl-button>
						</button-container>
					`,
					() => html`
						<div class="finish-commit-header">
							<h3>Finish & Commit</h3>
							<p class="finish-commit-subtext">
								${this.isReadyToCommit
									? 'New commits will be added to your current branch.'
									: 'Commit the changes in this draft.'}
							</p>
						</div>

						<!-- Single Create Commits button -->
						<button-container layout="editor">
							<gl-button
								full
								.appearance=${!this.isReadyToCommit ? 'secondary' : undefined}
								?disabled=${this.commits.length === 0 || this.generating || this.committing}
								@click=${this.handleCreateCommitsClick}
							>
								<code-icon icon=${this.committing ? 'loading~spin' : ''} slot="prefix"></code-icon>
								${this.committing
									? 'Committing...'
									: `Create ${this.commits.length} ${this.commits.length === 1 ? 'Commit' : 'Commits'}`}
							</gl-button>
						</button-container>

						<!-- Cancel button (always shown) -->
						<button-container layout="editor" class="cancel-button-container">
							<gl-button full appearance="secondary" @click=${this.handleCancel}> Cancel </gl-button>
						</button-container>
					`,
				)}
			</div>
		`;
	}
}
