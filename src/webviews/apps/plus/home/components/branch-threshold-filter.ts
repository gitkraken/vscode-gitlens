import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { OverviewRecentThreshold, OverviewStaleThreshold } from '../../../../home/protocol';
import { GlElement } from '../../../shared/components/element';
import '../../../shared/components/checkbox/checkbox';
import '../../../shared/components/code-icon';

export const selectStyles = css`
	.select {
		background: none;
		outline: none;
		border: none;
		text-decoration: none !important;
		font-weight: 500;
		color: var(--color-foreground--25);
	}
	.select option {
		color: var(--vscode-foreground);
		background-color: var(--vscode-dropdown-background);
	}
	.select:not(:disabled) {
		cursor: pointer;
		color: var(--color-foreground--50);
	}
	.select:not(:disabled):focus {
		outline: 1px solid var(--color-focus-border);
	}
	.select:not(:disabled):hover {
		color: var(--vscode-foreground);
		text-decoration: underline !important;
	}
`;

export abstract class GlObjectSelect<T, L = T[keyof T], V = T[keyof T]> extends GlElement {
	static override readonly styles = [selectStyles];

	@property({ type: Boolean }) disabled: boolean = false;
	@property({ type: String }) value?: V;
	@property({ type: Array }) options?: T[];

	protected abstract getValue(option: T): V;
	protected abstract getLabel(option: T): L;
	protected abstract onChange?(e: InputEvent): unknown;

	override render() {
		if (!this.options) {
			return;
		}
		return html`
			<select .disabled=${this.disabled} class="select" @change=${(e: InputEvent) => this.onChange?.(e)}>
				${repeat(this.options, item => {
					const value = this.getValue(item);
					const label = this.getLabel(item);
					return html`<option .value="${value}" ?selected=${this.value === value}>${label}</option>`;
				})}
			</select>
		`;
	}
}

@customElement('gl-branch-threshold-filter')
export class GlBranchThresholdFilter extends GlObjectSelect<{
	value: OverviewRecentThreshold | OverviewStaleThreshold;
	label: string;
}> {
	protected getValue(option: { value: OverviewRecentThreshold | OverviewStaleThreshold }) {
		return option.value;
	}
	protected getLabel(option: { label: string }) {
		return option.label;
	}
	protected onChange(e: InputEvent) {
		const event = new CustomEvent('gl-change', {
			detail: {
				threshold: (e.target as HTMLSelectElement).value as OverviewRecentThreshold | OverviewStaleThreshold,
			},
		});
		this.dispatchEvent(event);
	}
}
