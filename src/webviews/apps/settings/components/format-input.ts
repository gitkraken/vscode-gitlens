import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type {
	CompletionItem,
	CompletionSelectEvent,
	GlAutocomplete,
} from '../../shared/components/autocomplete/autocomplete.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import { formatDate } from '../../shared/date.js';
import type { SettingsActions } from '../actions.js';
import type { FormatTokenInfo } from '../format-tokens.js';
import { dateFormatTokens, getFormatTokens } from '../format-tokens.js';
import type { TextDescriptor } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/autocomplete/autocomplete.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/markdown/markdown.js';
import '../../shared/components/overlays/popover.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-format-input']: GlFormatInput;
	}
}

/** The fixed sample date used by date-format previews (parity with the legacy app). */
// `getTimezoneOffset()` is inverted relative to a GMT suffix (e.g. UTC+5:30 reports -330), and it's
// minutes, not a base-100 hour fraction — split into hours/minutes rather than scaling by 100 so
// fractional-hour zones (e.g. India, +5:30) don't mis-encode (naive `/60*100` gave "GMT+0550").
const tzo = new Date().getTimezoneOffset();
const tzSign = tzo >= 0 ? '-' : '+';
const tzAbs = Math.abs(tzo);
const tzHours = String(Math.floor(tzAbs / 60)).padStart(2, '0');
const tzMinutes = String(tzAbs % 60).padStart(2, '0');
const sampleDate = new Date(`Wed Jul 25 2018 19:18:00 GMT${tzSign}${tzHours}${tzMinutes}`);

/** Which token set (if any) the input offers, and the grammar affordances it exposes. */
type TokenMode = 'commit' | 'hover' | 'file' | 'date';

/** The mutually-exclusive width modifier flag — the grammar accepts ONE flag after the width, never both. */
type WidthFlag = '' | '?' | '-';

const commitDocsUrl = 'https://github.com/gitkraken/vscode-gitlens/wiki/Custom-Formatting';
const dateDocsUrl = 'https://momentjs.com/docs/#/displaying/format/';

