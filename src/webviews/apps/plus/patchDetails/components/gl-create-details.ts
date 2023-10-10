import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlDetailsBase } from '../../../commitDetails/components/gl-details-base';

@customElement('gl-create-details')
export class GlCreateDetails extends GlDetailsBase {
	@property({ type: Boolean, reflect: true })
	noheader = false;

	override render() {
		return html`
			${when(
				this.noheader !== true,
				() =>
					html`<div class="top-details">
						<div class="top-details__top-menu">
							<div class="top-details__actionbar">
								<div class="top-details__actionbar-group"></div>
								<div class="top-details__actionbar-group">
									<a
										class="commit-action"
										href="#"
										data-action="commit-actions"
										data-action-type="scm"
										aria-label="Open SCM view"
										title="Open SCM view"
										><code-icon icon="source-control"></code-icon
									></a>
									<a
										class="commit-action"
										href="#"
										data-action="commit-actions"
										data-action-type="graph"
										aria-label="Open in Commit Graph"
										title="Open in Commit Graph"
										><code-icon icon="gl-graph"></code-icon
									></a>
								</div>
							</div>
						</div>
					</div> `,
			)}
			${when(
				this.files != null,
				() => this.renderChangedFiles('wip'),
				() => html`<div class="section"><p>No Changes</p></div>`,
			)}
		`;
	}
}
