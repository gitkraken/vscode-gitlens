import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/tooltip';

@customElement('gl-explaination')
export class GlExplaination extends LitElement {
	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: flex;
				flex-direction: row;
				gap: 0.8rem;
				padding: 0.8rem;
			}

			.label {
				--icon-size: 2.4rem;
			}

			.explaination {
				margin-block: 0;
			}
		`,
	];

	@property()
	desciption = 'AI Explanation';

	override render() {
		return html`
			<div class="label">
				<gl-tooltip .content=${this.desciption}>
					<code-icon icon="sparkle" class="icon"></code-icon>
				</gl-tooltip>
			</div>
			<p class="explaination">
				<slot></slot>
			</p>
		`;
	}
}
