import { consume } from '@lit/context';
import { css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { live } from 'lit/directives/live.js';
import type { SearchOperators, SearchQuery } from '../../../../../constants.search';
import { searchOperatorsToLongFormMap } from '../../../../../constants.search';
import { parseSearchQuery, rebuildSearchQueryFromParsed } from '../../../../../git/search';
import { areSearchQueriesEqual } from '../../../../../git/utils/search.utils';
import { filterMap } from '../../../../../system/array';
import { fuzzyFilter } from '../../../../../system/fuzzy';
import {
	ChooseAuthorRequest,
	ChooseComparisonRequest,
	ChooseFileRequest,
	ChooseRefRequest,
	SearchHistoryDeleteRequest,
	SearchHistoryGetRequest,
	SearchHistoryStoreRequest,
} from '../../../../plus/graph/protocol';
import { ipcContext } from '../../contexts/ipc';
import type { CompletionItem, CompletionSelectEvent, GlAutocomplete } from '../autocomplete/autocomplete';
import { GlElement } from '../element';
import type {
	SearchCompletionCommand,
	SearchCompletionItem,
	SearchCompletionOperator,
	SearchCompletionOperatorValue,
} from './models';
import {
	naturalLanguageSearchAutocompleteCommand,
	searchCompletionOperators,
	structuredSearchAutocompleteCommand,
} from './models';
import '../button';
import '../autocomplete/autocomplete';
import '../code-icon';
import '../copy-container';

export interface SearchNavigationEventDetail {
	direction: 'first' | 'previous' | 'next' | 'last';
}

export interface SearchModeChangeEventDetail {
	searchMode: 'normal' | 'filter';
	useNaturalLanguage: boolean;
}

export interface SearchCancelEventDetail {
	preserveResults: boolean;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-search-input': GlSearchInput;
	}

	interface GlobalEventHandlersEventMap {
		'gl-search-inputchange': CustomEvent<SearchQuery>;
		'gl-search-navigate': CustomEvent<SearchNavigationEventDetail>;
		'gl-search-modechange': CustomEvent<SearchModeChangeEventDetail>;
		'gl-search-cancel': CustomEvent<SearchCancelEventDetail>;
		'gl-search-pause': CustomEvent<void>;
		'gl-search-resume': CustomEvent<void>;
	}
}

@customElement('gl-search-input')
export class GlSearchInput extends GlElement {
	static override styles = css`
		* {
			box-sizing: border-box;
		}

		:host {
			--gl-search-input-background: var(--vscode-input-background);
			--gl-search-input-foreground: var(--vscode-input-foreground);
			--gl-search-input-border: var(--vscode-input-border);
			--gl-search-input-placeholder: var(
				--vscode-editor-placeholder\\\.foreground,
				var(--vscode-input-placeholderForeground)
			);
			--gl-search-input-buttons-left: 1;
			--gl-search-input-buttons-right: 4;

			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			position: relative;

			flex: auto 1 1;
		}

		:host([data-ai-allowed]) {
			--gl-search-input-buttons-left: 2;
		}

		:host([data-natural-language-mode]) {
			--gl-search-input-buttons-right: 0;
		}

		:host([data-natural-language-mode][data-has-input]) {
			--gl-search-input-buttons-right: 2;
		}

		:host(:not([data-natural-language-mode])[data-has-input]) {
			--gl-search-input-buttons-right: 5;
		}

		label {
			display: flex;
			justify-content: center;
			align-items: center;
			gap: 0.2rem;
			width: 3.2rem;
			height: 2.4rem;
			color: var(--gl-search-input-foreground);
			cursor: pointer;
			border-radius: 3px;
		}
		label:hover {
			background-color: var(--vscode-toolbar-hoverBackground);
		}
		label:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		.icon-small {
			font-size: 1rem;
		}

		.field {
			position: relative;
			flex: auto 1 1;
		}

		input {
			width: 100%;
			height: 2.7rem;
			background-color: var(--gl-search-input-background);
			color: var(--gl-search-input-foreground);
			border: 1px solid var(--gl-search-input-border);
			border-radius: 0.25rem;
			padding-top: 0;
			padding-bottom: 1px;
			padding-left: calc(0.7rem + calc(1.96rem * var(--gl-search-input-buttons-left)));
			padding-right: calc(0.7rem + calc(1.96rem * var(--gl-search-input-buttons-right)));
			font-family: inherit;
			font-size: inherit;
		}

		input:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}
		input::placeholder {
			color: var(--gl-search-input-placeholder);
		}

		input::-webkit-search-cancel-button {
			display: none;
		}

		input[aria-valid='false'] {
			border-color: var(--vscode-inputValidation-errorBorder);
		}
		input[aria-valid='false']:focus {
			outline-color: var(--vscode-inputValidation-errorBorder);
		}

		.message {
			position: absolute;
			top: 100%;
			left: 0;
			width: 100%;
			padding: 0.4rem;
			transform: translateY(-0.1rem);
			z-index: 1000;
			background-color: var(--vscode-inputValidation-infoBackground);
			border: 1px solid var(--vscode-inputValidation-infoBorder);
			color: var(--gl-search-input-foreground);
			font-size: 1.2rem;
			line-height: 1.4;
		}

		input[aria-valid='false'] ~ .message {
			background-color: var(--vscode-inputValidation-errorBackground);
			border-color: var(--vscode-inputValidation-errorBorder);
		}

		/* Input highlighting overlay */
		.input-container {
			position: relative;
		}

		.input-highlight {
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			pointer-events: none;
			white-space: pre;
			overflow: hidden;
			box-sizing: border-box;
			height: 2.7rem;
			border: 1px solid transparent;
			border-radius: 0.25rem;
			font-family: inherit;
			font-size: inherit;
			line-height: 2.7rem;
			color: var(--gl-search-input-foreground);
			/* Match input padding exactly, but using margins to ensure clipping */
			margin-top: 0;
			margin-bottom: 1px;
			margin-left: calc(0.7rem + calc(1.96rem * var(--gl-search-input-buttons-left)));
			margin-right: calc(0.7rem + calc(1.96rem * var(--gl-search-input-buttons-right)));
		}

		/* CSS Custom Highlight API for operators */
		::highlight(search-operators) {
			color: var(--vscode-textLink-foreground);
			font-weight: 600;
		}

		/* Input with transparent background and text to show overlay */
		.input-container input {
			position: relative;
			z-index: 1;
			background: transparent;
			/* Make input text invisible so only overlay shows */
			color: transparent;
			caret-color: var(--gl-search-input-foreground);
		}

		/* In natural language mode, show the input text normally */
		:host([data-natural-language-mode]) .input-container input {
			color: var(--gl-search-input-foreground);
		}

		/* Keep placeholder visible */
		.input-container input::placeholder {
			color: var(--gl-search-input-placeholder);
		}

		.controls {
			position: absolute;
			top: 0.2rem;
			right: 0.2rem;
			display: inline-flex;
			flex-direction: row;
			gap: 0.1rem;
			z-index: 2; /* Above input and overlay */
		}

		.controls.controls__start {
			--button-compact-padding: 0.4rem;
			--button-line-height: 1;

			left: 0.2rem;
			right: auto;
		}

		button {
			padding: 0;
			color: var(--gl-search-input-foreground);
			border: 1px solid transparent;
			background: none;
		}
		button:focus:not([disabled]) {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}
		button:not([disabled]) {
			cursor: pointer;
		}

		.example {
			display: inline-block;
		}

		code {
			display: inline-block;
			backdrop-filter: brightness(1.3);
			border-radius: 3px;
			padding: 0px 4px;
			font-family: var(--vscode-editor-font-family);
		}

		/* .popover {
			margin-left: -0.25rem;
		}
		.popover::part(body) {
			padding: 0 0 0.5rem 0;
			font-size: var(--vscode-font-size);
			background-color: var(--vscode-menu-background);
		} */

		gl-copy-container {
			margin-top: -0.1rem;
		}
	`;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@query('input') input!: HTMLInputElement;

