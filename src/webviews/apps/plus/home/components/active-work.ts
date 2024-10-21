import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { Overview, OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import './branch-section';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends SignalWatcher(LitElement) {
	static override styles = [
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}
		`,
	];

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		if (this._overviewState.state.value == null) {
			this._overviewState.run();
		}
	}

	override render() {
		return this._overviewState.render({
			pending: () => html`<span>Loading...</span>`,
			complete: overview => this.renderComplete(overview),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderComplete(overview: Overview) {
		const activeBranches = overview?.repository?.branches?.active;
		if (activeBranches == null) return html`<span>None</span>`;

		return html`
			<h2>${overview!.repository.name}</h2>
			<gl-branch-section
				label="ACTIVE (${activeBranches.length})"
				.branches=${activeBranches}
			></gl-branch-section>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
	}
}
