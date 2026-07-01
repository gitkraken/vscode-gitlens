import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '../../shared/components/styles/lit/base.css.js';
import { formatDate } from '../../shared/date.js';
import type { SettingsActions } from '../actions.js';
import type { TextDescriptor } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/popover.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-format-input']: GlFormatInput;
	}
}

/** The fixed sample date used by date-format previews (parity with the legacy app). */
const offset = (new Date().getTimezoneOffset() / 60) * 100;
const sampleDate = new Date(
	`Wed Jul 25 2018 19:18:00 GMT${offset >= 0 ? '-' : '+'}${String(Math.abs(offset)).padStart(4, '0')}`,
);

interface TokenInfo {
	token: string;
	label: string;
}

/** Tokens for commit format strings (ported from the legacy token-popup template). */
const commitTokens: TokenInfo[] = [
	{ token: 'id', label: 'Commit SHA' },
	{ token: 'author', label: 'Commit Author' },
	{ token: 'authorFirst', label: 'Commit Author First Name' },
	{ token: 'authorLast', label: 'Commit Author Last Name' },
	{ token: 'authorNotYou', label: 'Commit Author (except you)' },
	{ token: 'email', label: 'Commit Author E-mail' },
	{ token: 'message', label: 'Commit Message' },
	{ token: 'ago', label: 'Commit or Authored Date — relative' },
	{ token: 'date', label: 'Commit or Authored Date — absolute' },
	{ token: 'agoOrDate', label: 'Commit or Authored Date — based on date setting' },
	{ token: 'agoOrDateShort', label: 'Commit or Authored Date (short)' },
	{ token: 'authorAgo', label: 'Authored Date — relative' },
	{ token: 'authorDate', label: 'Authored Date — absolute' },
	{ token: 'authorAgoOrDate', label: 'Authored Date — based on date setting' },
	{ token: 'authorAgoOrDateShort', label: 'Authored Date (short)' },
	{ token: 'committerAgo', label: 'Commit Date — relative' },
	{ token: 'committerDate', label: 'Commit Date — absolute' },
	{ token: 'committerAgoOrDate', label: 'Commit Date — based on date setting' },
	{ token: 'committerAgoOrDateShort', label: 'Commit Date (short)' },
	{ token: 'tips', label: 'Branch & Tag Tips' },
	{ token: 'changes', label: 'Changes Indicator, e.g. +1 ~3 -0' },
	{ token: 'changesShort', label: 'Changes Indicator (short), e.g. +1~3' },
	{ token: 'pullRequest', label: 'Pull Request that introduced the commit' },
	{ token: 'pullRequestState', label: 'Pull Request State (open, merged, closed)' },
];

/** Moment.js display tokens for date-format strings (these insert bare, not wrapped in `${}`). */
const dateTokens: TokenInfo[] = [
	{ token: 'YYYY', label: 'Year, 4-digit (2018)' },
	{ token: 'YY', label: 'Year, 2-digit (18)' },
	{ token: 'MMMM', label: 'Month, full (July)' },
	{ token: 'MMM', label: 'Month, short (Jul)' },
	{ token: 'MM', label: 'Month, 2-digit (07)' },
	{ token: 'Do', label: 'Day of month, ordinal (25th)' },
	{ token: 'DD', label: 'Day of month, 2-digit (25)' },
	{ token: 'D', label: 'Day of month (25)' },
	{ token: 'dddd', label: 'Day of week, full (Wednesday)' },
	{ token: 'ddd', label: 'Day of week, short (Wed)' },
	{ token: 'HH', label: 'Hour, 24-hour 2-digit (19)' },
	{ token: 'hh', label: 'Hour, 12-hour 2-digit (07)' },
	{ token: 'h', label: 'Hour, 12-hour (7)' },
	{ token: 'mm', label: 'Minute, 2-digit (18)' },
	{ token: 'ss', label: 'Second, 2-digit (00)' },
	{ token: 'a', label: 'am / pm' },
	{ token: 'A', label: 'AM / PM' },
	{ token: 'Z', label: 'UTC offset (+01:00)' },
];

/**
 * A text input for format strings with a live example line and a `${token}`
 * insert menu.
 *
 * Editing is drafted locally and committed when focus leaves the component or
 * on Enter — moving focus to the token menu does NOT commit (parity with the
 * legacy popup, which suppressed blur). The example reacts to the draft.
 */