	@property({ type: Boolean }) aiAllowed = true;
	@property({ type: Boolean }) filter = false;
	@property({ type: Boolean }) matchAll = false;
	@property({ type: Boolean }) matchCase = false;
	@property({ type: Boolean }) matchRegex = true;
	@property({ type: Boolean }) matchWholeWord = false;
	@property({ type: Boolean }) naturalLanguage = false;
	@property({ type: Boolean }) searching = false;
	@property({ type: Boolean }) hasMoreResults = false;
	@property({ type: String })
	get value() {
		return this._value;
	}
	set value(value: string) {
		const oldValue = this._value;
		this._value = value;
		if (oldValue !== value) {
			this.requestUpdate('value', oldValue);
		}
	}

	@state() private errorMessage = '';
	@state() private processedQuery: string | undefined;
	@state() private _value = '';

	// Autocomplete state
	@state() private autocompleteOpen = false;
	@state() private autocompleteItems: SearchCompletionItem[] = [];
	@state() private cursorOperator?: SearchCompletionOperator;
	private cursorPosition: [number, number] = [0, 0];

	@query('gl-autocomplete') private autocomplete?: GlAutocomplete;

	private canDeleteHistoryItem = false;

	// Track last search to avoid re-searching on Enter when query hasn't changed
	private _lastSearch: SearchQuery | undefined = undefined;

	private get inputFocused(): boolean {
		return this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement === this.input : false;
	}

	private get label() {
		return this.filter ? 'Filter' : 'Search';
	}

	get matchCaseOverride(): boolean {
		return this.matchRegex ? this.matchCase : true;
	}

	get matchWholeWordOverride(): boolean {
		return this.matchRegex ? this.matchWholeWord : false;
	}

	/** State before the user navigates to a history entry */
	private originalHistoryState: Required<Omit<SearchQuery, 'filter'>> | undefined;

	private get placeholder() {
		if (this.naturalLanguage) {
			return `${this.label} commits using natural language (↑↓ for history), e.g. my commits from last week`;
		}
		return `${this.label} commits (press Enter to search, ↑↓ for history), e.g. @me after:1.week.ago file:*.ts`;
	}

	private repoPath: string | undefined;

	private _searchHistory: SearchQuery[] = [];
	private searchHistoryPos = -1;
	private get searchHistory() {
		return this._searchHistory;
	}
	private set searchHistory(value: SearchQuery[]) {
		this._searchHistory = value;
		this.searchHistoryPos = -1;
		this.originalHistoryState = undefined;
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		void this._ipc
			.sendRequest(SearchHistoryGetRequest, { repoPath: this.repoPath })
			.then(response => (this.searchHistory = response.history))
			.catch(() => {});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		// Clean up CSS highlights
		CSS.highlights.delete('search-operators');
	}

	override focus(options?: FocusOptions): void {
		this.input.focus(options);
	}

	override willUpdate(changedProperties: Map<PropertyKey, unknown>) {
		if (changedProperties.has('aiAllowed')) {
			if (!this.aiAllowed && this.naturalLanguage) {
				this.updateNaturalLanguage(false);
			}
		}

		super.willUpdate(changedProperties);
	}

	override updated(changedProperties: Map<PropertyKey, unknown>) {
		this.toggleAttribute('data-ai-allowed', this.aiAllowed);
		this.toggleAttribute('data-has-input', Boolean(this._value?.length));
		this.toggleAttribute('data-natural-language-mode', this.naturalLanguage);

		// Update highlights and sync scroll when value changes
		if (changedProperties.has('_value') || changedProperties.has('naturalLanguage')) {
			const input = this.input;
			const highlight = this.renderRoot.querySelector('.input-highlight') as HTMLElement;
			if (input && highlight) {
				highlight.scrollLeft = input.scrollLeft;
			}
			this.applyHighlights();
		}

		// When searching state changes in NL mode, ensure autocomplete is open to show progress
		if (changedProperties.has('searching') && this.naturalLanguage) {
			this.autocompleteOpen = this.inputFocused;
		}

		super.updated(changedProperties);
	}

