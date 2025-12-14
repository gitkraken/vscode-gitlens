import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { FuzzyMatchResult } from '../../../../../system/fuzzy';
import { scrollableBase } from '../styles/lit/base.css';
import '../code-icon';

export interface CompletionItem<T = any> {
	label: string;
	description?: string;
	detail?: string;
	icon?: string;
	item: T;
	score?: number;
	match?: FuzzyMatchResult;
	alwaysVisible?: boolean;
}

/**
 * Event fired when a completion item is selected
 */
export interface CompletionSelectEvent {
	index: number;
	item: CompletionItem;
}

/**
 * Generic autocomplete/completion dropdown component
 */
@customElement('gl-autocomplete')
export class GlAutocomplete extends LitElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: contents;
			}

			:host(:not([open])) {
				display: none;
			}

			.scrollable {
				position: absolute;
				top: 100%;
				left: 0;
				right: 0;
				margin-top: 0.2rem;
				z-index: 1000;
				max-height: 20rem;
				overflow-y: auto;
				color: var(--vscode-quickInput-foreground);
				background-color: var(--vscode-quickInput-background);
				border: 1px solid var(--vscode-widget-border);
				border-radius: 0.4rem;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
			}

			.autocomplete-item {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 0.8rem;
				padding: 0.2rem 0.8rem;
				cursor: pointer;
			}

			.autocomplete-item:hover,
			.autocomplete-item.selected {
				background-color: var(--vscode-list-activeSelectionBackground);
				color: var(--vscode-list-activeSelectionForeground);

				.autocomplete-item__icon {
					color: var(--vscode-list-activeSelectionIconForeground);
					opacity: 1;
				}
			}

			.autocomplete-item__icon {
				display: flex;
				align-items: center;
				justify-content: center;
				width: 1.6rem;
				height: 1.6rem;
				flex-shrink: 0;
				opacity: 0.8;
			}

			.autocomplete-item__content {
				display: flex;
				flex-direction: column;
				gap: 0.1rem;
				flex: 1;
				min-width: 0;
			}

			.autocomplete-item__header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 1rem;
			}

			.autocomplete-item__primary {
				font-weight: 600;
				font-family: var(--vscode-editor-font-family);
				font-size: 0.9em;
			}

			.autocomplete-item.selected .autocomplete-item__primary {
				color: inherit;
			}

			.autocomplete-item__secondary {
				font-size: 0.85em;
				opacity: 0.7;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.autocomplete-item.selected .autocomplete-item__secondary {
				opacity: 0.9;
			}

			.autocomplete-item__highlight {
				font-weight: 700;
				color: var(--vscode-list-focusHighlightForeground, var(--vscode-textLink-foreground));
			}

			.autocomplete-item.selected .autocomplete-item__highlight {
				color: inherit;
				text-decoration: underline;
			}

			.autocomplete-item.help {
				cursor: default;
				background-color: var(--vscode-list-inactiveSelectionBackground) !important;
				color: var(--vscode-list-inactiveSelectionForeground);
				padding: 0.2rem 0.8rem;
				opacity: 1;
				gap: 0.5rem;
			}

			.autocomplete-item.help .autocomplete-item__content {
				flex-direction: column;
				align-items: flex-start;
				gap: 0.1rem;
			}

			.autocomplete-description {
				padding: 0.6rem 0.8rem;
				background-color: var(--vscode-list-inactiveSelectionBackground);
				color: var(--vscode-foreground);
				font-size: 0.85em;
				line-height: 1.4;
				border-bottom: 1px solid var(--vscode-widget-border);
			}

			.autocomplete-description:empty {
				display: none;
			}

			.autocomplete-description__example {
				display: block;
				margin-top: 0.4rem;
				color: var(--vscode-descriptionForeground);
				font-size: 0.95em;
			}

			.autocomplete-item.help .autocomplete-item__primary {
				font-weight: normal;
				color: var(--vscode-descriptionForeground);
			}

			.autocomplete-item.help .autocomplete-item__secondary {
				color: var(--vscode-descriptionForeground);
				opacity: 0.8;
			}
		`,
	];

	@property({ type: Array })
	items: CompletionItem[] = [];

	@property({ type: Boolean, reflect: true })
	open = false;

	@state()
	private _selectedIndex = -1;

	/**
	 * Gets the currently selected index (readonly from outside)
	 */
	get selectedIndex(): number {
		return this._selectedIndex;
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		// Clamp selection to valid range when items change
		if (changedProperties.has('items')) {
			if (this._selectedIndex >= this.items.length) {
				this._selectedIndex = this.items.length > 0 ? this.items.length - 1 : -1;
			}
		}

		if (changedProperties.has('_selectedIndex') && this._selectedIndex >= 0) {
			this.scrollToSelected();
		}
	}

	/**
	 * Gets the ID of the currently selected item for aria-activedescendant
	 */
	public getActiveDescendant(): string | undefined {
		if (!this.open || !this.items.length || this.selectedIndex < 0) {
			return undefined;
		}
		return `autocomplete-item-${this.selectedIndex}`;
	}

	/**
	 * Calculates how many items are visible in the scrollable area
	 */
	private getVisibleItemCount(): number {
		const scrollable = this.shadowRoot?.querySelector('.scrollable');
		const firstItem = this.shadowRoot?.querySelector('.autocomplete-item') as HTMLElement;

		if (!scrollable || !firstItem) {
			return 5; // Default fallback
		}

		const scrollableHeight = scrollable.clientHeight;
		const itemHeight = firstItem.offsetHeight;

		// Account for description height if present
		const description = this.shadowRoot?.querySelector('.autocomplete-description') as HTMLElement;
		const descriptionHeight = description?.offsetHeight ?? 0;

		const availableHeight = scrollableHeight - descriptionHeight;
		return Math.floor(availableHeight / itemHeight);
	}

	/** Resets selection to no selection */
	public resetSelection(): void {
		this._selectedIndex = -1;
	}

	/** Sets selection to a specific index */
	public setSelection(index: number): void {
		this._selectedIndex = Math.max(-1, Math.min(this.items.length - 1, index));
	}

	/** Moves selection up by one item */
	public selectPrevious(): void {
		this._selectedIndex = Math.max(-1, this._selectedIndex - 1);
	}

	/** Moves selection down by one item */
	public selectNext(): void {
		this._selectedIndex = Math.min(this.items.length - 1, this._selectedIndex + 1);
	}

	/** Jumps selection up by a page (visible items) */
	public pageUp(): void {
		const pageSize = this.getVisibleItemCount();
		this._selectedIndex = Math.max(0, this._selectedIndex - pageSize);
	}

	/** Jumps selection down by a page (visible items) */
	public pageDown(): void {
		const pageSize = this.getVisibleItemCount();
		this._selectedIndex = Math.min(this.items.length - 1, this._selectedIndex + pageSize);
	}

	private selectItem(index: number) {
		const item = this.items[index];
		if (!item) return;

		this.dispatchEvent(
			new CustomEvent<CompletionSelectEvent>('gl-autocomplete-select', {
				detail: { index: index, item: item },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * Highlights matched characters in a string based on fuzzy match indices
	 */
	private highlightMatches(text: string, matchedIndices: number[]): TemplateResult | TemplateResult[] {
		if (!matchedIndices.length) return html`${text}`;

		const parts: TemplateResult[] = [];
		let lastIndex = 0;

		for (const index of matchedIndices) {
			// Add unmatched text before this match
			if (index > lastIndex) {
				parts.push(html`${text.substring(lastIndex, index)}`);
			}
			// Add matched character with highlight
			parts.push(html`<span class="autocomplete-item__highlight">${text[index]}</span>`);
			lastIndex = index + 1;
		}

		// Add remaining unmatched text
		if (lastIndex < text.length) {
			parts.push(html`${text.substring(lastIndex)}`);
		}

		return parts;
	}

	private handleItemMouseDown(e: MouseEvent, index: number, _item: CompletionItem) {
		// Prevent blur on the input element
		e.preventDefault();
		this.selectItem(index);
	}

	private scrollToSelected() {
		const scrollable = this.shadowRoot?.querySelector('.scrollable');
		const selectedEl = this.shadowRoot?.querySelector('.autocomplete-item.selected') as HTMLElement;

		if (scrollable && selectedEl) {
			// If the first item is selected, scroll to the very top to ensure description is visible
			if (this.selectedIndex <= 0) {
				scrollable.scrollTop = 0;
				return;
			}

			const scrollableRect = scrollable.getBoundingClientRect();
			const selectedRect = selectedEl.getBoundingClientRect();

			if (selectedRect.bottom > scrollableRect.bottom) {
				scrollable.scrollTop += selectedRect.bottom - scrollableRect.bottom;
			} else if (selectedRect.top < scrollableRect.top) {
				scrollable.scrollTop -= scrollableRect.top - selectedRect.top;
			}
		}
	}

	override render() {
		return html`<div class="scrollable" role="listbox" tabindex="-1">
			<div class="autocomplete-description">
				<slot name="description"></slot>
			</div>
			${repeat(
				this.items,
				(item, index) => `${item.label}-${index}`,
				(item, index) => {
					const isSelected = index === this.selectedIndex;

					return html`<div
						id="autocomplete-item-${index}"
						class="autocomplete-item ${isSelected ? 'selected' : ''}"
						role="option"
						aria-selected="${isSelected}"
						@mousedown="${(e: MouseEvent) => this.handleItemMouseDown(e, index, item)}"
					>
						${item.icon
							? html`<div class="autocomplete-item__icon">
									<code-icon icon="${item.icon}"></code-icon>
								</div>`
							: nothing}
						<div class="autocomplete-item__content">
							<div class="autocomplete-item__header">
								<div class="autocomplete-item__primary">
									${item.match
										? this.highlightMatches(item.label, item.match.matchedIndices)
										: item.label}
								</div>
								${item.description
									? html`<div class="autocomplete-item__secondary">${item.description}</div>`
									: nothing}
							</div>
							${item.detail
								? html`<div class="autocomplete-item__secondary">${item.detail}</div>`
								: nothing}
						</div>
					</div>`;
				},
			)}
		</div>`;
	}
}
