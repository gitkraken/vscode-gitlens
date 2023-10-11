import { Badge, defineGkElement } from '@gitkraken/shared-web-components';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import type { Serialized } from '../../../../system/serialize';
import { pluralize } from '../../../../system/string';
import type { State } from '../../../commitDetails/protocol';
import '../../shared/components/button';
import './gl-commit-details';
import './gl-wip-details';
import { uncommittedSha } from '../commitDetails';

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	summary?: string;
}

@customElement('gl-commit-details-app')
export class GlCommitDetailsApp extends LitElement {
	@property({ type: Object })
	state?: Serialized<State>;

	@property({ type: Object })
	explain?: ExplainState;

	@state()
	get isUncommitted() {
		return this.state?.commit?.sha === uncommittedSha;
	}

	@state()
	get isStash() {
		return this.state?.commit?.stashNumber != null;
	}

	get navigation() {
		if (this.state?.navigationStack == null) {
			return {
				back: false,
				forward: false,
			};
		}

		const actions = {
			back: true,
			forward: true,
		};

		if (this.state.navigationStack.count <= 1) {
			actions.back = false;
			actions.forward = false;
		} else if (this.state.navigationStack.position === 0) {
			actions.back = true;
			actions.forward = false;
		} else if (this.state.navigationStack.position === this.state.navigationStack.count - 1) {
			actions.back = false;
			actions.forward = true;
		}

		return actions;
	}

	constructor() {
		super();

		defineGkElement(Badge);
	}

	override render() {
		const wip = this.state?.wip;

		return html`
			<div class="commit-detail-panel scrollable">
				<main id="main" tabindex="-1">
					<nav class="details-tab">
						<button
							class="details-tab__item ${this.state?.mode === 'commit' ? ' is-active' : ''}"
							data-action="details"
						>
							${this.isStash ? 'Stash' : 'Commit'}
						</button>
						<button
							class="details-tab__item ${this.state?.mode === 'wip' ? ' is-active' : ''}"
							data-action="wip"
							title="${ifDefined(
								this.state?.mode === 'wip' && wip?.changes?.files.length
									? `${pluralize('change', wip.changes.files.length)} on ${
											wip.repositoryCount > 1
												? `${wip.changes.repository.name}:${wip.changes.branchName}`
												: wip.changes.branchName
									  }`
									: undefined,
							)}"
						>
							Working
							Changes${ifDefined(
								this.state?.mode === 'wip' && wip?.changes?.files.length
									? html` &nbsp;<gk-badge variant="filled">${wip.changes.files.length}</gk-badge>`
									: undefined,
							)}
						</button>
					</nav>
					${when(
						this.state?.mode === 'commit',
						() =>
							html`<gl-commit-details
								.state=${this.state}
								.files=${this.state?.commit?.files}
								.explain=${this.explain}
								.preferences=${this.state?.preferences}
								.isUncommitted=${this.isUncommitted}
							></gl-commit-details>`,
						() =>
							html`<gl-wip-details
								.wip=${wip}
								.files=${wip?.changes?.files}
								.preferences=${this.state?.preferences}
								.isUncommitted=${true}
								.emptyText=${'No working changes'}
							></gl-wip-details>`,
					)}
				</main>
			</div>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}
}