	private handleInputFocus(_e: FocusEvent) {
		this.updateAutocomplete();
	}

	private handleInputBlur(_e: Event) {
		this.hideAutocomplete();
	}

	private cancelSearch() {
		// Clear all search-related UI state
		this.errorMessage = '';
		this.processedQuery = undefined;
		this.searchHistoryPos = -1;
		this.originalHistoryState = undefined;

		// Emit cancel to backend - idempotent, safe to always call
		this.emit('gl-search-cancel', { preserveResults: false });

		// Send empty search immediately to clear results
		this.onSearchChanged(true);
		this._lastSearch = undefined;
	}

	private handleClear(_e: Event) {
		this._value = '';
		this.cancelSearch();
		this.focus();
	}

	private handleInputClick(_e: MouseEvent) {
		this.updateAutocomplete();
	}

	private handleInput(e: InputEvent) {
		const value = (e.target as HTMLInputElement)?.value;
		this.value = value;

		if (!value) {
			// Input is now empty - cancel and clear search
			this.cancelSearch();
		} else {
			// Input has content - update UI state
			this.errorMessage = '';
			this.processedQuery = undefined;
			this.canDeleteHistoryItem = false;

			// Reset history position when user types something different
			if (this.searchHistoryPos >= 0 && value !== this.searchHistory[this.searchHistoryPos]?.query) {
				this.searchHistoryPos = -1;
				this.originalHistoryState = undefined;
			}

			this.updateAutocomplete();
		}
	}

	/**
	 * Updates autocomplete suggestions based on current cursor position and input
	 */
	private updateAutocomplete() {
		const cursor = this.input?.selectionStart ?? 0;
		const value = this.value;

		// In natural language mode, always show welcome message (unless searching or have processed query)
		// Don't show operator suggestions in NL mode
		if (this.naturalLanguage) {
			this.autocompleteItems = [structuredSearchAutocompleteCommand];
			this.cursorOperator = undefined;
			this.cursorPosition = [0, 0];
			this.autocomplete?.resetSelection();
			this.autocompleteOpen = this.inputFocused;
			return;
		}

		// Scenario 1: Empty Input or just focused (show welcome + all operators)
		if (!value) {
			const operators = searchCompletionOperators.map<SearchCompletionItem>(m => ({
				label: m.operator,
				description: m.aliases.join(', '),
				detail: m.description,
				icon: m.icon,
				item: m,
				score: 1,
			}));

			// In structured mode, add a toggle to NL suggestion at the top
			this.autocompleteItems = [naturalLanguageSearchAutocompleteCommand, ...operators];

			this.cursorOperator = undefined;
			this.cursorPosition = [0, 0];
			this.autocomplete?.resetSelection();
			this.autocompleteOpen = this.inputFocused;
			return;
		}

		// Find the word/operator being typed at cursor position
		// Find the start of the current word/token
		let start = cursor - 1;
		while (start >= 0 && !/\s/.test(value[start])) {
			start--;
		}
		start++; // Move to first non-whitespace character

		// Find the end of the current word/token (for detecting if cursor is within an operator)
		let end = cursor;
		while (end < value.length && !/\s/.test(value[end])) {
			end++;
		}

		// Extract the token and the pattern before cursor
		const token = value.substring(start, end);
		const pattern = value.substring(start, cursor);

		// Scenario 3: Cursor is anywhere within a complete operator
		// Check the full token to see if it starts with a complete operator
		if (token.includes(':')) {
			const colonIndex = token.indexOf(':');
			const opPart = token.substring(0, colonIndex + 1);
			const op = searchOperatorsToLongFormMap.get(opPart as SearchOperators);

			// Only proceed if cursor is at or after the colon
			const cursorOffsetInToken = cursor - start;
			if (op && cursorOffsetInToken >= colonIndex + 1) {
				const operator = searchCompletionOperators.find(m => m.operator === op);
				if (operator) {
					// If operator has predefined values, show them as suggestions
					if (operator.values?.length) {
						const valuePart = token.substring(opPart.length);
						// Use pattern (text before cursor) for fuzzy matching, not the full token
						const valuePattern = pattern.substring(opPart.length);

						// Check if we already have a complete value match (using full token)
						// Exclude command items (they're not actual values, they're actions to help pick values)
						const completeValue = operator.values.find(
							v => !isValueCommand(v.value) && v.value === valuePart,
						);
						if (completeValue && cursor === end) {
							// Only show complete value help if cursor is at the end
							this.autocompleteItems = [];
							this.cursorOperator = completeValue.description
								? { ...operator, description: completeValue.description, example: undefined }
								: operator;
							this.cursorPosition = [start, end];
							this.autocomplete?.resetSelection();
							this.autocompleteOpen = this.inputFocused;
							return;
						}

						// Fuzzy match based on text before cursor (valuePattern)
						const matches: SearchCompletionItem[] = filterMap(operator.values, v => {
							// Command items are always included (not filtered)
							if (isValueCommand(v.value)) {
								return {
									label: v.label,
									detail: v.description,
									icon: v.icon,
									item: v.value,
									score: 0,
								} satisfies SearchCompletionItem;
							}

							// For regular value items, match against value
							const result = fuzzyFilter(valuePattern, [v.value], a => a)[0];
							return result?.match.matches
								? ({
										label: v.label,
										detail: v.description,
										icon: v.icon,
										item: { operator: op, value: v.value },
										score: result.match.score,
										match: result.match,
									} satisfies SearchCompletionItem)
								: null;
						});

						// Always show value suggestions (even if empty) when in value context
						matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
						this.autocompleteItems = matches;
						this.cursorOperator = operator; // Show operator description
						this.cursorPosition = [start + opPart.length, end];
						this.autocompleteOpen = this.inputFocused;
						// Only select first item if there's an actual match (score > 0)
						const hasMatch = matches.length > 0 && (matches[0].score ?? 0) > 0;
						if (hasMatch) {
							this.autocomplete?.setSelection(0);
						} else {
							this.autocomplete?.resetSelection();
						}
						return;
					}

					// Default: show operator help text
					this.autocompleteItems = [];
					this.cursorOperator = operator;
					this.cursorPosition = [start, end];
					this.autocomplete?.resetSelection();
					this.autocompleteOpen = this.inputFocused;
					return;
				}
			}
		}

		// Also check if the pattern itself matches an operator with a colon
		// This handles the case where cursor is right after typing the operator with colon
		// Note: We only show help if the operator has a colon, otherwise show autocomplete
		for (const [_shortForm, op] of searchOperatorsToLongFormMap.entries()) {
			// Only match if the pattern includes the colon
			if (pattern === op) {
				const operator = searchCompletionOperators.find(m => m.operator === op);
				if (operator) {
					// If operator has predefined values, show them as suggestions
					if (operator.values?.length) {
						this.autocompleteItems = operator.values.map(
							v =>
								({
									label: v.label,
									detail: v.description,
									icon: v.icon,
									item: isValueCommand(v.value) ? v.value : { operator: op, value: v.value },
									score: 1,
								}) satisfies SearchCompletionItem,
						);
						this.cursorOperator = operator; // Show operator description
						this.cursorPosition = [start + op.length, end];
						this.autocompleteOpen = true;
						// Don't select anything when just showing all values (no user input yet)
						this.autocomplete?.resetSelection();
						return;
					}

					// Default: show operator help text
					this.autocompleteItems = [];
					this.cursorOperator = operator;
					this.cursorPosition = [start, end];
					this.autocompleteOpen = true;
					this.autocomplete?.resetSelection();
					return;
				}
			}
		}

		// Scenario 2: Typing an operator (partial)
		// Perform fuzzy matching on all operators and their aliases
		const matches: CompletionItem<SearchCompletionOperator>[] = [];

		for (const metadata of searchCompletionOperators) {
			// Try matching against the operator name and all aliases
			const searchTerms = [metadata.operator, ...metadata.aliases];

			for (const term of searchTerms) {
				if (!term) continue; // Skip empty string

				const result = fuzzyFilter(pattern, [term], a => a)[0];
				if (result?.match.matches) {
					// Check if we already have this operator with a better score
					const existing = matches.find(m => m.item.operator === metadata.operator);
					if (!existing || result.match.score > (existing.score ?? 0)) {
						if (existing) {
							existing.score = result.match.score;
							existing.match = result.match;
						} else {
							matches.push({
								label: metadata.operator,
								description: metadata.aliases.join(', '),
								detail: metadata.description,
								icon: metadata.icon,
								item: metadata,
								score: result.match.score,
								match: result.match,
							});
						}
					}
				}
			}
		}

		// If no matches, show only the NL suggestion in structured mode
		if (!matches.length) {
			if (!this.naturalLanguage) {
				this.autocompleteItems = [naturalLanguageSearchAutocompleteCommand];
				this.cursorOperator = undefined;
				this.cursorPosition = [start, end];
				this.autocompleteOpen = true;
				this.autocomplete?.resetSelection();
			} else {
				this.hideAutocomplete();
			}
			return;
		}

		// Sort by score (descending) and take top 7
		matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
		let newItems: SearchCompletionItem[] = matches.slice(0, 7);

		// In structured mode, add "Switch to NL" suggestion at the bottom
		if (!this.naturalLanguage) {
			newItems = [...newItems, naturalLanguageSearchAutocompleteCommand];
		}

		this.autocompleteItems = newItems;
		this.cursorOperator = undefined;
		this.cursorPosition = [start, end];
		this.autocompleteOpen = true;
		// Select first item if we have operator matches (not just the NL toggle)
		if (matches.length > 0) {
			this.autocomplete?.setSelection(0);
		} else {
			this.autocomplete?.resetSelection();
		}
	}

