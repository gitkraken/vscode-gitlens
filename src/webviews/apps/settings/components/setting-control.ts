import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { linkify } from '../../shared/components/linkify.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { CheckDescriptor, SettingDescriptor } from '../model.js';
import { evaluateStateExpression } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import './format-input.js';
import './settings-ai.js';
import './settings-autolinks.js';
import './settings-integrations.js';
import '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/segmented/segmented.js';
import '../../shared/components/select/select.js';
import '../../shared/components/slider/slider.js';

export const tagName = 'gl-setting-control';

/**
 * Renders one setting descriptor — dispatches on `kind`, binds the current
 * config value, evaluates visibility/enablement expressions, and routes
 * changes through `SettingsActions` (apply-on-interaction, text on commit).
 */
@customElement(tagName)
export class GlSettingControl extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: block;
			}

			:host([hidden]) {
				display: none;
			}

			:host([indent]) {
				margin-inline-start: 2.6rem;
			}

			:host([highlighted]) {
				outline: 2px solid transparent;
				background-color: color-mix(
					in srgb,
					var(--vscode-editor-findMatchHighlightBackground, #ea5c0055) 60%,
					transparent
				);
				border-radius: 0.3rem;
			}

			.control {
				display: flex;
				flex-direction: column;
				gap: 0.7rem;
			}

			.control--disabled {
				opacity: 0.5;
			}

			.row {
				display: flex;
				flex-wrap: wrap;
				gap: 1.4rem;
				align-items: center;
			}

			.row__label {
				font-size: 1.25rem;
				color: var(--color-foreground);
			}

			.label {
				font-size: 1.25rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.hint {
				display: flex;
				gap: 0.5rem;
				align-items: flex-start;
				font-size: 1.15rem;
				line-height: 1.4;
				color: var(--color-foreground--65);
			}

			.hint code-icon {
				flex: none;
				margin-block-start: 0.1rem;
			}

			gl-checkbox {
				font-size: 1.3rem;
			}

			input[type='number'] {
				width: 8rem;
				padding: 0.5rem 0.7rem;
				font-family: var(--vscode-font-family);
				font-size: 1.25rem;
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: 1px solid var(--vscode-input-border, transparent);
				border-radius: var(--gl-input-border-radius, 0.4rem);
			}

			input[type='number']:focus {
				${focusOutline}
			}

			.checkgroup {
				display: flex;
				flex-wrap: wrap;
				gap: 0.8rem;
			}

			.checkgroup__option {
				flex: 1 1 0;
				min-width: 13rem;
				padding: 0.9rem 1.1rem;
				border: 1px solid var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: 0.6rem;
			}

			.checkgroup__option--on {
				background-color: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
				border-color: color-mix(in srgb, var(--vscode-button-background) 70%, transparent);
			}

			.checkgroup__option .hint {
				margin-block-start: 0.5rem;
			}

			.info {
				display: flex;
				gap: 0.8rem;
				padding: 1rem 1.2rem;
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--vscode-inputValidation-infoBackground) 60%, transparent);
				border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-infoBorder) 70%, transparent);
				border-radius: 0.6rem;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	descriptor!: SettingDescriptor;

	@property({ attribute: false })
	actions?: SettingsActions;

	@property({ type: Boolean, reflect: true })
	highlighted: boolean = false;

	@property({ type: Boolean, reflect: true })
	indent: boolean = false;

	/** Local draft for the number input while the user is editing; undefined renders the config value. */
	@state()
	private _numberDraft: string | undefined;

	/** Tracks the descriptor key across renders so the draft can be reset when this reused instance switches descriptors. */
	private _lastDescriptorKey: string | undefined;

	private get visible(): boolean {
		// A search/anchor match force-reveals a `visibleWhen`-hidden control so
		// arriving at the category always surfaces the matched setting
		if (this.highlighted) return true;

		const visibleWhen = this.descriptor.visibleWhen;
		return visibleWhen == null || evaluateStateExpression(visibleWhen, path => this._state.getSettingValue(path));
	}

	private get enabled(): boolean {
		const d = this.descriptor;
		if (d.kind === 'info' || !('enabledWhen' in d) || d.enabledWhen == null) return true;

		return evaluateStateExpression(d.enabledWhen, path => this._state.getSettingValue(path));
	}

	override willUpdate(): void {
		const d = this.descriptor;

		// A single instance is reused for different descriptors (position-based reuse when switching
		// categories), so drop the in-progress number draft when the descriptor identity changes
		const descriptorKey = 'key' in d ? d.key : d.kind;
		if (descriptorKey !== this._lastDescriptorKey) {
			this._lastDescriptorKey = descriptorKey;
			this._numberDraft = undefined;
		}

		// Reflect to the native attribute so the host collapses (`[hidden]` display: none)
		this.toggleAttribute('hidden', !this.visible);
		this.indent = d.kind !== 'info' && d.indent === true;
	}

	override render(): unknown {
		if (!this.visible) return nothing;

		const d = this.descriptor;
		const enabled = this.enabled;

		return html`<div class="control ${enabled ? '' : 'control--disabled'}">${this.renderControl(d, enabled)}</div>`;
	}

	private renderControl(d: SettingDescriptor, enabled: boolean) {
		switch (d.kind) {
			case 'check':
				return this.renderCheck(d, enabled);

			case 'select':
				return html`${this.renderRowLabel(
					d.label,
					html`<gl-select
						label=${d.label}
						.options=${d.options}
						.value=${String(this._state.getSettingValue(d.key) ?? '')}
						?disabled=${!enabled}
						@gl-change-value=${(e: Event) =>
							this.actions?.applyOption(d.key, (e.target as HTMLElement & { value: string }).value)}
					></gl-select>`,
				)}${this.renderHint(d.hint)}`;

			case 'segmented':
				return html`${this.renderRowLabel(
					d.label,
					html`<gl-segmented-control
						label=${d.label}
						.options=${d.options}
						.value=${String(this._state.getSettingValue(d.key) ?? '')}
						?disabled=${!enabled}
						@gl-change-value=${(e: Event) =>
							this.actions?.applyOption(
								d.key,
								(e.target as HTMLElement & { value?: string }).value ?? '',
							)}
					></gl-segmented-control>`,
				)}${this.renderHint(d.hint)}`;

			case 'text':
				return html`<gl-format-input
						.descriptor=${d}
						.actions=${this.actions}
						?disabled=${!enabled}
					></gl-format-input>
					${this.renderHint(d.hint)}`;

			case 'number':
				return html`${this.renderRowLabel(
					d.label,
					html`<input
						type="number"
						.value=${this._numberDraft ?? String(this._state.getSettingValue(d.key) ?? '')}
						placeholder=${ifDefined(d.placeholder)}
						?disabled=${!enabled}
						aria-label=${d.label}
						@input=${(e: Event) => {
							// Buffer typing locally so a mid-edit config push doesn't reset `.value`
							this._numberDraft = (e.target as HTMLInputElement).value;
						}}
						@blur=${(e: FocusEvent) => {
							void this.actions?.applyNumber(d.key, (e.target as HTMLInputElement).value, d.defaultValue);
							this._numberDraft = undefined;
						}}
						@keydown=${(e: KeyboardEvent) => {
							// Enter commits in place (focus stays put), matching the format inputs
							if (e.key === 'Enter') {
								void this.actions?.applyNumber(
									d.key,
									(e.target as HTMLInputElement).value,
									d.defaultValue,
								);
							} else if (e.key === 'Escape' && this._numberDraft !== undefined) {
								// Revert to the committed config value
								this._numberDraft = undefined;
							}
						}}
					/>`,
				)}${this.renderHint(d.hint)}`;

			case 'slider':
				return html`${this.renderRowLabel(
					d.label,
					html`<gl-slider
						label=${d.label}
						.value=${Number(this._state.getSettingValue(d.key) ?? d.min)}
						min=${d.min}
						max=${d.max}
						step=${d.step}
						unit=${d.unit ?? ''}
						?disabled=${!enabled}
						@gl-change-value=${(e: Event) =>
							this.actions?.applyValue(d.key, (e.target as HTMLElement & { value: number }).value)}
					></gl-slider>`,
				)}${this.renderHint(d.hint)}`;

			case 'checkgroup': {
				const current = this._state.getSettingValue<string[]>(d.key) ?? [];
				return html`<span class="label" id="checkgroup-label-${d.key}">${d.label}</span>
					<div class="checkgroup" role="group" aria-labelledby="checkgroup-label-${d.key}">
						${d.options.map(o => {
							const on = current.includes(o.value);
							return html`<div class="checkgroup__option ${on ? 'checkgroup__option--on' : ''}">
								<gl-checkbox
									.checked=${on}
									?disabled=${!enabled}
									@gl-change-value=${(e: Event) =>
										this.actions?.applyArrayMember(
											d.key,
											o.value,
											(e.target as HTMLElement & { checked: boolean }).checked,
										)}
									>${o.label}</gl-checkbox
								>
								${o.hint ? html`<p class="hint">${o.hint}</p>` : nothing}
							</div>`;
						})}
					</div>
					${this.renderHint(d.hint)}`;
			}

			case 'autolinks':
				return html`<gl-settings-autolinks .actions=${this.actions}></gl-settings-autolinks>`;

			case 'integrations':
				return html`<gl-settings-integrations .actions=${this.actions}></gl-settings-integrations>`;

			case 'ai':
				return html`<gl-settings-ai .actions=${this.actions}></gl-settings-ai>`;

			case 'info':
				return html`<div class="info" role="note">
					<code-icon icon="info" aria-hidden="true"></code-icon>
					<span>${linkify(d.text)}</span>
				</div>`;
		}
	}

	private renderCheck(d: CheckDescriptor, enabled: boolean) {
		let checked: boolean;
		let indeterminate = false;

		switch (d.type) {
			case 'custom':
				checked = this._state.customSettings.get()[d.key] ?? false;
				break;
			case 'array':
				checked = (this._state.getSettingValue<string[]>(d.key) ?? []).includes(d.value ?? '');
				break;
			case 'object':
				checked = Boolean(this._state.getSettingValue<unknown>(`${d.key}.${d.path ?? ''}`));
				break;
			default: {
				const value = this._state.getSettingValue<unknown>(d.key);
				if (d.valueOff !== undefined) {
					// Tri-state (legacy data-value-off): checked when the value differs from
					// the off value; indeterminate renders a literal null
					checked = String(d.valueOff) !== String(value);
					indeterminate = value === null;
				} else {
					checked = Boolean(value);
				}
				break;
			}
		}

		return html`<gl-checkbox
				.checked=${checked}
				.indeterminate=${indeterminate}
				?disabled=${!enabled}
				@gl-change-value=${(e: Event) => {
					void this.actions?.applyCheck(d, (e.target as HTMLElement & { checked: boolean }).checked);
				}}
				>${d.label}</gl-checkbox
			>${this.renderHint(d.hint)}`;
	}

	private renderRowLabel(label: string, control: unknown) {
		return html`<div class="row"><span class="row__label">${label}</span>${control}</div>`;
	}

	private renderHint(hint: string | undefined) {
		if (!hint) return nothing;
		return html`<p class="hint">
			<code-icon icon="info" aria-hidden="true"></code-icon><span>${linkify(hint)}</span>
		</p>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSettingControl;
	}
}