@customElement('gl-format-input')
export class GlFormatInput extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
			}

			.label {
				display: block;
				margin-block-end: 0.7rem;
				font-size: 1.25rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.field {
				display: flex;
				max-width: var(--gl-max-input);
				overflow: hidden;
				background-color: var(--vscode-input-background);
				border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius, 0.4rem);
			}

			.field:focus-within {
				${focusOutline}
			}

			input {
				flex: 1;
				min-width: 0;
				padding: 0.7rem 0.9rem;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.25rem;
				color: var(--vscode-input-foreground);
				outline: none;
				background: transparent;
				border: none;
			}

			input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.tokens-trigger {
				flex: none;
				padding: 0 var(--gl-space-8);
				color: var(--color-foreground--75);
				cursor: pointer;
				background: transparent;
				border: none;
				border-left: var(--gl-border-width) solid var(--vscode-input-border, transparent);
			}

			.tokens-trigger:hover {
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.tokens-trigger:focus-visible {
				${focusOutline}
			}

			.tokens {
				display: flex;
				flex-direction: column;
				min-width: 32rem;
				max-height: 30rem;
				overflow-y: auto;
			}

			.tokens__title {
				padding: 0.5rem 0.9rem;
				margin: 0;
				font-size: 1.05rem;
				font-weight: 400;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.05em;
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
			.token:focus-visible {
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

			.tokens__hint {
				padding: 0.6rem 0.9rem;
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

	@query('input')
	private _input!: HTMLInputElement;

	/** Local draft while the user is editing; undefined renders the config value. */
	@state()
	private _draft: string | undefined;

	@state()
	private _example: string = '';

	/** Tracks descriptor identity so a reused instance drops a stale draft/example on switch. */
	private _lastDescriptorKey: string | undefined;

	private get value(): string {
		return this._draft ?? String(this._state.getSettingValue(this.descriptor.key) ?? '');
	}

	override willUpdate(): void {
		// A single instance is reused for different descriptors (position-based reuse when switching
		// categories), so drop the in-progress draft/example when the descriptor identity changes
		// (parity with gl-setting-control's number-draft reset)
		if (this.descriptor.key !== this._lastDescriptorKey) {
			this._lastDescriptorKey = this.descriptor.key;
			this._draft = undefined;
			this._example = '';
		}
	}

	override updated(): void {
		this.updateExample();
	}

	private readonly requestCommitPreview = debounce((format: string) => {
		const d = this.descriptor;
		if (d.preview?.type !== 'commit' && d.preview?.type !== 'commit-uncommitted') return;

		const key = d.key;
		void this.actions
			?.generateFormatPreview(key, d.preview.type, format)
			.then(preview => {
				// The instance is reused across descriptors; ignore a late preview for a previous one
				if (this.descriptor.key !== key) return;

				this._example = preview;
			})
			.catch(() => {});
	}, 200);

	private updateExample(): void {
		const d = this.descriptor;
		const preview = d.preview;
		if (preview == null) return;

		let value = this.value;

		switch (preview.type) {
			case 'commit':
			case 'commit-uncommitted': {
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
					return;
				}

				this.requestCommitPreview(value);
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
				} catch (ex) {
					this._example = ex instanceof Error ? ex.message : String(ex);
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
				} catch (ex) {
					this._example = ex instanceof Error ? ex.message : String(ex);
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
	}

	private handleKeyDown(e: KeyboardEvent): void {
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

		this.commit();
	}

	/**
	 * Which token set (if any) this input offers. Date-format strings get
	 * Moment.js tokens; commit-format strings get the `${...}` token set.
	 */
	private get tokenMode(): 'commit' | 'date' | undefined {
		if (this.descriptor.preview?.type === 'date') return 'date';
		if (this.descriptor.tokens === true) return 'commit';
		return undefined;
	}

	private insertToken(text: string): void {
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

	override render(): unknown {
		const d = this.descriptor;
		const tokenMode = this.tokenMode;
		const tokens = tokenMode === 'date' ? dateTokens : tokenMode === 'commit' ? commitTokens : undefined;
		const tokensDocsUrl =
			tokenMode === 'date'
				? 'https://momentjs.com/docs/#/displaying/format/'
				: 'https://github.com/gitkraken/vscode-gitlens/wiki/Custom-Formatting';

		return html`<label class="label" for="input">${d.label}</label>
			<div class="field" @focusout=${this.handleFocusOut}>
				<input
					id="input"
					type="text"
					spellcheck="false"
					.value=${this.value}
					placeholder=${ifDefined(d.placeholder)}
					?disabled=${this.disabled}
					@input=${this.handleInput}
					@keydown=${this.handleKeyDown}
				/>
				${tokens != null
					? html`<gl-popover trigger="click" placement="bottom-end">
							<button
								slot="anchor"
								type="button"
								class="tokens-trigger"
								aria-label="Insert a token"
								?disabled=${this.disabled}
							>
								<code-icon icon="chevron-down" aria-hidden="true"></code-icon>
							</button>
							<div slot="content" class="tokens" role="group" aria-label="Available tokens">
								<h3 class="tokens__title">Insert token</h3>
								${tokens.map(t => {
									// Commit tokens insert wrapped in `${…}`; date tokens insert bare
									// oxlint-disable-next-line prefer-template -- a template literal would need `\${` escaping, which is harder to read
									const text = tokenMode === 'date' ? t.token : '${' + t.token + '}';
									// Plain action buttons (insert on click) — not listbox options,
									// which would imply arrow-key selection semantics
									return html`<button
										type="button"
										class="token"
										@click=${() => this.insertToken(text)}
									>
										<code>${text}</code><span>${t.label}</span>
									</button>`;
								})}
								<span class="tokens__hint">
									<a href=${tokensDocsUrl} title="Open formatting docs">Learn more</a>
									about formatting options
								</span>
							</div>
						</gl-popover>`
					: nothing}
			</div>
			${d.preview != null
				? html`<p class="example" aria-live="polite" aria-atomic="true">
						<span>Example:</span>
						<span class="example__text">${this._example || '—'}</span>
					</p>`
				: nothing}`;
	}
}