	private hideAutocomplete() {
		this.autocompleteOpen = false;
		this.autocompleteItems = [];
		this.autocomplete?.resetSelection();
	}

	/**
	 * Handles picker commands (author, ref, file/folder)
	 */
	private async handlePickerCommand(command: SearchCompletionCommand) {
		const value = this.value;
		const operator = this.cursorOperator?.operator;
		if (!operator) return;

		// Get the current value at the cursor position (if any)
		const currentValue = value.substring(this.cursorPosition[0], this.cursorPosition[1]).trim();

		try {
			switch (command.command) {
				case 'pick-author': {
					const result = await this._ipc.sendRequest(ChooseAuthorRequest, {
						title: 'Search by Author',
						placeholder: 'Choose contributors to include commits from',
						picked: currentValue ? [currentValue] : undefined,
					});

					if (result.authors?.length) {
						this.insertPickerValues(result.authors, operator, command.multi ?? false);
						return;
					}
					break;
				}

				case 'pick-ref': {
					const result = await this._ipc.sendRequest(ChooseRefRequest, {
						title: 'Search by Branch or Tag',
						placeholder: 'Choose a branch or tag to filter by',
						allowedAdditionalInput: { range: false, rev: false },
						include: ['branches', 'tags', 'HEAD'],
						picked: currentValue || undefined,
					});

					if (result?.name) {
						this.insertPickerValues([result.name], operator, command.multi ?? false);
						return;
					}
					break;
				}

				case 'pick-comparison': {
					const result = await this._ipc.sendRequest(ChooseComparisonRequest, {
						title: 'Search by Comparison Range',
						placeholder: 'Choose two refs to compare',
					});

					if (result?.range) {
						this.insertPickerValues([result.range], operator, false);
						return;
					}
					break;
				}

				case 'pick-file':
				case 'pick-folder': {
					const result = await this._ipc.sendRequest(ChooseFileRequest, {
						title: command.command === 'pick-file' ? 'Search by File' : 'Search by Folder',
						type: command.command === 'pick-file' ? 'file' : 'folder',
						openLabel: 'Add to Search',
						picked: currentValue ? [currentValue] : undefined,
					});

					if (result.files?.length) {
						this.insertPickerValues(result.files, operator, command.multi ?? false);
						return;
					}
					break;
				}
			}
		} catch {}

		// User cancelled or error occurred - just return focus to input
		this.input.focus();
	}

