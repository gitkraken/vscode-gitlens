import { flow } from '@lit-labs/virtualizer/layouts/flow.js';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { when } from 'lit/directives/when.js';
import { GlElement } from '../element';
import type { GlGitStatus } from '../status/git-status';
import { scrollableBase } from '../styles/lit/base.css';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
	TreeModelFlat,
} from './base';
import '@lit-labs/virtualizer';
import '../actions/action-item';
import '../status/git-status';
import '../code-icon';
import './tree-item';
import type { GlTreeItem } from './tree-item';

@customElement('gl-tree-generator')
export class GlTreeGenerator extends GlElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				width: 100%;
				overflow: hidden;
			}

			.scrollable {
				flex: 1;
				width: 100%;
				min-height: 0;
				overflow-y: auto;
				overflow-x: visible; /* Allow horizontal overflow for tooltips */
				outline: none;
			}

			.scrollable:focus-within {
				outline: none;
			}

			lit-virtualizer {
				display: block;
				width: 100%;
				height: 100%;
				/* Use layout containment instead of strict to avoid rendering issues */
				/* Removed paint containment to allow tooltips to escape */
				contain: layout;
			}

			gl-tree-item {
				width: 100%;
			}

			/* Dim non-matched items when filter is present */
			:host([filtered]) gl-tree-item:not([matched]) {
				opacity: 0.6;
			}
		`,
	];

	@state()
	treeItems?: TreeModelFlat[] = undefined;

	@state()
	private _virtualizerKey = 0;

	@property({ reflect: true })
	guides?: 'none' | 'onHover' | 'always';

	@property({ type: Boolean, reflect: true })
	filtered = false;

	@property({ type: String, attribute: 'aria-label' })
	override ariaLabel = 'Tree';

	private _lastSelectedPath?: string;
	private _focusedItemPath?: string;
	private _focusedItemIndex: number = -1;
	private virtualizerRef: Ref<any> = createRef();
	private scrollableRef: Ref<HTMLElement> = createRef();

	@state()
	private _containerHasFocus = false;

	@state()
	private _actionButtonHasFocus = false;

	private _scrolling = false;

	// Type-ahead search state
	private _typeAheadBuffer = '';
	private _typeAheadTimer?: number;
	private readonly _typeAheadTimeout = 800; // Matches VS Code's implementation

	// Performance optimization: Maps for O(1) lookups
	private _nodeMap = new Map<string, TreeModel>(); // path -> TreeModel
	private _pathToIndexMap = new Map<string, number>(); // path -> index in treeItems

	override connectedCallback(): void {
		super.connectedCallback?.();

		// Add capture-phase listeners to handle Tab navigation and focus tracking
		this.addEventListener('keydown', this.handleKeydown, { capture: true });
		this.addEventListener('focusin', this.handleFocusIn, { capture: true });
		this.addEventListener('focusout', this.handleFocusOut, { capture: true });

		// Listen for contextmenu events from tree items and re-dispatch them
		// so they can cross the shadow DOM boundary with the context data
		this.addEventListener('contextmenu', this.handleContextMenu);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.removeEventListener('keydown', this.handleKeydown, { capture: true });
		this.removeEventListener('focusin', this.handleFocusIn, { capture: true });
		this.removeEventListener('focusout', this.handleFocusOut, { capture: true });
		this.removeEventListener('contextmenu', this.handleContextMenu);

		// Clean up type-ahead timer and reset state
		if (this._typeAheadTimer) {
			clearTimeout(this._typeAheadTimer);
			this._typeAheadTimer = undefined;
		}
		this._typeAheadBuffer = '';
	}

	private _model?: TreeModel[];
	@property({ type: Array, attribute: false })
	set model(value: TreeModel[] | undefined) {
		if (this._model === value) return;

		this._model = value;

		// Clear stale node map before processing new model
		// This prevents stale node references when switching commits or toggling filters
		this._nodeMap.clear();

		// Increment virtualizer key to force complete re-render
		// This prevents stale DOM node references in the repeat directive
		this._virtualizerKey++;

		// Build both maps during tree flattening (single traversal)
		let treeItems: TreeModelFlat[] | undefined;
		if (this._model != null) {
			const size = this._model.length;
			treeItems = this._model.reduce<TreeModelFlat[]>((acc, node, index) => {
				acc.push(...flattenTree(node, size, index + 1, undefined, this._nodeMap));
				return acc;
			}, []);
		}

		this.treeItems = treeItems;

		// Build path-to-index map for O(1) index lookups
		this.buildPathToIndexMap();

		// Initialize focused item if not set
		if (this.treeItems?.length && !this._focusedItemPath) {
			// Default to first item
			this._focusedItemPath = this.treeItems[0].path;
			this._focusedItemIndex = 0;
		}
	}

	get model() {
		return this._model;
	}

	private renderIcon(icon?: string | { type: 'status'; name: GlGitStatus['status'] }) {
		if (icon == null) return nothing;

		if (typeof icon === 'string') {
			return html`<code-icon slot="icon" icon=${icon}></code-icon>`;
		}

		if (icon.type !== 'status') {
			return nothing;
		}

		return html`<gl-git-status slot="icon" .status=${icon.name}></gl-git-status>`;
	}

	private renderActions(model: TreeModelFlat) {
		const actions = model.actions;
		if (actions == null || actions.length === 0) return nothing;

		return actions.map(action => {
			return html`<action-item
				slot="actions"
				.icon=${action.icon}
				.label=${action.label}
				@click=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action, false)}
				@dblclick=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action, true)}
			></action-item>`;
		});
	}

	private renderDecorations(model: TreeModelFlat) {
		const decorations = model.decorations;
		if (decorations == null || decorations.length === 0) return nothing;

		return decorations.map(decoration => {
			if (decoration.type === 'icon') {
				return html`<code-icon
					slot="decorations"
					title="${decoration.label}"
					aria-label="${decoration.label}"
					.icon=${decoration.icon}
				></code-icon>`;
			}

			if (decoration.type === 'text') {
				return html`<span slot="decorations">${decoration.label}</span>`;
			}

			// TODO: implement badge and indicator decorations

			return undefined;
		});
	}

	private renderTreeItem(model: TreeModelFlat) {
		const isSelected = this._lastSelectedPath === model.path;
		const isFocused = this._focusedItemPath === model.path;

		// All items get tabindex="-1" (not focusable via Tab, only programmatically)
		// Add ID for aria-activedescendant
		const itemId = `tree-item-${model.path}`;

		return html`<gl-tree-item
			id=${itemId}
			.branch=${model.branch}
			.expanded=${model.expanded}
			.path=${model.path}
			.parentPath=${model.parentPath}
			.parentExpanded=${model.parentExpanded}
			.level=${model.level}
			.size=${model.size}
			.position=${model.position}
			.checkable=${model.checkable}
			.checked=${model.checked ?? false}
			.disableCheck=${model.disableCheck ?? false}
			.showIcon=${model.icon != null}
			.matched=${model.matched ?? false}
			.selected=${isSelected}
			.focused=${isFocused && this._containerHasFocus && !this._actionButtonHasFocus}
			.focusedInactive=${isFocused && (!this._containerHasFocus || this._actionButtonHasFocus)}
			.tabIndex=${-1}
			.vscodeContext=${model.contextData as string | undefined}
			@gl-tree-item-select=${() => this.onBeforeTreeItemSelected(model)}
			@gl-tree-item-selected=${(e: CustomEvent<TreeItemSelectionDetail>) => this.onTreeItemSelected(e, model)}
			@gl-tree-item-checked=${(e: CustomEvent<TreeItemCheckedDetail>) => this.onTreeItemChecked(e, model)}
		>
			${this.renderIcon(model.icon)}
			${model.label}${when(
				model.description != null,
				() => html`<span slot="description">${model.description}</span>`,
			)}
			${this.renderActions(model)} ${this.renderDecorations(model)}
		</gl-tree-item>`;
	}

	override render(): unknown {
		if (!this.treeItems?.length) return nothing;

		// Container-focused approach: the scrollable div is the focusable element
		// Use aria-activedescendant to indicate which tree item is active for screen readers
		const activeDescendant = this._focusedItemPath ? `tree-item-${this._focusedItemPath}` : undefined;

		// Use keyed directive to force virtualizer re-creation when model changes
		// This prevents stale DOM node references in the repeat directive
		return html`
			<div
				${ref(this.scrollableRef)}
				class="scrollable"
				tabindex="0"
				role="tree"
				aria-label=${this.ariaLabel}
				aria-multiselectable="false"
				aria-activedescendant=${activeDescendant || nothing}
				@keydown=${this.handleContainerKeydown}
				@focus=${this.handleContainerFocus}
				@blur=${this.handleContainerBlur}
			>
				${keyed(
					this._virtualizerKey,
					html`<lit-virtualizer
						class="scrollable"
						${ref(this.virtualizerRef)}
						.items=${this.treeItems}
						.keyFunction=${(item: TreeModelFlat) => item.path}
						.layout=${flow({ direction: 'vertical' })}
						.renderItem=${(node: TreeModelFlat) => this.renderTreeItem(node)}
						scroller
					></lit-virtualizer>`,
				)}
			</div>
		`;
	}

	/**
	 * Find a tree node by path using O(1) map lookup
	 */
	private findTreeNode(path: string): TreeModel | undefined {
		return this._nodeMap.get(path);
	}

	/**
	 * Get the index of an item by path using O(1) map lookup
	 */
	private getItemIndex(path: string): number {
		return this._pathToIndexMap.get(path) ?? -1;
	}

	/**
	 * Rebuild the flattened tree from the hierarchical model
	 * This is called when the tree structure changes (expand/collapse)
	 */
	private rebuildFlattenedTree() {
		if (!this._model) return;

		// Clear stale node map before processing new model
		// This prevents stale node references when expanding/collapsing nodes
		this._nodeMap.clear();

		const size = this._model.length;
		const newTreeItems = this._model.reduce<TreeModelFlat[]>((acc, node, index) => {
			acc.push(...flattenTree(node, size, index + 1, undefined, this._nodeMap));
			return acc;
		}, []);

		this.treeItems = newTreeItems;

		// Rebuild path-to-index map for O(1) index lookups
		this.buildPathToIndexMap();
	}

	private onBeforeTreeItemSelected(model: TreeModelFlat) {
		if (this._lastSelectedPath !== model.path) {
			this._lastSelectedPath = model.path;
		}
		// Update focused item when clicking
		if (this._focusedItemPath !== model.path) {
			this._focusedItemPath = model.path;
			this._focusedItemIndex = this.getItemIndex(model.path);
		}
		// Toggle expansion for branch nodes
		if (model.branch) {
			const treeNode = this.findTreeNode(model.path);
			if (treeNode) {
				treeNode.expanded = !treeNode.expanded;
				this.rebuildFlattenedTree();
			}
		}
		// Trigger a re-render to update selection and tabindex state across all items
		this.requestUpdate();
	}

	private onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-selected', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-checked', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private onTreeItemActionClicked(e: MouseEvent, model: TreeModelFlat, action: TreeItemAction, dblClick = false) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-action-clicked', {
			node: model,
			context: model.context,
			action: action,
			dblClick: dblClick,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
		});
	}

	private handleContainerFocus = () => {
		// Mark that the container has focus
		this._containerHasFocus = true;

		// When the container receives focus, if we don't have a focused item, default to first or selected
		if (!this._focusedItemPath) {
			if (this._lastSelectedPath) {
				this._focusedItemPath = this._lastSelectedPath;
				this._focusedItemIndex = this.getItemIndex(this._lastSelectedPath);
			} else if (this.treeItems?.length) {
				this._focusedItemPath = this.treeItems[0].path;
				this._focusedItemIndex = 0;
			}
			this.requestUpdate();
		}
	};

	private handleContainerBlur = () => {
		// Mark that the container lost focus
		// This will trigger a re-render to update the focused item's visual state
		this._containerHasFocus = false;
	};

	private handleFocusIn = (e: FocusEvent) => {
		const target = e.target as HTMLElement;
		// Check if focus moved to an action button
		const actionItem = target.tagName === 'ACTION-ITEM' ? target : target.closest('action-item');
		if (actionItem) {
			this._actionButtonHasFocus = true;
		}
	};

	private handleFocusOut = (e: FocusEvent) => {
		const target = e.target as HTMLElement;
		const relatedTarget = e.relatedTarget as HTMLElement;

		// Check if focus is leaving action buttons entirely
		const leavingActionItem = target.tagName === 'ACTION-ITEM' ? target : target.closest('action-item');
		const enteringActionItem =
			relatedTarget?.tagName === 'ACTION-ITEM' ? relatedTarget : relatedTarget?.closest('action-item');

		if (leavingActionItem && !enteringActionItem) {
			this._actionButtonHasFocus = false;
		}
	};

	private handleContextMenu = (e: MouseEvent) => {
		// Find the tree-item element that triggered the context menu
		const path = e.composedPath();
		const treeItem = path.find(el => (el as HTMLElement).tagName === 'GL-TREE-ITEM') as GlTreeItem | undefined;
		if (!treeItem) return;

		// Get the context data from the tree-item
		const contextData = treeItem.vscodeContext;
		if (!contextData) return;

		// Prevent the original event from bubbling
		e.preventDefault();
		e.stopPropagation();

		// Copy the context data to this element (tree-generator host)
		// so VS Code's injected library can read it
		this.dataset.vscodeContext = contextData;

		// Re-dispatch the event from this element so it can cross the shadow DOM boundary
		const evt = new MouseEvent('contextmenu', {
			bubbles: true,
			composed: true,
			cancelable: true,
			clientX: e.clientX,
			clientY: e.clientY,
			button: e.button,
			buttons: e.buttons,
			ctrlKey: e.ctrlKey,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
			metaKey: e.metaKey,
		});

		// Dispatch the new event
		this.dispatchEvent(evt);

		// Clean up the context data after a short delay
		// (VS Code should have read it by then)
		setTimeout(() => {
			delete this.dataset.vscodeContext;
		}, 100);
	};

	private handleKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Tab') return;

		// In capture phase, e.target is the element with the listener, not the focused element
		// We need to use composedPath to find the action-item in the event path
		const composedPath = e.composedPath();

		// Find the action-item in the composed path
		const actionItem = composedPath.find((el: any) => el.tagName === 'ACTION-ITEM') as HTMLElement;
		if (!actionItem) {
			return;
		}

		if (e.shiftKey) {
			// Shift+Tab - always move back to container
			e.preventDefault();
			const container = this.scrollableRef.value;
			if (container) {
				container.focus();
			}
		} else {
			// Tab forward - blur the action button and let VS Code handle focus
			e.preventDefault();

			// Blur the currently focused element to let VS Code's focus management take over
			const activeElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				if (activeElement && typeof activeElement.blur === 'function') {
					activeElement.blur();
				}
			}, 0);
		}
	};

	private getCurrentFocusedIndex(): number {
		if (!this.treeItems?.length) return -1;

		// Try to find by path first
		if (this._focusedItemPath) {
			const index = this.getItemIndex(this._focusedItemPath);
			if (index !== -1) return index;
		}

		// Fall back to cached index if valid
		if (this._focusedItemIndex >= 0 && this._focusedItemIndex < this.treeItems.length) {
			return this._focusedItemIndex;
		}

		// Fall back to selected item
		if (this._lastSelectedPath) {
			const index = this.getItemIndex(this._lastSelectedPath);
			if (index !== -1) return index;
		}

		// Default to first item
		return 0;
	}

	private handleContainerKeydown = (e: KeyboardEvent) => {
		if (!this.treeItems?.length) return;

		// Don't handle keyboard events when an action button has focus
		// This allows action-nav to handle left/right arrow navigation between action buttons
		if (this._actionButtonHasFocus) return;

		// Handle Tab key to move focus to action buttons
		if (e.key === 'Tab' && !e.shiftKey) {
			// Try to focus the first action button in the focused row
			if (this._focusedItemPath) {
				const virtualizer = this.virtualizerRef.value;

				if (virtualizer) {
					// Query all gl-tree-items and find by ID
					// (virtualizer renders items as direct children)
					const allTreeItems = Array.from(virtualizer.querySelectorAll('gl-tree-item'));
					const focusedTreeItem = allTreeItems.find(
						item => (item as any).id === `tree-item-${this._focusedItemPath}`,
					) as HTMLElement;

					if (focusedTreeItem) {
						// Action items are light DOM children of the tree item
						const firstAction = focusedTreeItem.querySelector('action-item') as HTMLElement;
						if (firstAction) {
							// Prevent default BEFORE focusing to stop Tab from moving focus out
							e.preventDefault();
							e.stopPropagation();

							// Focus the action button
							firstAction.focus();
							return;
						}
					}
				}
			}
			// If no action buttons, let Tab move focus out naturally
			return;
		}

		// Get current focused index using helper method
		const currentIndex = this.getCurrentFocusedIndex();

		let targetIndex = currentIndex;
		let handled = false;

		switch (e.key) {
			case 'Enter':
			case ' ':
				// Trigger selection on the focused item
				e.preventDefault();
				e.stopPropagation();
				this.handleItemActivation(this.treeItems[currentIndex]);
				return;
			case 'ArrowDown':
				targetIndex = Math.min(currentIndex + 1, this.treeItems.length - 1);
				handled = true;
				break;
			case 'ArrowUp':
				targetIndex = Math.max(currentIndex - 1, 0);
				handled = true;
				break;
			case 'Home':
				targetIndex = 0;
				handled = true;
				break;
			case 'End':
				targetIndex = this.treeItems.length - 1;
				handled = true;
				break;
			case 'ArrowLeft':
			case 'ArrowRight': {
				// Try to handle expand/collapse for branch nodes
				const branchHandled = this.handleBranchToggle(e, this.treeItems[currentIndex]);
				if (branchHandled) {
					return;
				}
				// If not handled (already expanded/collapsed), navigate instead
				if (e.key === 'ArrowRight') {
					// Right arrow: move to next row
					targetIndex = Math.min(currentIndex + 1, this.treeItems.length - 1);
				} else {
					// Left arrow: move to parent if possible, otherwise previous row
					const currentItem = this.treeItems[currentIndex];
					if (currentItem.parentPath) {
						// Find the parent in the tree
						const parentIndex = this.getItemIndex(currentItem.parentPath);
						if (parentIndex !== -1) {
							targetIndex = parentIndex;
						} else {
							// Parent not found (shouldn't happen), go to previous row
							targetIndex = Math.max(currentIndex - 1, 0);
						}
					} else {
						// No parent, go to previous row
						targetIndex = Math.max(currentIndex - 1, 0);
					}
				}
				handled = true;
				break;
			}
			default: {
				// Handle type-ahead search for printable characters
				if (this.isPrintableCharacter(e.key)) {
					e.preventDefault();
					e.stopPropagation();
					this.handleTypeAhead(e.key);
					return;
				}
				break;
			}
		}

		if (handled) {
			// Always prevent default for navigation keys to avoid browser scroll behavior
			e.preventDefault();
			e.stopPropagation();

			// Always call focusItemAtIndex, even if we're already at the target
			// This ensures we scroll to the item if the user has scrolled away
			this.focusItemAtIndex(targetIndex);
		}
	};

	private handleItemActivation(item: TreeModelFlat) {
		if (!item) return;

		// First, update selection state (this also handles branch expansion)
		this.onBeforeTreeItemSelected(item);

		// Then emit selection event
		this.onTreeItemSelected(
			new CustomEvent('gl-tree-item-selected', {
				detail: {
					node: null as any, // The tree-item node isn't needed for keyboard activation
					dblClick: false,
					altKey: false,
					ctrlKey: false,
					metaKey: false,
				},
			}),
			item,
		);
	}

	private handleBranchToggle(e: KeyboardEvent, item: TreeModelFlat): boolean {
		if (!item?.branch) return false;

		const shouldExpand = e.key === 'ArrowRight';
		const shouldCollapse = e.key === 'ArrowLeft';

		// If already in the desired state, don't handle it (allow navigation)
		if ((shouldExpand && item.expanded) || (shouldCollapse && !item.expanded)) {
			return false;
		}

		e.preventDefault();
		e.stopPropagation();

		// Find and update the node in the hierarchical model
		const treeNode = this.findTreeNode(item.path);
		if (treeNode) {
			treeNode.expanded = !treeNode.expanded;
			this.rebuildFlattenedTree();

			// Trigger a re-render
			this.requestUpdate();

			// Emit selection event
			this.onTreeItemSelected(
				new CustomEvent('gl-tree-item-selected', {
					detail: {
						node: null as any,
						dblClick: false,
						altKey: false,
						ctrlKey: false,
						metaKey: false,
					},
				}),
				item,
			);
			return true;
		}
		return false;
	}

	private focusItemAtIndex(index: number) {
		const item = this.treeItems?.[index];
		if (!item) return;

		this._focusedItemPath = item.path;
		this._focusedItemIndex = index;

		// Selection follows focus - update selection to match focus
		if (this._lastSelectedPath !== item.path) {
			this._lastSelectedPath = item.path;
		}

		// Trigger re-render to update aria-activedescendant and focused state
		this.requestUpdate();

		// Then scroll item into view
		this.scrollToItem(index);
	}

	private scrollToItem(index: number) {
		// Prevent multiple simultaneous scroll operations
		if (this._scrolling) return;
		this._scrolling = true;

		// Wait for render to complete with updated focused state
		void this.updateComplete.then(() => {
			const virtualizer = this.virtualizerRef.value;
			const container = this.scrollableRef.value;

			if (!virtualizer || !container) {
				this._scrolling = false;
				return;
			}

			// Restore focus helper
			const restoreFocus = () => {
				if (container && document.activeElement !== container) {
					container.focus();
				}
				this._scrolling = false;
			};

			// For Home/End (large jumps to first/last item), use manual scrolling
			// scrollToIndex has known issues with large jumps causing blank screens
			const isHome = index === 0;
			const isEnd = index === (this.treeItems?.length ?? 0) - 1;

			if (isHome || isEnd) {
				// Use requestAnimationFrame to ensure DOM is ready
				requestAnimationFrame(() => {
					// Manually scroll the container to top or bottom
					if (isHome) {
						container.scrollTop = 0;
					} else {
						container.scrollTop = container.scrollHeight;
					}

					// Restore focus after scroll
					requestAnimationFrame(restoreFocus);
				});
			} else {
				// For small jumps, use scrollToIndex
				requestAnimationFrame(() => {
					const scrollPromise = virtualizer.scrollToIndex(index, 'nearest');

					// If scrollToIndex returns a promise, wait for it
					if (scrollPromise && typeof scrollPromise.then === 'function') {
						void scrollPromise.then(restoreFocus);
					} else {
						// Otherwise use RAF as fallback
						requestAnimationFrame(restoreFocus);
					}
				});
			}
		});
	}

	/**
	 * Handles type-ahead search functionality
	 * @param char The character to add to the search buffer
	 */
	private handleTypeAhead(char: string) {
		// Clear existing timer
		if (this._typeAheadTimer) {
			clearTimeout(this._typeAheadTimer);
		}

		// Check if this is a new search (buffer was cleared/undefined)
		const isNewSearch = !this._typeAheadBuffer;

		// Add character to buffer
		this._typeAheadBuffer += char.toLowerCase();

		// Check if current item still matches the new buffer
		const currentItem = this.treeItems?.[this._focusedItemIndex];
		const currentItemMatches = currentItem?.label?.toLowerCase().startsWith(this._typeAheadBuffer);

		let shouldMoveToNext = false;

		if (isNewSearch) {
			// Starting a new search - always find the best match
			shouldMoveToNext = true;
		} else if (!currentItemMatches) {
			// Current item no longer matches - need to find a new one
			shouldMoveToNext = true;
		}
		// If current item still matches and this is a continuation, stay put

		if (shouldMoveToNext) {
			const matchIndex = this.findNextMatchingItem(this._typeAheadBuffer);
			if (matchIndex !== -1) {
				this.focusItemAtIndex(matchIndex);
			}
		}

		// Set timer to clear buffer
		this._typeAheadTimer = window.setTimeout(() => {
			this._typeAheadBuffer = '';
			this._typeAheadTimer = undefined;
		}, this._typeAheadTimeout);
	}

	private buildPathToIndexMap() {
		this._pathToIndexMap.clear();
		if (!this.treeItems) {
			return;
		}
		let i = 0;
		for (const item of this.treeItems) {
			this._pathToIndexMap.set(item.path, i++);
		}
	}

	/**
	 * Finds the next tree item that matches the search buffer
	 * @param searchText The text to search for
	 * @returns The index of the matching item, or -1 if not found
	 */
	private findNextMatchingItem(searchText: string): number {
		if (!this.treeItems?.length || !searchText) return -1;

		const searchLower = searchText.toLowerCase();
		const currentIndex = this._focusedItemIndex;
		const len = this.treeItems.length;

		// Single loop with wraparound
		for (let offset = 1; offset < len; offset++) {
			const i = (currentIndex + offset) % len;
			if (this.treeItems[i].label?.toLowerCase().startsWith(searchLower)) {
				return i;
			}
		}

		return -1;
	}
	/**
	 * Checks if a character is printable (for type-ahead search)
	 * @param char The character to check
	 * @returns True if the character is printable
	 */
	private isPrintableCharacter(char: string): boolean {
		// Check if it's a single character and is alphanumeric or common punctuation
		return char.length === 1 && /^[a-zA-Z0-9\s\-_.]$/.test(char);
	}
}

/**
 * Flatten a hierarchical tree node into a flat array
 * Optionally populates a node map during traversal for O(1) lookups
 */
function flattenTree(
	tree: TreeModel,
	children: number = 1,
	position: number = 1,
	parentPath?: string,
	nodeMap?: Map<string, TreeModel>,
): TreeModelFlat[] {
	// Add to node map if provided (single traversal optimization)
	if (nodeMap) {
		nodeMap.set(tree.path, tree);
	}

	const node: TreeModelFlat = {
		...tree,
		size: children,
		position: position,
		parentPath: parentPath,
	};

	const nodes = [node];

	// Only include children if this node is expanded
	const isExpanded = tree.expanded !== false;
	if (tree.children != null && tree.children.length > 0 && isExpanded) {
		const childSize = tree.children.length;
		for (let i = 0; i < childSize; i++) {
			// Pass this node's path as the parent path for children
			nodes.push(...flattenTree(tree.children[i], childSize, i + 1, tree.path, nodeMap));
		}
	}

	return nodes;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tree-generator': GlTreeGenerator;
	}

	interface GlobalEventHandlersEventMap {
		'gl-tree-generated-item-action-clicked': CustomEvent<TreeItemActionDetail>;
		'gl-tree-generated-item-selected': CustomEvent<TreeItemSelectionDetail>;
		'gl-tree-generated-item-checked': CustomEvent<TreeItemCheckedDetail>;
	}
}