/** Matches an unclosed `${` immediately before the caret, capturing the partial token being typed. */
const typeaheadRegex = /\$\{([A-Za-z]*)$/;

/**
 * A text input for format strings with a live example line, a context-aware
 * `${token}` insert menu, an inline `${` typeahead, and a builder for the
 * modifier grammar (`${'prefix'token|width?-'suffix'}`).
 *
 * Editing is drafted locally and committed when focus leaves the component or
 * on Enter — moving focus to the token menu does NOT commit (parity with the
 * legacy popup, which suppressed blur). The example reacts to the draft.
 */
@customElement('gl-format-input')
export class GlFormatInput extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: block;
			}

			.label {
				display: flex;
				gap: var(--gl-space-8);
				align-items: baseline;
				margin-block-end: 0.7rem;
				font-size: 1.25rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.label__dirty {
				font-size: 1.05rem;
				font-weight: 400;
				color: var(--color-foreground--65);
			}

			.field-wrap {
				position: relative;
				max-width: var(--gl-max-input);
			}

			.field {
				position: relative;
			}

			input {
				width: 100%;
				padding: 0.7rem 3rem 0.7rem 0.9rem;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.25rem;
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius, 0.4rem);
			}

			input:focus {
				${focusOutline}
			}

			input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.controls {
				position: absolute;
				inset-block: 0;
				inset-inline-end: 0.4rem;
				display: inline-flex;
				align-items: center;
			}

			/* gl-popover slots the trigger into a block context, so blockify it to its own height instead of the inline line-box height */
			.controls gl-button {
				display: inline-flex;
			}

			/* Token menu (chevron popover) */
			.tokens {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
				min-width: 34rem;
			}

			.tokens__title {
				padding: 0.2rem 0.2rem 0;
				margin: 0;
				font-size: 1.05rem;
				font-weight: 400;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.05em;
			}

			.tokens__search {
				width: 100%;
				padding: 0.5rem 0.7rem;
				font-size: 1.15rem;
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-radius-sm, 0.4rem);
			}

			.tokens__search:focus-visible {
				${focusOutline}
			}

			.token-list {
				display: flex;
				flex-direction: column;
				max-height: 26rem;
				overflow-y: auto;
			}

			.token {
				display: flex;
				gap: var(--gl-space-12);
				align-items: center;
				justify-content: space-between;
				width: 100%;
				padding: 0.5rem 0.9rem;
				text-align: left;
				cursor: pointer;
				background: transparent;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.token:hover,
			.token[aria-selected='true'] {
				background-color: var(--vscode-list-hoverBackground);
			}

			.token:focus-visible {
				${focusOutline}
			}

			.token code {
				font-family: var(--vscode-editor-font-family);
				font-size: 1.15rem;
				color: var(--gl-chip-filtered-text-color, var(--color-link-foreground));
			}

			.token span {
				font-size: 1.1rem;
				color: var(--color-foreground--65);
			}

			/* Modifier builder */
			.mods {
				display: flex;
				flex-direction: column;
				border-block-start: var(--gl-border-width) solid var(--vscode-menu-separatorBackground, transparent);
			}

			.mods__toggle {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: 0.5rem 0.2rem;
				font-size: 1.15rem;
				color: var(--color-foreground);
				text-align: left;
				cursor: pointer;
				background: transparent;
				border: none;
			}

			.mods__toggle:focus-visible {
				${focusOutline}
			}

			.mods__body {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 0.6rem 0.9rem;
				padding: 0.2rem 0.2rem 0.5rem;
			}

			.mods__field {
				display: flex;
				flex-direction: column;
				gap: 0.3rem;
				font-size: 1.05rem;
				color: var(--color-foreground--75);
			}

			.mods__field input {
				padding: 0.4rem 0.6rem;
				font-size: 1.15rem;
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-radius-sm, 0.4rem);
			}

			.mods__align {
				grid-column: 1 / -1;
				display: flex;
				flex-wrap: wrap;
				gap: 0.3rem 1.2rem;
				padding: 0;
				margin: 0;
				border: none;
			}

			.mods__align legend {
				padding: 0;
				margin-block-end: 0.3rem;
				font-size: 1.05rem;
				color: var(--color-foreground--75);
			}

			.mods__radio {
				display: flex;
				gap: 0.4rem;
				align-items: center;
				font-size: 1.1rem;
				color: var(--color-foreground);
			}

			.mods__preview {
				grid-column: 1 / -1;
				margin: 0;
				font-size: 1.1rem;
				color: var(--color-foreground--65);
			}

			.mods__preview code {
				font-family: var(--vscode-editor-font-family);
				color: var(--color-link-foreground);
			}

			.tokens__hint {
				padding: 0.6rem 0.2rem 0.2rem;
				font-size: 1.1rem;
				color: var(--color-foreground--65);
			}

			.example {
				display: flex;
				gap: var(--gl-space-6);
				align-items: baseline;
				margin-block-start: 0.7rem;
				font-size: 1.15rem;
				color: var(--color-foreground--65);
			}

			.example__text {
				font-style: italic;
				color: var(--color-foreground--85);
			}

			.example--error .example__text {
				font-style: normal;
				color: var(--vscode-errorForeground);
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	descriptor!: TextDescriptor;

	@property({ attribute: false })
	actions?: SettingsActions;

	@property({ type: Boolean })
	disabled: boolean = false;

	@query('input#input')
	private _input!: HTMLInputElement;

	/** Local draft while the user is editing; undefined renders the config value. */
	@state()
	private _draft: string | undefined;

	@state()
	private _example: string = '';

	/** Whether the current example represents a render error (styled + not italic). */
	@state()
	private _exampleError: boolean = false;

	// ── Token-menu (popover) state ──
	@state()
	private _menuFilter: string = '';

	/** Roving-tabindex active option in the token list. */
	@state()
	private _activeIndex: number = 0;

	@state()
	private _showModifiers: boolean = false;

	// ── Modifier builder state ──
	@state()
	private _modPrefix: string = '';

	@state()
	private _modSuffix: string = '';

	/** Width as a raw string so an empty field is distinct from 0 (`|0` collapses to prefix+suffix). */
	@state()
	private _modWidth: string = '';

	@state()
	private _modFlag: WidthFlag = '';

	// ── Inline `${` typeahead state ──
	@state()
	private _suggestOpen: boolean = false;

	@state()
	private _suggestQuery: string = '';

	@query('gl-autocomplete')
	private _autocomplete?: GlAutocomplete;

	/** Tracks descriptor identity so a reused instance drops a stale draft/example on switch. */
	private _lastDescriptorKey: string | undefined;

	/**
	 * The `descriptor.key`+value pair `updateExample()` last actually recomputed for — guards against
	 * `updated()` re-firing the debounced preview RPC (or re-running `formatDate` synchronously) on
	 * every reactive render, when unrelated @state changes (token-menu filter, arrow-nav index,
	 * modifier prefix/suffix/width, typeahead query) don't touch the format value.
	 */
	private _lastExampleKey: string | undefined;

	private get value(): string {
		return this._draft ?? String(this._state.getSettingValue(this.descriptor.key) ?? '');
	}

	override willUpdate(): void {
		// A single instance is reused for different descriptors (position-based reuse when switching
		// categories), so drop the in-progress draft/example AND all transient menu/builder/typeahead
		// state when the descriptor identity changes (parity with gl-setting-control's number-draft reset)
		if (this.descriptor.key !== this._lastDescriptorKey) {
			this._lastDescriptorKey = this.descriptor.key;
			this._draft = undefined;
			this._example = '';
			this._exampleError = false;
			this._menuFilter = '';
			this._activeIndex = 0;
			this._showModifiers = false;
			this._modPrefix = '';
			this._modSuffix = '';
			this._modWidth = '';
			this._modFlag = '';
			// Clear the guard too — otherwise a coincidental key collision with the previous
			// descriptor (same value string) would stale-skip the new descriptor's first recompute
			this._lastExampleKey = undefined;
			this._closeSuggestions();
		}
	}

	override updated(): void {
		this.updateExample();
	}

	private readonly requestPreview = debounce((type: 'commit' | 'commit-uncommitted' | 'file', format: string) => {
		const key = this.descriptor.key;
		// Hover/tooltip formats render as markdown at runtime, so their preview must too
		const markdown = this.tokenMode === 'hover';
		void this.actions
			?.generateFormatPreview(key, type, format, markdown)
			.then(preview => {
				// The instance is reused across descriptors; ignore a late preview for a previous one
				if (this.descriptor.key !== key) return;

				this._example = preview;
				// The host returns an `Invalid format: …` message as a resolved value (it never rejects
				// on a bad template), so detect the error case to style the example line accordingly
				this._exampleError = preview.startsWith('Invalid format');
			})
			.catch(() => {
				// Transport-level failure (IPC) — surface it instead of swallowing (concern 2)
				if (this.descriptor.key !== key) return;

				this._example = 'Preview unavailable';
				this._exampleError = true;
			});
	}, 200);

	private updateExample(): void {
		const d = this.descriptor;
		const preview = d.preview;
		if (preview == null) return;

		let value = this.value;

		// `updated()` calls this on every reactive render, but only the format value (not the token-menu
		// filter, arrow-nav index, modifier builder fields, or typeahead query) should trigger a
		// recompute — skip re-running `formatDate`/re-firing the debounced preview RPC when unchanged.
		const key = `${this.descriptor?.key ?? ''} ${value}`;
		if (key === this._lastExampleKey) return;

		this._lastExampleKey = key;

		switch (preview.type) {
			case 'commit':
			case 'commit-uncommitted':
			case 'file': {
				// Empty value falls back to the literal default FIRST, then the lookup key (legacy order)
				if (!value) {
					value =
						preview.default ??
						(preview.defaultLookup != null
							? (this._state.getSettingValue<string>(preview.defaultLookup) ?? '')
							: '');
				}
				if (!value) {
					this._example = '';
					this._exampleError = false;
					return;
				}

				this.requestPreview(preview.type, value);
				break;
			}
			case 'date': {
				// Empty value falls back to the lookup key FIRST, then the literal default (legacy order)
				if (!value) {
					value =
						(preview.defaultLookup != null
							? this._state.getSettingValue<string>(preview.defaultLookup)
							: undefined) ??
						preview.default ??
						'';
				}
				try {
					this._example = formatDate(sampleDate, value, undefined, false);
					this._exampleError = false;
				} catch (ex) {
					this._example = ex instanceof Error ? ex.message : String(ex);
					this._exampleError = true;
				}
				break;
			}
			case 'date-locale': {
				// Value is a locale; the format comes from the lookup key
				const format =
					(preview.defaultLookup != null
						? this._state.getSettingValue<string>(preview.defaultLookup)
						: undefined) ??
					preview.default ??
					'MMMM Do, YYYY h:mma';
				try {
					this._example = formatDate(sampleDate, format, value || undefined, false);
					this._exampleError = false;
				} catch (ex) {
					this._example = ex instanceof Error ? ex.message : String(ex);
					this._exampleError = true;
				}
				break;
			}
		}
	}

	private commit(): void {
		if (this._draft === undefined) return;

		const value = this._draft;
		this._draft = undefined;
		void this.actions?.applyText(this.descriptor.key, value, this.descriptor.defaultValue);
	}

	private handleInput(e: Event): void {
		this._draft = (e.target as HTMLInputElement).value;
		this.updateSuggestions();
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (this._suggestOpen) {
			const suggestions = this.suggestions;
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					this._autocomplete?.selectNext();
					return;
				case 'ArrowUp':
					e.preventDefault();
					this._autocomplete?.selectPrevious();
					return;
				case 'Enter':
				case 'Tab': {
					const index = this._autocomplete?.selectedIndex ?? -1;
					if (index >= 0 && suggestions.length) {
						e.preventDefault();
						this.acceptSuggestion(suggestions[index].token);
						return;
					}

					// No option highlighted: Enter applies the format (the open palette must not swallow
					// it); Tab falls through so focus leaves and handleFocusOut commits.
					if (e.key === 'Enter') {
						e.preventDefault();
						this._closeSuggestions();
						this.commit();
					}

					return;
				}
				case 'Escape':
					e.preventDefault();
					this._closeSuggestions();
					return;
			}
			return;
		}

		if (e.key === 'Enter') {
			this.commit();
		} else if (e.key === 'Escape' && this._draft !== undefined) {
			this._draft = undefined;
		}
	}

	private handleFocusOut(e: FocusEvent): void {
		// Moving focus within the component (e.g. into the token menu) must not commit
		const next = e.relatedTarget as Node | null;
		if (next != null && (this.renderRoot.contains(next) || this.contains(next))) return;

		this._closeSuggestions();
		this.commit();
	}

	/**
	 * Which token set (if any) this input offers. Date-format strings get
	 * Moment.js tokens; the `${...}` sets are context-tagged per descriptor.
	 */
	private get tokenMode(): TokenMode | undefined {
		if (this.descriptor.preview?.type === 'date') return 'date';

		const tokens = this.descriptor.tokens;
		if (tokens === 'file') return 'file';
		if (tokens === 'hover') return 'hover';
		if (tokens === true) return 'commit';
		return undefined;
	}

	/** The full token catalog for the current context. */
	private get tokens(): FormatTokenInfo[] {
		const mode = this.tokenMode;
		if (mode == null) return [];
		if (mode === 'date') return dateFormatTokens;
		return getFormatTokens(mode);
	}

	/** Tokens filtered by the popover search box. */
	private get filteredTokens(): FormatTokenInfo[] {
		const filter = this._menuFilter.trim().toLowerCase();
		if (!filter) return this.tokens;

		return this.tokens.filter(
			t => t.token.toLowerCase().includes(filter) || t.label.toLowerCase().includes(filter),
		);
	}

	/** Tokens matching the current inline `${` typeahead query. */
	private get suggestions(): FormatTokenInfo[] {
		const q = this._suggestQuery.toLowerCase();
		const tokens = this.tokens;
		if (!q) return tokens;
		return tokens.filter(t => t.token.toLowerCase().includes(q) || t.label.toLowerCase().includes(q));
	}

	/** The current typeahead matches projected into the shared autocomplete's item shape. */
	private get suggestionItems(): CompletionItem<FormatTokenInfo>[] {
		const bare = this.tokenMode === 'date';
		return this.suggestions.map(t => ({
			// oxlint-disable-next-line prefer-template -- `\${` escaping is harder to read than concatenation
			label: bare ? t.token : '${' + t.token + '}',
			description: t.label,
			item: t,
		}));
	}

	/** Composes a token with the current modifier-builder settings, per the `${'prefix'token|width?-'suffix'}` grammar. */
	private composeToken(token: string): string {
		const prefix = this._modPrefix ? `'${this._modPrefix}'` : '';
		const suffix = this._modSuffix ? `'${this._modSuffix}'` : '';
		const width = this._modWidth.trim();
		// A single flag follows the width; `?` and `-` are mutually exclusive in the grammar, so the
		// builder models them as a radio — never emit both
		const modifier = width || this._modFlag ? `|${width}${this._modFlag}` : '';
		// oxlint-disable-next-line prefer-template -- `\${` escaping is harder to read than concatenation
		return '${' + prefix + token + modifier + suffix + '}';
	}

	private insertText(text: string): void {
		const input = this._input;

		const start = input.selectionStart ?? input.value.length;
		const end = input.selectionEnd ?? start;
		const value = input.value;
		this._draft = value.substring(0, start) + text + value.substring(end);

		void this.updateComplete.then(() => {
			input.focus();
			const caret = start + text.length;
			input.setSelectionRange(caret, caret);
		});
	}

	/** Inserts a token from the popover, applying the modifier builder (or bare, for date tokens). */
	private insertToken(token: FormatTokenInfo): void {
		this.insertText(this.tokenMode === 'date' ? token.token : this.composeToken(token.token));
	}

	// ── Token palette ──

	private getTokenQueryContext(): { kind: 'in-token' | 'loose'; query: string; start: number } {
		const input = this._input;
		const caret = input.selectionStart ?? input.value.length;
		const before = input.value.substring(0, caret);

		if (this.tokenMode !== 'date') {
			const match = typeaheadRegex.exec(before);
			if (match != null) {
				return { kind: 'in-token', query: match[1], start: caret - match[1].length };
			}
		}

		const query = /[A-Za-z]*$/.exec(before)?.[0] ?? '';
		return { kind: 'loose', query: query, start: caret - query.length };
	}

	private updateSuggestions(): void {
		if (this.tokenMode == null) {
			this._closeSuggestions();
			return;
		}

		const ctx = this.getTokenQueryContext();
		this._suggestQuery = ctx.query;
		this._suggestOpen = true;

		void this.updateComplete.then(() => {
			// Auto-highlight ONLY when completing inside a `${…}`, so a bare Enter in loose/palette
			// mode still commits the format instead of accepting a token.
			if (ctx.kind === 'in-token' && this.suggestions.length) {
				this._autocomplete?.setSelection(0);
			} else {
				this._autocomplete?.resetSelection();
			}
		});
	}

	private acceptSuggestion(token: string): void {
		const input = this._input;
		const value = input.value;
		const caret = input.selectionStart ?? value.length;
		const ctx = this.getTokenQueryContext();

		let completion: string;
		let caretOffset = 0;
		if (ctx.kind === 'in-token') {
			// Skip the closing brace when one already follows the caret, so `${au|}` → `${author}` (not `${author}}`)
			const hasClosingBrace = value[caret] === '}';
			completion = hasClosingBrace ? token : `${token}}`;
			caretOffset = hasClosingBrace ? 1 : 0;
		} else {
			completion = this.tokenMode === 'date' ? token : `\${${token}}`;
		}

		this._draft = value.substring(0, ctx.start) + completion + value.substring(caret);
		this._closeSuggestions();

		void this.updateComplete.then(() => {
			input.focus();
			const next = ctx.start + completion.length + caretOffset;
			input.setSelectionRange(next, next);
		});
	}

	private _closeSuggestions(): void {
		this._suggestOpen = false;
		this._suggestQuery = '';
		this._autocomplete?.resetSelection();
	}

	private handleSuggestionSelect(e: CustomEvent<CompletionSelectEvent>): void {
		// The token info is carried in the completion item; accept it via the shared brace-aware path.
		this.acceptSuggestion((e.detail.item.item as FormatTokenInfo).token);
	}

	// ── Token-menu keyboard navigation (roving tabindex) ──

	private focusOption(index: number): void {
		const options = this.renderRoot.querySelectorAll<HTMLButtonElement>('.token');
		options[index]?.focus();
	}

	private handleSearchKeyDown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' && this.filteredTokens.length) {
			e.preventDefault();
			this._activeIndex = 0;
			this.focusOption(0);
		}
	}

	private handleListKeyDown(e: KeyboardEvent): void {
		const count = this.filteredTokens.length;
		if (!count) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				this._activeIndex = (this._activeIndex + 1) % count;
				this.focusOption(this._activeIndex);
				break;
			case 'ArrowUp':
				e.preventDefault();
				this._activeIndex = (this._activeIndex - 1 + count) % count;
				this.focusOption(this._activeIndex);
				break;
			case 'Home':
				e.preventDefault();
				this._activeIndex = 0;
				this.focusOption(0);
				break;
			case 'End':
				e.preventDefault();
				this._activeIndex = count - 1;
				this.focusOption(count - 1);
				break;
		}
	}

	private handleMenuShown(): void {
		// The chevron menu and the inline palette are redundant surfaces — don't show both at once
		this._closeSuggestions();
		this._activeIndex = 0;
		void this.updateComplete.then(() => {
			this.renderRoot.querySelector<HTMLInputElement>('.tokens__search')?.focus();
		});
	}

	private handleMenuHidden(): void {
		this._menuFilter = '';
		this._activeIndex = 0;
	}

	override render(): unknown {
		const d = this.descriptor;
		const mode = this.tokenMode;
		const dirty = this._draft !== undefined;
		// Any field with a token set exposes the palette combobox (date included)
		const typeahead = mode != null;

		return html`<label class="label" for="input">
				${d.label}${
					dirty
						? html`<span class="label__dirty" aria-live="polite">Unsaved — press Enter to apply</span>`
						: nothing
				}
			</label>
			<div class="field-wrap">
				<div class="field" @focusout=${this.handleFocusOut}>
					<input
						id="input"
						type="text"
						spellcheck="false"
						role=${ifDefined(typeahead ? 'combobox' : undefined)}
						aria-expanded=${ifDefined(typeahead ? String(this._suggestOpen) : undefined)}
						aria-controls=${ifDefined(typeahead ? 'token-suggestions' : undefined)}
						aria-autocomplete=${ifDefined(typeahead ? 'list' : undefined)}
						aria-activedescendant=${ifDefined(
							typeahead && this._suggestOpen && this.suggestions.length > 0
								? this._autocomplete?.getActiveDescendant()
								: undefined,
						)}
						.value=${this.value}
						placeholder=${ifDefined(d.placeholder)}
						?disabled=${this.disabled}
						@input=${this.handleInput}
						@keydown=${this.handleKeyDown}
						@focus=${this.updateSuggestions}
						@click=${this.updateSuggestions}
					/>
					${mode != null ? html`<div class="controls">${this.renderTokenMenu(mode)}</div>` : nothing}
				</div>
				<gl-autocomplete
					id="token-suggestions"
					.items=${this.suggestionItems}
					?open=${this._suggestOpen && this.suggestions.length > 0}
					@gl-autocomplete-select=${this.handleSuggestionSelect}
					@gl-autocomplete-active-change=${() => this.requestUpdate()}
				></gl-autocomplete>
			</div>
			${
				d.preview != null
					? html`<p
							class="example ${this._exampleError ? 'example--error' : ''}"
							aria-live="polite"
							aria-atomic="true"
						>
							<span>Example:</span>
							${
								mode === 'hover' && !this._exampleError && this._example
									? html`<gl-markdown inline .markdown=${this._example}></gl-markdown>`
									: html`<span class="example__text">${this._example || '—'}</span>`
							}
						</p>`
					: nothing
			}`;
	}

	private renderTokenMenu(mode: TokenMode): unknown {
		const tokens = this.filteredTokens;
		const docsUrl = mode === 'date' ? dateDocsUrl : commitDocsUrl;

		return html`<gl-popover
			trigger="click"
			placement="bottom-end"
			@gl-popover-after-show=${this.handleMenuShown}
			@gl-popover-after-hide=${this.handleMenuHidden}
		>
			<gl-button slot="anchor" appearance="input" aria-label="Insert a token" ?disabled=${this.disabled}>
				<code-icon icon="chevron-down" aria-hidden="true"></code-icon>
			</gl-button>
			<div slot="content" class="tokens">
				<h3 class="tokens__title">Insert token</h3>
				<input
					class="tokens__search"
					type="text"
					spellcheck="false"
					placeholder="Search tokens…"
					aria-label="Search tokens"
					.value=${this._menuFilter}
					@input=${(e: Event) => {
						this._menuFilter = (e.target as HTMLInputElement).value;
						this._activeIndex = 0;
					}}
					@keydown=${this.handleSearchKeyDown}
				/>
				<div class="token-list" role="listbox" aria-label="Available tokens" @keydown=${this.handleListKeyDown}>
					${
						tokens.length
							? tokens.map((t, i) => {
									// Date tokens insert bare; `${}` tokens show their base form (the modifier
									// builder below reflects the composed shape that will actually be inserted)
									const display = mode === 'date' ? t.token : `\${${t.token}}`;
									return html`<button
										type="button"
										class="token"
										role="option"
										tabindex=${i === this._activeIndex ? '0' : '-1'}
										aria-selected=${i === this._activeIndex}
										@click=${() => this.insertToken(t)}
										@focus=${() => {
											this._activeIndex = i;
										}}
									>
										<code>${display}</code><span>${t.label}</span>
									</button>`;
								})
							: html`<p class="tokens__hint">No matching tokens</p>`
					}
				</div>
				${mode !== 'date' ? this.renderModifiers() : nothing}
				<span class="tokens__hint">
					<a href=${docsUrl} title="Open formatting docs">Learn more</a>
					about formatting options
				</span>
			</div>
		</gl-popover>`;
	}

	private renderModifiers(): unknown {
		return html`<div class="mods">
			<button
				type="button"
				class="mods__toggle"
				aria-expanded=${this._showModifiers}
				@click=${() => {
					this._showModifiers = !this._showModifiers;
				}}
			>
				<code-icon
					icon=${this._showModifiers ? 'chevron-down' : 'chevron-right'}
					aria-hidden="true"
				></code-icon>
				Width, alignment &amp; surrounding text
			</button>
			${
				this._showModifiers
					? html`<div class="mods__body">
							<label class="mods__field">
								Prefix text
								<input
									type="text"
									spellcheck="false"
									.value=${this._modPrefix}
									@input=${(e: Event) => {
										this._modPrefix = (e.target as HTMLInputElement).value;
									}}
								/>
							</label>
							<label class="mods__field">
								Suffix text
								<input
									type="text"
									spellcheck="false"
									.value=${this._modSuffix}
									@input=${(e: Event) => {
										this._modSuffix = (e.target as HTMLInputElement).value;
									}}
								/>
							</label>
							<label class="mods__field">
								Width (truncate / pad)
								<input
									type="number"
									min="0"
									.value=${this._modWidth}
									@input=${(e: Event) => {
										this._modWidth = (e.target as HTMLInputElement).value;
									}}
								/>
							</label>
							<fieldset class="mods__align">
								<legend>Width option</legend>
								${this.renderFlagRadio('', 'None')} ${this.renderFlagRadio('?', 'Collapse whitespace')}
								${this.renderFlagRadio('-', 'Right-align')}
							</fieldset>
							<p class="mods__preview">Inserts <code>${this.composeToken('token')}</code></p>
						</div>`
					: nothing
			}
		</div>`;
	}

	private renderFlagRadio(flag: WidthFlag, label: string): unknown {
		return html`<label class="mods__radio">
			<input
				type="radio"
				name="width-flag"
				.checked=${this._modFlag === flag}
				@change=${() => {
					this._modFlag = flag;
				}}
			/>
			${label}
		</label>`;
	}
}