	/**
	 * Inserts values from a picker into the search query
	 * @param values - The values to insert
	 * @param operator - The operator these values belong to
	 * @param multi - Whether to insert as multiple operator:value pairs (true) or space-separated values (false)
	 */
	private insertPickerValues(values: string[], operator: string, multi: boolean) {
		const value = this.value;

		// For multi mode, create separate operator:value pairs for each value
		// First value doesn't need operator prefix (it's already in the input), rest do
		// For single mode, join values with spaces
		let insertText: string;
		if (multi) {
			insertText = values.map((v, i) => (i === 0 ? v : `${operator}${v}`)).join(' ');
		} else {
			insertText = values.join(' ');
		}

		// Replace the current token (from cursorPosition[0] to cursorPosition[1]) with the selected values
		let newValue =
			value.substring(0, this.cursorPosition[0]) + insertText + value.substring(this.cursorPosition[1]);

		// Calculate cursor position after the inserted text (before deduplication)
		const cursorPos = this.cursorPosition[0] + insertText.length;

		// Deduplicate by parsing and rebuilding the query
		// The parsed operations use Sets, so duplicates are automatically removed
		const parsed = parseSearchQuery({ query: newValue } as SearchQuery);
		newValue = rebuildSearchQueryFromParsed(parsed);

		// Update the input value directly
		this.input.value = newValue;
		this._value = newValue;

		// Position cursor after the inserted text
		// Note: If deduplication removed text, cursor might be beyond the end, so clamp it
		const finalCursorPos = Math.min(cursorPos, newValue.length);
		this.input.focus();
		this.input.selectionStart = finalCursorPos;
		this.input.selectionEnd = finalCursorPos;

		// Update autocomplete in the next frame to ensure input is updated
		window.requestAnimationFrame(() => this.updateAutocomplete());
	}

	/**
	 * Accepts the currently selected autocomplete suggestion
	 */
	private async acceptAutocomplete(index: number) {
		const selected = this.autocompleteItems[index];
		if (!selected) return;

		// Check if this is a command (toggle natural language or picker command)
		if ('command' in selected.item) {
			if (selected.item.command === 'toggle-natural-language-mode') {
				this.updateNaturalLanguage(!this.naturalLanguage);
				return;
			}

			// It's a picker command
			await this.handlePickerCommand(selected.item);
			return;
		}

		// Type guard to ensure we have an operator
		if (!('operator' in selected.item)) return;

		const operator = selected.item.operator;
		const value = this.value;

		// Determine what to insert:
		// - If it's a value completion, insert just the value (cursorPosition[0] is already after the operator)
		// - Otherwise, insert the operator
		const insertText = 'value' in selected.item ? selected.item.value : operator;

		// Replace the entire token (from cursorPosition[0] to cursorPosition[1]) with the selected text
		// This ensures we don't leave partial text when cursor is in the middle of a token
		const newValue =
			value.substring(0, this.cursorPosition[0]) + insertText + value.substring(this.cursorPosition[1]);

		// Update the input value directly
		this.input.value = newValue;
		this._value = newValue;

		// Position cursor after the inserted text
		const cursorPos = this.cursorPosition[0] + insertText.length;
		this.input.focus();
		this.input.selectionStart = cursorPos;
		this.input.selectionEnd = cursorPos;

		// Update autocomplete in the next frame to ensure input is updated
		window.requestAnimationFrame(() => this.updateAutocomplete());
	}

	private handleMatchAll(_e: Event) {
		this.matchAll = !this.matchAll;
		if (this.value) {
			this.onSearchChanged(true);
		}
	}

	private handleMatchCase(_e: Event) {
		this.matchCase = !this.matchCase;
		if (this.value) {
			this.onSearchChanged(true);
		}
	}

	private handleMatchRegex(_e: Event) {
		this.matchRegex = !this.matchRegex;
		if (this.value) {
			this.onSearchChanged(true);
		}
	}

	private handleMatchWholeWord(_e: Event) {
		this.matchWholeWord = !this.matchWholeWord;
		if (this.value) {
			this.onSearchChanged(true);
		}
	}

	private handleFilterClick(_e: Event) {
		this.filter = !this.filter;
		this.emit('gl-search-modechange', {
			searchMode: this.filter ? 'filter' : 'normal',
			useNaturalLanguage: this.naturalLanguage,
		});
		// Don't trigger a new search - just update the mode for future searches
		// and let the UI update based on the current results
	}

	private handleNaturalLanguageClick(_e: Event) {
		this.updateNaturalLanguage(!this.naturalLanguage);
		// Don't trigger a new search - just update the mode for future searches
		// and let the UI update based on the current results
	}

	private updateNaturalLanguage(useNaturalLanguage: boolean) {
		this.processedQuery = undefined;

		this.naturalLanguage = useNaturalLanguage && this.aiAllowed;
		this.emit('gl-search-modechange', {
			searchMode: this.filter ? 'filter' : 'normal',
			useNaturalLanguage: this.naturalLanguage,
		});

		// Update autocomplete to reflect the new mode
		this.updateAutocomplete();
	}

	private handleKeyup(e: KeyboardEvent) {
		// Don't update autocomplete on navigation keys - they're handled in handleShortcutKeys
		if (
			e.key !== 'ArrowUp' &&
			e.key !== 'ArrowDown' &&
			e.key !== 'PageUp' &&
			e.key !== 'PageDown' &&
			e.key !== 'Escape'
		) {
			this.updateAutocomplete();
		}
	}

