import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import Sortable from 'sortablejs';
import type { AIModel } from '../../../../../plus/ai/models/model';
import type { ComposerBaseCommit, ComposerCommit, ComposerHunk } from '../../../../plus/composer/protocol';
import {
	getCommitChanges,
	getFileChanges,
	getFileCountForCommit,
	getUnassignedHunks,
	getUniqueFileNames,
} from '../../../../plus/composer/utils/composer.utils';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase, inlineCode, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import { ruleStyles } from '../../shared/components/vscode.css';
import { composerItemCommitStyles, composerItemContentStyles, composerItemStyles } from './composer.css';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/overlays/popover';
import './commit-item';

@customElement('gl-commits-panel')
export class CommitsPanel extends LitElement {
	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		scrollableBase,
		ruleStyles,
		inlineCode,
		composerItemStyles,
		composerItemCommitStyles,
		composerItemContentStyles,
		css`
			:host {
				display: block;
				height: 100%;
				overflow: hidden;
			}

			.container {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
				height: 100%;
				overflow: hidden auto;
			}

			.working-section {
				display: flex;
				flex-direction: column;
				gap: 1.6rem;
			}

			.commits-list {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.commits-header {
				font-size: 1.4rem;
				margin-block: 0 0.4rem;
			}

			.commits-list > *:not(.commits-header) + .commits-header {
				margin-block-start: 1.2rem;
			}

			.no-changes-message {
				color: var(--vscode-descriptionForeground);
				font-style: italic;
				margin-block: 1.2rem;
				text-align: center;
			}

			.commits-only {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.composition-summary {
				margin-bottom: 0.4rem;
			}

			.composition-summary__header {
				margin-block: 0 0.8rem;
			}

			.composition-summary__feedback {
				display: flex;
				align-items: center;
				gap: 0.8rem;
				justify-content: space-between;
				font-size: 1.2rem;
				margin-block: 0.8rem;
			}

			.composition-summary__feedback-label {
				margin-block: 0;
			}

			.composition-summary__feedback-actions {
				display: flex;
				gap: 0.4rem;
			}

			.composition-summary__feedback-action {
				cursor: pointer;
				padding: 0.2rem;
				border-radius: 3px;
				transition: background-color 0.2s ease;
				color: var(--vscode-foreground);
			}

			.composition-summary__feedback-action:hover,
			.composition-summary__feedback-action:focus {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.composition-summary__feedback-action.is-selected {
				color: var(--vscode-button-foreground);
				background: var(--vscode-button-background);
			}

			.composition-summary__instructions {
				font-size: 1.2rem;
				color: var(--vscode-descriptionForeground);
				margin-top: 0.8rem;
				line-height: 1.4;
			}

			/* Finish & Commit section styles */
			.finish-commit {
				position: sticky;
				bottom: 0;
				z-index: 600;
				background-color: var(--color-background);
				padding-block-start: 0.8rem;
			}

			.finish-commit__header {
				font-size: 1.4rem;
				margin-block: 0 0.4rem;
			}

			.finish-commit__description {
				font-size: 1.2rem;
				color: var(--vscode-descriptionForeground);
				margin-block: 0 0.8rem;
			}

			.cancel-button-container {
				margin-top: 0.8rem;
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

			.repo-name,
			.branch-name {
				color: var(--vscode-descriptionForeground);
			}

			/* Include changes button styling */
			.add-to-draft-button-container gl-button {
				background: var(--composer-item-background) !important;
				color: var(--composer-item-color) !important;
			}

			/* Auto-Compose container styles */
			.auto-compose {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				padding: 1.2rem;
				background: linear-gradient(135deg, #a100ff1a 0%, #255ed11a 100%);
			}

			.auto-compose.is-used {
				margin-block: 1.2rem 0;
			}
			.auto-compose__header {
				font-size: 1.3rem;
				color: var(--vscode-foreground);
				margin-block: 0 0.4rem;
			}

			.auto-compose__description {
				font-size: 1.2rem;
				color: var(--vscode-descriptionForeground);
				line-height: 1.4;
				margin-block: 0 0.4rem;
			}

			.auto-compose__header ~ .auto-compose__model-picker {
				margin-block-start: 0.4rem;
			}

			.auto-compose__instructions {
				display: flex;
				flex-direction: row;
				gap: 0.2rem;
				margin-block: 0.8rem;
			}

			.auto-compose__instructions-info {
				--max-width: 37rem;

				a:has(.inline-code) {
					text-decoration: none;
					white-space: nowrap;
				}
				.inline-code code-icon {
					vertical-align: middle;
				}
			}
			.auto-compose__instructions-input {
				width: 100%;
				padding: 0.5rem;
				border: 1px solid var(--vscode-input-border);
				border-radius: 3px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-family: inherit;
				font-size: 1.3rem;
				line-height: 1.8rem;
			}
			textarea.auto-compose__instructions-input {
				box-sizing: content-box;
				width: calc(100% - 1rem);
				resize: vertical;
				field-sizing: content;
				min-height: 1lh;
				max-height: 4lh;
				resize: none;
			}

			.auto-compose__instructions-input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.auto-compose__footer {
				text-align: center;
				font-size: 1.1rem;
				color: var(--color-foreground--75);
				margin-block: 0.8rem 0;
			}

			.instructions-list {
				margin-block: 0.4rem;
				padding-inline-start: 1.6rem;
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

	@property({ type: String })
	aiDisabledReason: string | null = null;

	@property({ type: Boolean })
	isPreviewMode: boolean = false;

	@property({ type: Object })
	recompose: { enabled: boolean; branchName?: string; locked: boolean; commitIds?: string[] } | null = null;

	@property({ type: Boolean })
	canReorderCommits: boolean = true;

	@property({ type: Object })
	baseCommit: ComposerBaseCommit | null = null;

	@property({ type: String })
	repoName: string | null = null;

	@property({ type: String })
	customInstructions: string = '';

	@property({ type: Boolean })
	hasUsedAutoCompose: boolean = false;

	@property({ type: Boolean })
	hasChanges: boolean = true;

	@property({ type: Boolean })
	hasLockedCommits: boolean = false;

	@property({ type: Object })
	aiModel?: AIModel = undefined;

	@property({ type: Boolean })
	compositionSummarySelected: boolean = false;

	@property({ type: String })
	compositionFeedback: 'helpful' | 'unhelpful' | null = null;

	@property({ type: String })
	compositionSessionId: string | null = null;

	@property({ type: Boolean })
	isReadyToCommit: boolean = false;

	@query('.commits-list')
	changesSection!: HTMLElement;

	@query('.auto-compose')
	autoComposeSection?: HTMLElement;

	@query('.finish-commit')
	finishSection!: HTMLElement;

	private get isRecomposeLocked(): boolean {
		return this.recompose?.enabled === true && this.recompose.locked === true;
	}

	private get finishHeaderText(): string {
		return this.recompose?.enabled && this.recompose.branchName
			? `Recompose ${this.recompose.branchName}`
			: 'Finish & Commit';
	}

	private get finishDescriptionText(): string {
		return this.recompose?.enabled
			? 'The branch will be updated with the new commit structure.'
			: 'New commits will be added to your current branch.';
	}

	private commitsSortable?: Sortable;
	private isDraggingHunks = false;
	private draggedHunkIds: string[] = [];
	private hasScrolledToFirstNonLocked = false;

	override firstUpdated() {
		this.initializeSortable();
		this.initializeDropZones();
		this.addEventListener('hunk-drag-start', this.handleHunkDragStart.bind(this));
		this.addEventListener('hunk-drag-end', this.handleHunkDragEnd.bind(this));
		this.scrollToFirstNonLockedCommit();
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

			if (changedProperties.has('commits')) {
				const previousCommits = changedProperties.get('commits') as ComposerCommit[] | undefined;
				if (!previousCommits?.length && this.commits.length > 0) {
					this.scrollToFirstNonLockedCommit();
				}
			}
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback?.();
		this.commitsSortable?.destroy();
	}

	private scrollToFirstNonLockedCommit() {
		if (this.hasScrolledToFirstNonLocked) return;

		const hasLockedCommit = this.commits.some(c => c.locked === true);
		if (!hasLockedCommit) return;

		this.hasScrolledToFirstNonLocked = true;

		const reversedCommits = this.commits.slice().reverse();
		const firstNonLockedIndex = reversedCommits.findIndex(c => c.locked !== true);
		if (firstNonLockedIndex === -1) return;

		const firstNonLockedCommit = reversedCommits[firstNonLockedIndex];
		requestAnimationFrame(() => {
			const commitItem = this.shadowRoot?.querySelector(
				`gl-commit-item[data-commit-id="${firstNonLockedCommit.id}"]`,
			);
			if (!commitItem) return;

			const container = this.shadowRoot?.querySelector('.container.scrollable');
			if (!container) {
				commitItem.scrollIntoView({ block: 'center' });
				return;
			}

			const itemRect = commitItem.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const itemTop = itemRect.top - containerRect.top + container.scrollTop;
			const targetPosition = itemTop - containerRect.height * 0.1;

			container.scrollTo({
				top: Math.max(0, targetPosition),
				behavior: 'smooth',
			});
		});
	}

	private initializeSortable() {
		// Don't initialize sortable if commit reordering is disabled
		if (!this.canReorderCommits) {
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
				filter: (_evt, target) => {
					const commitId = target.dataset.commitId;
					if (!commitId) return false;
					const commit = this.commits.find(c => c.id === commitId);
					return commit?.locked === true;
				},
				onMove: evt => {
					const draggedCommitId = evt.dragged.dataset.commitId;
					const relatedCommitId = evt.related.dataset.commitId;

					if (!draggedCommitId || !relatedCommitId) return true;

					const relatedCommit = this.commits.find(c => c.id === relatedCommitId);

					if (relatedCommit?.locked === true) {
						return false;
					}

					const draggedIndex = this.commits.findIndex(c => c.id === draggedCommitId);
					const relatedIndex = this.commits.findIndex(c => c.id === relatedCommitId);

					if (draggedIndex === -1 || relatedIndex === -1) return true;

					const start = Math.min(draggedIndex, relatedIndex);
					const end = Math.max(draggedIndex, relatedIndex);

					for (let i = start; i <= end; i++) {
						if (this.commits[i].locked === true && this.commits[i].id !== draggedCommitId) {
							return false;
						}
					}

					return true;
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
		// Don't initialize drop zones in AI preview mode or when functionality is locked
		if (this.isPreviewMode || !this.canReorderCommits) {
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
		// Don't initialize commit drop zones in AI preview mode or when functionality is locked
		if (this.isPreviewMode || !this.canReorderCommits) {
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
		return (
			this.commits.find(commit => !commit.message.content || commit.message.content.trim().length === 0) || null
		);
	}

	private get shouldShowAddToDraftButton(): boolean {
		// Show button only when there is exactly one commit (regardless of message content)
		return this.commits.length === 1;
	}

	private get aiModelDisplayName(): string {
		if (!this.aiModel) {
			return 'Choose AI Model';
		}
		return this.aiModel.name || 'Unknown Model';
	}

	private handleHunkDragEnd() {
		this.isDraggingHunks = false;
		this.draggedHunkIds = [];
		this.removeDropZoneHoverEffects();
		this.requestUpdate(); // Re-render to hide unassign drop zone
	}

	private dispatchCommitSelect(commitId: string, e?: MouseEvent | KeyboardEvent) {
		if (e instanceof KeyboardEvent && e.key !== 'Enter') {
			return;
		}

		const multiSelect = e?.shiftKey ?? false;
		this.dispatchEvent(
			new CustomEvent('commit-select', {
				detail: { commitId: commitId, multiSelect: multiSelect },
				bubbles: true,
			}),
		);
	}

	private dispatchUnassignedSelect(section: string, e?: MouseEvent | KeyboardEvent) {
		if (e instanceof KeyboardEvent && e.key !== 'Enter') return;

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
		if (!this.aiEnabled) return;

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
					source: sectionKey,
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

	private handleCompositionSummaryClick(e: MouseEvent | KeyboardEvent) {
		if (e instanceof KeyboardEvent && e.key !== 'Enter') return;

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

	private getIncludeButtonText(sectionKey: string): string {
		switch (sectionKey) {
			case 'unstaged':
				return 'Include Unstaged Changes';
			case 'staged':
				return 'Include Staged Changes';
			case 'commits':
				return 'Include Unassigned Changes';
			default:
				return 'Include Changes';
		}
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
				title: 'Unincluded changes (unstaged)',
				fileCount: fileCount,
				changes: changes,
			});
		}
		// if (unassignedHunks.staged.length > 0) {
		// 	const fileCount = getUniqueFileNames(unassignedHunks.staged).length;
		// 	const changes = getFileChanges(unassignedHunks.staged);
		// 	sections.push({
		// 		key: 'staged',
		// 		title: 'Unincluded changes (staged)',
		// 		fileCount: fileCount,
		// 		changes: changes,
		// 	});
		// }
		// if (unassignedHunks.unassigned.length > 0) {
		// 	const fileCount = getUniqueFileNames(unassignedHunks.unassigned).length;
		// 	const changes = getFileChanges(unassignedHunks.unassigned);
		// 	sections.push({
		// 		key: 'unassigned',
		// 		title: 'Unincluded changes (commits)',
		// 		fileCount: fileCount,
		// 		changes: changes,
		// 	});
		// }

		return sections.map(
			section => html`
				<div
					class="composer-item is-uncommitted${this.selectedUnassignedSection === section.key
						? ' is-selected'
						: ''}"
					tabindex="0"
					@click=${(e: MouseEvent) => this.dispatchUnassignedSelect(section.key, e)}
					@keydown=${(e: KeyboardEvent) => this.dispatchUnassignedSelect(section.key, e)}
				>
					<div class="composer-item__content">
						<div class="composer-item__header">
							<code-icon icon="diff-single"></code-icon>
							${section.title}
						</div>
						<div class="composer-item__body">
							<span class="file-count"
								>${section.fileCount} ${section.fileCount === 1 ? 'file' : 'files'}</span
							>
							<span class="diff-stats">
								<span class="diff-stats__additions">+${section.changes.additions}</span>
								<span class="diff-stats__deletions">-${section.changes.deletions}</span>
							</span>
						</div>
						${when(
							this.shouldShowAddToDraftButton,
							() => html`
								<div>
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
											${this.getIncludeButtonText(section.key)}
										</gl-button>
									</button-container>
								</div>
							`,
						)}
					</div>
				</div>
			`,
		);
	}

	private renderCompositionSummarySection() {
		return html`
			<div class="composition-summary">
				<h3 class="composition-summary__header">Composition Summary</h3>
				<div
					class="composer-item is-summary${this.compositionSummarySelected ? ' is-selected' : ''}"
					tabindex="0"
					@click=${this.handleCompositionSummaryClick}
					@keydown=${this.handleCompositionSummaryClick}
				>
					<div class="composer-item__content">
						<div class="composer-item__header">
							<code-icon icon="note"></code-icon>
							<span>Auto-composition Summary</span>
						</div>
					</div>
				</div>

				<!-- Feedback row -->
				<div class="composition-summary__feedback">
					<p class="composition-summary__feedback-label">Was this composition helpful?</p>
					<nav class="composition-summary__feedback-actions">
						<code-icon
							tabindex="0"
							icon=${this.compositionFeedback === 'helpful' ? 'thumbsup-filled' : 'thumbsup'}
							class="composition-summary__feedback-action${this.compositionFeedback === 'helpful'
								? ' is-selected'
								: ''}"
							@click=${this.handleCompositionFeedbackHelpful}
						></code-icon>
						<code-icon
							tabindex="0"
							icon=${this.compositionFeedback === 'unhelpful' ? 'thumbsdown-filled' : 'thumbsdown'}
							class="composition-summary__feedback-action${this.compositionFeedback === 'unhelpful'
								? ' is-selected'
								: ''}"
							@click=${this.handleCompositionFeedbackUnhelpful}
						></code-icon>
					</nav>
				</div>

				<!-- Instructions -->
				<p class="composition-summary__instructions">
					Review the auto-generated draft commits below to inspect diffs and modify commit messages.
				</p>
			</div>
		`;
	}

	private renderAutoComposeContainer(disabled = false) {
		const recomposeCount = this.hasLockedCommits
			? this.commits.filter(c => !c.locked).length
			: this.recompose?.enabled && this.selectedCommitIds.size > 1
				? this.selectedCommitIds.size
				: null;
		return html`
			<div class="auto-compose${this.hasUsedAutoCompose ? ' is-used' : ''}">
				${when(
					!this.hasUsedAutoCompose && !this.isRecomposeLocked,
					() => html`
						<h4 class="auto-compose__header">Auto-Compose Commits with AI (Preview)</h4>
						<p class="auto-compose__description">
							Let AI organize your changes into well-formed commits with clear messages and descriptions
							that help reviewers.
						</p>
					`,
				)}
				${when(
					this.isRecomposeLocked,
					() => html`
						<h4 class="auto-compose__header">Recompose Commits with AI (Preview)</h4>
						<p class="auto-compose__description">
							Let AI reorganize work into logical commits with clear messages and descriptions that help
							reviewers.
						</p>
					`,
				)}

				<!-- AI Model Picker -->
				<gl-button
					class="auto-compose__model-picker"
					appearance="toolbar"
					tooltip="Select AI Model"
					@click=${this.handleAIModelPickerClick}
					?disabled=${disabled}
				>
					${this.aiModelDisplayName}
					<code-icon slot="suffix" icon="chevron-down" size="10"></code-icon>
				</gl-button>

				<!-- Custom instructions input -->
				<div class="auto-compose__instructions">
					<textarea
						class="auto-compose__instructions-input"
						placeholder="Include additional instructions"
						.value=${this.customInstructions}
						rows="1"
						@input=${this.handleCustomInstructionsChange}
						?disabled=${disabled}
					></textarea>
					<gl-popover placement="bottom" trigger="click focus" class="auto-compose__instructions-info">
						<gl-button slot="anchor" appearance="toolbar">
							<code-icon icon="info"></code-icon>
						</gl-button>
						<div slot="content">
							Providing additional instructions can help steer the AI composition for this session.
							<br /><br />
							Potential instructions include:
							<ul class="instructions-list">
								<li>conventional commits format</li>
								<li>size of commits</li>
								<li>focus on certain changes</li>
							</ul>
							<hr />
							You can also specify custom instructions that apply to all composer sessions with the
							following setting:
							<a
								href=${`command:workbench.action.openSettings?%22@id:gitlens.ai.generateCommits.customInstructions%22`}
								><code class="inline-code"
									><code-icon icon="gear" size="10"></code-icon>
									gitlens.ai.generateCommits.customInstructions</code
								></a
							>
						</div>
					</gl-popover>
				</div>

				<!-- Auto-Compose button -->
				<button-container layout="editor">
					${when(
						this.aiEnabled,
						() => html`
							<gl-button
								full
								appearance=${this.hasUsedAutoCompose ? 'secondary' : undefined}
								?disabled=${disabled || this.generating || this.committing}
								@click=${this.dispatchGenerateCommitsWithAI}
							>
								<code-icon
									modifier=${this.generating ? 'spin' : ''}
									icon=${this.generating ? 'loading' : 'sparkle'}
									slot="prefix"
								></code-icon>
								${this.generating
									? 'Generating Commits...'
									: this.hasUsedAutoCompose || this.recompose?.enabled
										? recomposeCount
											? html`Recompose ${recomposeCount}
												${recomposeCount === 1 ? 'Commit' : 'Commits'}`
											: 'Recompose Commits'
										: 'Auto-Compose Commits'}
							</gl-button>
						`,
						() => html`
							<gl-button
								full
								appearance="secondary"
								tooltip=${this.aiDisabledReason || 'Auto-Compose Commits is disabled'}
								?disabled=${disabled}
							>
								<code-icon icon="sparkle" slot="prefix"></code-icon>
								Auto-Compose Commits
							</gl-button>
						`,
					)}
				</button-container>

				<!-- Review text (always visible) -->
				<p class="auto-compose__footer">You will be able to review before committing</p>
			</div>
		`;
	}

	private renderFinishCommitSection(disabled = false) {
		if (disabled) {
			return html`
				<div class="finish-commit">
					<h3 class="finish-commit__header">${this.finishHeaderText}</h3>
					<p class="finish-commit__description">${this.finishDescriptionText}</p>
					<button-container layout="editor">
						<gl-button full appearance="secondary" disabled>Create Commits</gl-button>
					</button-container>
					<button-container layout="editor" class="cancel-button-container">
						<gl-button full appearance="secondary" disabled>Cancel</gl-button>
					</button-container>
				</div>
			`;
		}

		// Special case for recompose locked mode - only show Cancel button
		if (this.isRecomposeLocked) {
			return html`
				<div class="finish-commit">
					<button-container layout="editor" class="cancel-button-container">
						<gl-button full appearance="secondary" @click=${this.handleCancel}>Cancel</gl-button>
					</button-container>
				</div>
			`;
		}

		return html`
			<!-- Finish & Commit section -->
			<div class="finish-commit">
				${when(
					this.selectedCommitIds.size > 1 && !this.isPreviewMode,
					() => html`
						<h3 class="finish-commit__header">${this.finishHeaderText}</h3>
						<p class="finish-commit__description">
							${this.recompose?.enabled
								? 'The branch will be updated with the new commit structure.'
								: 'New commits will be added to your current branch.'}
						</p>
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
							<gl-button full appearance="secondary" @click=${this.handleCancel}>Cancel</gl-button>
						</button-container>
					`,
					() => html`
						<h3 class="finish-commit__header">${this.finishHeaderText}</h3>
						<p class="finish-commit__description">
							${this.isReadyToCommit ? this.finishDescriptionText : 'Commit the changes in this draft.'}
						</p>

						<!-- Single Create Commits button -->
						<button-container layout="editor">
							<gl-button
								full
								.appearance=${!this.isReadyToCommit ? 'secondary' : undefined}
								?disabled=${this.commits.length === 0 || this.generating || this.committing}
								@click=${this.handleCreateCommitsClick}
							>
								${when(
									this.committing,
									() => html`<code-icon modifier="spin" icon="loading" slot="prefix"></code-icon>`,
								)}
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

	override render() {
		// Handle no changes state
		if (!this.hasChanges) {
			return html`
				<div class="container scrollable">
					<div class="working-section">
						${this.renderAutoComposeContainer(true)}
						<div class="commits-list">
							<h3 class="commits-header">Draft Commits</h3>
							<div class="composer-item">
								<div class="composer-item__commit"></div>
								<div class="composer-item__content">
									<div class="composer-item__header is-empty-state">
										When working directory changes are present, draft commits will appear here.
									</div>
								</div>
							</div>

							<!-- Base commit (informational only) -->
							<div class="composer-item is-base">
								<div class="composer-item__commit${this.baseCommit ? '' : ' is-empty'}"></div>
								<div class="composer-item__content">
									<div
										class="composer-item__header${this.baseCommit == null ? ' is-placeholder' : ''}"
									>
										${this.baseCommit?.message || 'No commits yet'}
									</div>
									<div class="composer-item__body">
										<span class="repo-name">${this.repoName || 'Repository'}</span>
										${this.baseCommit?.branchName
											? html`<span>/</span
													><span class="branch-name">${this.baseCommit.branchName}</span>`
											: ''}
									</div>
								</div>
							</div>
						</div>
					</div>
					${this.renderFinishCommitSection(true)}
				</div>
			`;
		}

		return html`
			<div class="container scrollable">
				<div class="working-section">
					<!-- Auto-Compose container at top when not used yet and not in recompose locked mode -->
					${when(!this.hasUsedAutoCompose && !this.isRecomposeLocked, () =>
						this.renderAutoComposeContainer(),
					)}
					<div class="commits-list">
						${this.hasUsedAutoCompose && !this.isRecomposeLocked
							? this.renderCompositionSummarySection()
							: !this.isRecomposeLocked
								? this.renderUnassignedSection()
								: ''}

						<h3 class="commits-header">${this.isRecomposeLocked ? 'Commits' : 'Draft Commits'}</h3>

						<!-- Drop zone for creating new commits (only visible when dragging hunks in interactive mode) -->
						${when(
							!this.isPreviewMode && this.canReorderCommits && this.shouldShowNewCommitZone,
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
								(commit, i) => {
									const changes = getCommitChanges(commit, this.hunks);
									return html`
										<gl-commit-item
											.commitId=${commit.id}
											.message=${commit.message.content}
											.fileCount=${getFileCountForCommit(commit, this.hunks)}
											.additions=${changes.additions}
											.deletions=${changes.deletions}
											.selected=${this.selectedCommitIds.has(commit.id)}
											.multiSelected=${this.selectedCommitIds.size > 1 &&
											this.selectedCommitIds.has(commit.id)}
											.isPreviewMode=${this.isPreviewMode}
											.isRecomposeLocked=${this.isRecomposeLocked}
											.locked=${commit.locked === true}
											?first=${i === 0}
											?last=${i === this.commits.length - 1 && !this.baseCommit}
											@click=${(e: MouseEvent) => this.dispatchCommitSelect(commit.id, e)}
											@keydown=${(e: KeyboardEvent) => this.dispatchCommitSelect(commit.id, e)}
										></gl-commit-item>
									`;
								},
							)}
						</div>

						<!-- Base commit (informational only) -->
						<div class="composer-item is-base">
							<div class="composer-item__commit${this.baseCommit ? '' : ' is-empty'}"></div>
							<div class="composer-item__content">
								<div class="composer-item__header${this.baseCommit == null ? ' is-placeholder' : ''}">
									${this.baseCommit?.message || 'No commits yet'}
								</div>
								<div class="composer-item__body">
									<span class="repo-name">${this.repoName || 'Repository'}</span>
									${this.baseCommit?.branchName
										? html`<span>/ </span
												><span class="branch-name">${this.baseCommit.branchName}</span>`
										: ''}
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
					<!-- Auto-Compose container in original position when already used or in recompose locked mode -->
					${when(this.hasUsedAutoCompose || this.isRecomposeLocked, () => this.renderAutoComposeContainer())}
				</div>
				${this.renderFinishCommitSection()}
			</div>
		`;
	}
}
