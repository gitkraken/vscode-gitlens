import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { pluralize } from '../../../../system/string';
import type { Wip } from '../../../commitDetails/protocol';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base';
import type { File } from './gl-details-base';
import { GlDetailsBase } from './gl-details-base';

@customElement('gl-wip-details')
export class GlWipDetails extends GlDetailsBase {
	override readonly tab = 'wip';

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
								data-action="create-patch"
								aria-label="Share as Cloud Patch"
								title="Share as Cloud Patch"
							>
								<code-icon icon="gl-cloud-patch-share"></code-icon>
								<span class="top-details__sha">Share</span>
							</a>
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

	override getFileActions(file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		const openFile = {
			icon: 'go-to-file',
			label: 'Open file',
			action: 'file-open',
		};
		if (file.staged === true) {
			return [openFile, { icon: 'remove', label: 'Unstage changes', action: 'file-unstage' }];
		}
		return [openFile, { icon: 'plus', label: 'Stage changes', action: 'file-stage' }];
	}
}