	private handleShortcutKeys(e: KeyboardEvent): boolean {
		if (e.key !== 'Delete') {
			this.canDeleteHistoryItem = false;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return false;

		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();

				if (this.autocompleteOpen) {
					this.hideAutocomplete();
				} else if (this.searching) {
					// If search is running, pause it (preserve results)
					this.emit('gl-search-pause');
				}

				return true;

			case 'Enter': {
				e.preventDefault();
				e.stopPropagation();

				// Accept autocomplete selection if visible AND an item is selected
				const selectedIndex = this.autocomplete?.selectedIndex ?? -1;
				if (this.autocompleteOpen && this.autocompleteItems.length && selectedIndex >= 0) {
					void this.acceptAutocomplete(selectedIndex);
					return true;
				}

				// If search box is empty, cancel and clear immediately
				if (!this.value) {
					this.cancelSearch();
					return true;
				}

				// Check if search has changed
				const currentSearch: SearchQuery = {
					query: this.value,
					naturalLanguage: this.naturalLanguage ? { query: this.value } : undefined,
					filter: this.filter,
					matchAll: this.matchAll,
					matchCase: this.matchCase,
					matchRegex: this.matchRegex,
					matchWholeWord: this.matchWholeWord,
				};

				const hasSearchChanged = !areSearchQueriesEqual(this._lastSearch, currentSearch);

				if (hasSearchChanged) {
					this.searchHistoryPos = -1;

					// Search changed - trigger new search
					this.onSearchChanged(true);
				} else if (!this.searching && this.hasMoreResults) {
					// Search unchanged and paused with more results - resume search
					this.emit('gl-search-resume');
				} else {
					// Search unchanged - navigate to next result (works in both NL and non-NL modes)
					this.emit('gl-search-navigate', { direction: e.shiftKey ? 'previous' : 'next' });
				}

				return true;
			}
			case 'Tab': {
				// If autocomplete is open AND an item is selected, accept the selection
				const tabSelectedIndex = this.autocomplete?.selectedIndex ?? -1;
				if (this.autocompleteOpen && this.autocompleteItems.length && tabSelectedIndex >= 0) {
					e.preventDefault();
					e.stopPropagation();

					void this.acceptAutocomplete(tabSelectedIndex);
					return true;
				}
				// Otherwise, let Tab work normally for focus management
				break;
			}

			case 'PageUp':
				if (this.autocompleteOpen && this.autocompleteItems.length) {
					e.preventDefault();
					e.stopPropagation();

					this.autocomplete?.pageUp();
					return true;
				}
				break;

			case 'PageDown':
				if (this.autocompleteOpen && this.autocompleteItems.length) {
					e.preventDefault();
					e.stopPropagation();

					this.autocomplete?.pageDown();
					return true;
				}
				break;

			case 'ArrowUp':
			case 'ArrowDown':
				e.preventDefault();
				e.stopPropagation();

				// Navigate autocomplete if visible
				if (this.autocompleteOpen && this.autocompleteItems.length) {
					// Only navigate within autocomplete if not at start of input with ArrowUp (to allow history navigation)
					if (e.key === 'ArrowUp' && this.autocomplete?.selectedIndex === -1) {
						this.hideAutocomplete();
					} else {
						if (e.key === 'ArrowUp') {
							this.autocomplete?.selectPrevious();
						} else {
							this.autocomplete?.selectNext();
						}
						return true;
					}
				} else if (e.key === 'ArrowDown' && this.searchHistoryPos === -1) {
					this.updateAutocomplete();
					return true;
				}

				if (this.searchHistory.length) {
					let nextPos;
					if (this.searchHistoryPos === -1) {
						this.originalHistoryState = {
							query: this.value,
							naturalLanguage: this.naturalLanguage,
							matchAll: this.matchAll,
							matchCase: this.matchCase,
							matchRegex: this.matchRegex,
							matchWholeWord: this.matchWholeWord,
						};
						nextPos = e.key === 'ArrowUp' ? (this.value === this.searchHistory[0]?.query ? 1 : 0) : -1;
					} else {
						nextPos = this.searchHistoryPos + (e.key === 'ArrowUp' ? 1 : -1);
					}

					if (nextPos >= this.searchHistory.length) {
						nextPos = this.searchHistory.length - 1;
					}

					if (nextPos < -1) {
						nextPos = -1;
					}

					this.searchHistoryPos = nextPos;
					this.canDeleteHistoryItem = true;

					if (this.searchHistoryPos === -1) {
						if (this.originalHistoryState != null) {
							this.value = this.originalHistoryState.query;
							this.naturalLanguage = Boolean(this.originalHistoryState.naturalLanguage);
							this.matchAll = this.originalHistoryState.matchAll;
							this.matchCase = this.originalHistoryState.matchCase;
							this.matchRegex = this.originalHistoryState.matchRegex;
							this.matchWholeWord = this.originalHistoryState.matchWholeWord;
						} else {
							this.value = '';
						}
					} else {
						const entry = this.searchHistory[this.searchHistoryPos];
						if (entry != null) {
							this.value = entry.query;
							this.naturalLanguage = Boolean(entry.naturalLanguage);
						}
					}
				}

				return true;

			case 'Delete':
				if (this.canDeleteHistoryItem && this.searchHistoryPos > -1) {
					e.preventDefault();
					e.stopPropagation();

					const entry = this.searchHistory[this.searchHistoryPos];
					if (entry != null) {
						void this.deleteHistoryEntry(entry.query);
					}

					return true;
				}
				break;
		}

		return false;
	}

	/**
	 * Validates the raw query string using parseSearchQuery.
	 * Returns an error message if query is empty or invalid, otherwise undefined.
	 */
	private validateQuery(raw: string): string | undefined {
		if (!raw) return undefined;

		const { operations, errors } = parseSearchQuery({ query: raw } as SearchQuery, true);
		if (errors?.length) return errors[0];

		// If no operations were parsed, the query is effectively empty
		if (!operations.size) return 'Enter a search value';

		return undefined;
	}

