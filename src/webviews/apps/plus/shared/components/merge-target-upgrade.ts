import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SubscriptionState } from '../../../../../constants.subscription.js';
import { elementBase, linkBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { chipStyles } from './chipStyles.js';
import { mergeTargetStyles } from './merge-target-status.js';
import './feature-gate-plus-state.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';

/** Home-only upsell chip. Kept out of `merge-target-status.ts` so the Graph, which renders only the
 *  status element, doesn't bundle this one. */
@customElement('gl-merge-target-upgrade')
export class GlMergeTargetUpgrade extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		chipStyles,
		scrollableBase,
		mergeTargetStyles,
		css`
			gl-feature-gate-plus-state {
				display: block;
				margin-inline: 0.5rem;

				p {
					margin-block: var(--gl-space-10);
					margin-inline: 0;
				}
			}
		`,
	];

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	override render(): unknown {
		const icon = 'warning';
		const status = 'upgrade';

		return html`<gl-popover placement="bottom" trigger="hover click focus">
			<span slot="anchor" class="chip status--${status}" tabindex="0"
				><code-icon class="icon" icon="gl-merge-target" size="18"></code-icon
				><code-icon class="status-indicator icon--${status}" icon="${icon}" size="12"></code-icon>
			</span>
			<gl-feature-gate-plus-state
				slot="content"
				appearance="default"
				featureRestriction="all"
				.source=${{ source: 'home', detail: 'marge-target' } as const}
				.state=${this.state}
			>
				<div slot="feature">
					<span class="header__title">Detect potential merge conflicts</span>

					<p>
						See when your current branch has potential conflicts with its merge target branch and take
						action to resolve them.
					</p>
				</div>
			</gl-feature-gate-plus-state>
		</gl-popover>`;
	}
}
