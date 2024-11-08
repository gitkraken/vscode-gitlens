import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { OverviewRecentThreshold, OverviewStaleThreshold } from '../../../../home/protocol';
import '../../../shared/components/checkbox/checkbox';
import '../../../shared/components/code-icon';
import { GlElement } from '../../../shared/components/element';
import '../../../shared/components/menu/index';
import '../../../shared/components/menu/menu-item';
import '../../../shared/components/menu/menu-list';
import '../../../shared/components/overlays/popover';

@customElement('gl-branch-threshold-filter')
export class GlBranchThresholdFilter extends GlElement {
	static override readonly styles = [
		css`
			.date-select {
				background: none;
				outline: none;
				border: none;
				cursor: pointer;
				color: var(--vscode-disabledForeground);
				text-decoration: none !important;
				font-weight: 500;
			}
			.date-select option {
				color: var(--vscode-foreground);
				background-color: var(--vscode-dropdown-background);
			}
			.date-select:focus {
				outline: 1px solid var(--vscode-disabledForeground);
			}
			.date-select:hover {
				color: var(--vscode-foreground);
				text-decoration: underline !important;
			}
		`,
	];

	@property({ type: String }) value: OverviewRecentThreshold | OverviewStaleThreshold | undefined;
	@property({ type: Array }) options!: { value: OverviewRecentThreshold | OverviewStaleThreshold; label: string }[];
	private selectDateFilter(threshold: OverviewRecentThreshold | OverviewStaleThreshold) {
		const event = new CustomEvent('gl-change', {
			detail: { threshold: threshold },
		});
		this.dispatchEvent(event);
	}

	override render() {
		if (!this.options) {
			return;
		}
		return html`
			<select
				class="date-select"
				@change=${(e: Event) =>
					this.selectDateFilter(
						(e.target as HTMLSelectElement).value as OverviewRecentThreshold | OverviewStaleThreshold,
					)}
			>
				${repeat(
					this.options,
					item =>
						html`<option value="${item.value}" ?selected=${this.value === item.value}>
							${item.label}
						</option>`,
				)}
			</select>
		`;
	}
}