	private onSearchChanged(force = false) {
		if (!this.naturalLanguage && this.value) {
			// Only validate non-empty structured queries before starting the search
			const invalid = this.validateQuery(this.value);
			// Let's not show errors to the user since it's too noisy
			// this.setCustomValidity(error);
			if (invalid) return;
		}

		const search: SearchQuery = {
			query: this.value,
			naturalLanguage: this.naturalLanguage ? { query: this.value } : undefined,
			filter: this.filter,
			matchAll: this.matchAll,
			matchCase: this.matchCase,
			matchRegex: this.matchRegex,
			matchWholeWord: this.matchWholeWord,
		};

		// Only emit if search changed or forced
		if (!force && this._lastSearch && areSearchQueriesEqual(search, this._lastSearch)) return;

		this._lastSearch = search;

		this.emit('gl-search-inputchange', search);
	}

	setCustomValidity(errorMessage: string = ''): void {
		this.errorMessage = errorMessage;
	}

	async logSearch(search: SearchQuery): Promise<void> {
		// Store exactly what user entered/sees (NL form or structured form)
		let queryToStore;
		if (search.naturalLanguage) {
			if (typeof search.naturalLanguage === 'boolean') {
				queryToStore = search.query;
				this.processedQuery = undefined;
				this.errorMessage = '';
			} else if (search.naturalLanguage.error) {
				queryToStore = search.naturalLanguage.query;
				this.processedQuery = undefined;
				this.errorMessage = search.naturalLanguage.error;
			} else {
				queryToStore = search.naturalLanguage.query;
				this.processedQuery = search.naturalLanguage.processedQuery;
				this.errorMessage = '';
			}
		} else {
			// Only validate structured queries before storing the search
			const invalid = this.validateQuery(search.query);
			if (invalid) return;

			queryToStore = search.query;
		}

		const searchToStore: SearchQuery = { ...search, query: queryToStore };

		try {
			const response = await this._ipc.sendRequest(SearchHistoryStoreRequest, {
				repoPath: this.repoPath,
				search: searchToStore,
			});
			this.searchHistory = response.history;
			this.searchHistoryPos = -1;
		} catch {}
	}

	private async deleteHistoryEntry(query: string): Promise<void> {
		try {
			const response = await this._ipc.sendRequest(SearchHistoryDeleteRequest, {
				repoPath: this.repoPath,
				query: query,
			});
			this.searchHistory = response.history;
			// Move to next entry if available, otherwise restore original value
			if (this.searchHistoryPos >= 0 && this.searchHistoryPos < this.searchHistory.length) {
				const entry = this.searchHistory[this.searchHistoryPos];
				this.value = entry.query;
				this.naturalLanguage = Boolean(entry.naturalLanguage);
			} else {
				this.searchHistoryPos = -1;
				this.originalHistoryState = undefined;
				this.value = '';
				this.naturalLanguage = false;
			}
		} catch {
			// Silent failure - keep existing history
		}
	}

	setSearchQuery(query: string): void {
		this._value = query;
	}

	/**
	 * Sets a search query from an external source (e.g., extension host).
	 * This updates the UI but does NOT trigger a search - the caller should trigger the search if needed.
	 */
	setExternalSearchQuery(search: SearchQuery): void {
		this._value = search.query;
		this.filter = search.filter ?? true;
		this.matchAll = search.matchAll ?? false;
		this.matchCase = search.matchCase ?? false;
		this.matchRegex = search.matchRegex ?? true;
		this.matchWholeWord = search.matchWholeWord ?? false;
		this.naturalLanguage = Boolean(search.naturalLanguage);

		// Don't trigger a search - just update the UI
		// The caller (graph-app.ts) will trigger the search if needed
	}

	override render(): unknown {
		return html`<div class="field">
				<div class="controls controls__start">
					<gl-button
						appearance="input"
						role="checkbox"
						aria-checked="${this.filter}"
						tooltip="Filter Commits"
						aria-label="Filter Commits"
						@click="${this.handleFilterClick}"
					>
						<code-icon icon="list-filter"></code-icon>
					</gl-button>
					${this.aiAllowed
						? html`<gl-button
								appearance="input"
								role="checkbox"
								aria-checked="${this.naturalLanguage}"
								tooltip="Natural Language Search (AI Preview)"
								aria-label="Natural Language Search (AI Preview)"
								@click="${this.handleNaturalLanguageClick}"
							>
								<code-icon icon="sparkle"></code-icon>
							</gl-button>`
						: nothing}
				</div>
				<div class="input-container">
					<div class="input-highlight" aria-hidden="true">${this.renderHighlightedText()}</div>
					<input
						id="search"
						part="search"
						type="text"
						role="combobox"
						aria-autocomplete="list"
						aria-controls="autocomplete-list"
						aria-expanded="${this.autocompleteOpen}"
						aria-activedescendant="${ifDefined(
							this.autocompleteOpen && this.autocompleteItems.length > 0
								? this.autocomplete?.getActiveDescendant()
								: undefined,
						)}"
						spellcheck="false"
						placeholder="${this.placeholder}"
						.value="${live(this.value ?? '')}"
						aria-valid="${!this.errorMessage}"
						@input="${this.handleInput}"
						@keydown="${this.handleShortcutKeys}"
						@keyup="${this.handleKeyup}"
						@click="${this.handleInputClick}"
						@focus="${this.handleInputFocus}"
						@blur="${this.handleInputBlur}"
						@scroll="${this.handleInputScroll}"
					/>
					${this.errorMessage ? html`<div class="message">${this.errorMessage}</div>` : nothing}
					${this.renderAutocomplete()}
				</div>
			</div>
			<div class="controls">
				${this.value
					? html`<gl-button
							appearance="input"
							tooltip="Clear"
							aria-label="Clear"
							@click="${this.handleClear}"
						>
							<code-icon icon="close"></code-icon>
						</gl-button>`
					: nothing}
				${this.renderSearchOptions()}
			</div>`;
	}

