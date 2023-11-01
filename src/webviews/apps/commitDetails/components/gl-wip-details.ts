import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { pluralize } from '../../../../system/string';
import type { Wip } from '../../../commitDetails/protocol';
import { GlDetailsBase } from './gl-details-base';

@customElement('gl-wip-details')
export class GlWipDetails extends GlDetailsBase {
	@property({ type: Object })
	wip?: Wip;

	override render() {
		return html`
			<div class="top-details">
				<div class="top-details__top-menu">
					<div class="top-details__actionbar">
						<div class="top-details__actionbar-group">
							${when(
								this.wip?.changes == null || this.files == null,
								() => 'Loading...',
								() =>
									html`<span
										>${pluralize('change', this.files!.length)} on
										<span
											class="top-details__actionbar--highlight"
											title="${this.wip!.repositoryCount > 1
												? `${this.wip!.changes!.repository.name}:${
														this.wip!.changes!.branchName
												  }`
												: this.wip!.changes!.branchName}"
											>${this.wip!.repositoryCount > 1
												? `${this.wip!.changes!.repository.name}:${
														this.wip!.changes!.branchName
												  }`
												: this.wip!.changes!.branchName}</span
										></span
									>`,
							)}
						</div>
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
			</div>
			${this.renderChangedFiles('wip')}
		`;
	}
}