	private handleAutocompleteSelect(e: CustomEvent<CompletionSelectEvent>) {
		const { index, item } = e.detail;

		// Check if this is the toggle natural language command
		if ('command' in item.item && item.item.command === 'toggle-natural-language-mode') {
			this.updateNaturalLanguage(!this.naturalLanguage);
			return;
		}

		void this.acceptAutocomplete(index);
	}

	private handleInputScroll(_e: Event) {
		// Sync scroll position of highlight overlay with input
		const input = this.input;
		const highlight = this.renderRoot.querySelector('.input-highlight') as HTMLElement;
		if (input && highlight) {
			highlight.scrollLeft = input.scrollLeft;
		}
	}

	/**
	 * Applies CSS Custom Highlight API to the overlay text
	 */
	private applyHighlights() {
		// Clear existing highlights
		CSS.highlights.delete('search-operators');

		// Don't highlight in natural language mode or if no value
		if (this.naturalLanguage || !this.value) return;

		const highlightEl = this.renderRoot.querySelector('.input-highlight') as HTMLElement;
		if (!highlightEl) return;

		// Parse the query to get operator positions
		const parsed = parseSearchQuery({
			query: this.value,
			matchAll: this.matchAll,
			matchCase: this.matchCase,
			matchRegex: this.matchRegex,
			matchWholeWord: this.matchWholeWord,
		});

		if (!parsed.operatorRanges?.length) return;

		try {
			// Find the text node - Lit may create comment nodes, so we need to search for the actual text node
			let textNode: Node | null = null;
			for (const node of highlightEl.childNodes) {
				if (node.nodeType === Node.TEXT_NODE) {
					textNode = node;
					break;
				}
			}

			if (!textNode) return;

			// Create ranges for each operator
			const ranges = parsed.operatorRanges.map(({ start, end }) => {
				const range = new Range();
				range.setStart(textNode, start);
				range.setEnd(textNode, end);
				return range;
			});

			// Apply the highlight
			const highlight = new Highlight(...ranges);
			CSS.highlights.set('search-operators', highlight);
		} catch (ex) {
			debugger;
			console.error('[search-input] Error applying highlights:', ex);
		}
	}

	/**
	 * Renders the highlighted text overlay for the input
	 */
	private renderHighlightedText() {
		// Don't highlight in natural language mode or if no value
		if (this.naturalLanguage || !this.value) return nothing;

		// Just return the plain text - highlighting will be done via CSS Highlight API
		return this.value;
	}

	private renderAutocomplete() {
		// Show description if we have items, operator help, or NL mode
		const hasDescription = Boolean(this.autocompleteItems.length || this.naturalLanguage || this.cursorOperator);

		return html`<gl-autocomplete
			id="autocomplete-list"
			.items="${this.autocompleteItems}"
			?open="${this.autocompleteOpen && hasDescription && !this.errorMessage}"
			@gl-autocomplete-select="${this.handleAutocompleteSelect}"
			@gl-autocomplete-cancel="${this.hideAutocomplete}"
		>
			${hasDescription
				? html`<div slot="description">
						${this.cursorOperator
							? html`${this.cursorOperator.description}${this.renderOperatorExample(this.cursorOperator)}`
							: this.naturalLanguage
								? this.renderNaturalLanguageDescription()
								: html`Combine filters to build powerful searches, e.g.
										<code>@me after:1.week.ago file:*.ts</code>`}
					</div>`
				: nothing}
		</gl-autocomplete>`;
	}

	private renderOperatorExample(operator: SearchCompletionOperator | undefined) {
		if (operator?.example) {
			return html`<span class="example">${operator.example}</span>`;
		}
		return nothing;
	}

	private renderNaturalLanguageDescription() {
		if (this.searching) {
			return html`<code-icon icon="loading" modifier="spin"></code-icon> Processing your natural language query...`;
		}

		if (this.processedQuery) {
			return html`Query: <code>${this.processedQuery}</code>`;
		}

		return html`Describe what you're looking for and let AI build the query, e.g.
			<code>my commits from last week</code> or <code>changes to package.json by eamodio last month</code>`;
	}

	private renderSearchOptions() {
		if (this.naturalLanguage) {
			return this.value
				? html`<gl-copy-container
						appearance="toolbar"
						copyLabel="Copy Query"
						.content=${this.processedQuery}
						placement="bottom"
						?disabled=${!this.processedQuery}
					>
						<code-icon
							icon="copy"
							tabindex="0"
							role="button"
							aria-label="Copy Query"
							class="copy-icon"
						></code-icon>
					</gl-copy-container>`
				: nothing;
		}

		return html`<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchCaseOverride}"
				tooltip="Match Case${this.matchCaseOverride && !this.matchCase
					? ' (always on without regular expressions)'
					: ''}"
				aria-label="Match Case${this.matchCaseOverride && !this.matchCase
					? ' (always on without regular expressions)'
					: ''}"
				?disabled="${!this.matchRegex}"
				@click="${this.handleMatchCase}"
			>
				<code-icon icon="case-sensitive"></code-icon>
			</gl-button>
			<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchWholeWordOverride}"
				tooltip="Match Whole Word${this.matchWholeWordOverride && !this.matchWholeWord
					? ' (requires regular expressions)'
					: ''}"
				aria-label="Match Whole Word${this.matchWholeWordOverride && !this.matchWholeWord
					? ' (requires regular expressions)'
					: ''}"
				?disabled="${!this.matchRegex}"
				@click="${this.handleMatchWholeWord}"
			>
				<code-icon icon="whole-word"></code-icon>
			</gl-button>
			<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchRegex}"
				tooltip="Use Regular Expression"
				aria-label="Use Regular Expression"
				@click="${this.handleMatchRegex}"
			>
				<code-icon icon="regex"></code-icon>
			</gl-button>
			<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchAll}"
				tooltip="Match All"
				aria-label="Match All"
				@click="${this.handleMatchAll}"
			>
				<code-icon icon="check-all"></code-icon>
			</gl-button>`;
	}
}

function isValueCommand(value: SearchCompletionOperatorValue['value']): value is SearchCompletionCommand {
	return typeof value !== 'string';
}
