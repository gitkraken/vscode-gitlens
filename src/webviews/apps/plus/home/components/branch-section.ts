import { css, html, LitElement } from 'lit';
import { customElement, property, queryAll } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import { debounce } from '../../../../../system/function';
import type { BranchRef, GetOverviewBranch } from '../../../../home/protocol';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-list';
import type { ActionList } from '../../../shared/components/actions/action-list';
import '../../../shared/components/actions/action-nav';
import '../../../shared/components/avatar/avatar';
import '../../../shared/components/avatar/avatar-list';
import '../../../shared/components/card/card';
import '../../../shared/components/code-icon';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/formatted-date';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/progress';
import '../../../shared/components/rich/issue-icon';
import '../../../shared/components/rich/pr-icon';
import type { GlBranchCard, GlBranchCardBase } from './branch-card';

@customElement('gl-section')
export class GlSection extends LitElement {
	static override styles = [
		css`
			.section {
				margin-bottom: 1.2rem;
			}
			.section__header {
				position: relative;
				display: flex;
				justify-content: space-between;
				gap: 8px;
				margin-block: 0 0.8rem;
			}
			.section__heading {
				flex: 1;
				font-size: 1.3rem;
			}
			.section__headline {
				font-weight: normal;
				text-transform: uppercase;
			}

			.section__actions {
				margin-inline-start: auto;
			}

			.section__loader {
				position: absolute;
				left: 0;
				bottom: 0;
			}
		`,
	];

	@property({ type: Boolean })
	loading = false;

	@property({ attribute: 'heading-level' })
	headingLevel: ARIAMixin['ariaLevel'] = '3';

	override render(): unknown {
		return html`
			<div class="section">
				<header class="section__header">
					<div
						class="section__heading"
						role="heading"
						aria-level=${ifDefined(this.headingLevel ? this.headingLevel : undefined)}
					>
						<slot name="heading" class="section__headline"></slot>
					</div>
					<slot name="heading-actions" class="section__actions"></slot>
					<progress-indicator class="section__loader" ?active="${this.loading}"></progress-indicator>
				</header>
				<slot></slot>
			</div>
		`;
	}
}

@customElement('gl-branch-section')
export class GlBranchSection extends LitElement {
	static get OpenContextMenuEvent(): CustomEvent<{ items: (typeof ActionList.ItemProps)[]; branchRefs: BranchRef }> {
		throw new Error('type field OpenContextMenuEvent cannot be used as a value');
	}

	@property({ type: String }) label!: string;
	@property() repo!: string;
	@property({ type: Array }) branches!: GetOverviewBranch[];
	@property({ type: Boolean }) isFetching = false;

	@queryAll('gl-branch-card')
	private branchCards!: GlBranchCardBase[];

	override connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener('gl-branch-card-expand-toggled', this.onCardExpanded.bind(this));
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.removeEventListener('gl-branch-card-expand-toggled', this.onCardExpanded.bind(this));
	}

	private onCardExpanded(e: GlobalEventHandlersEventMap['gl-branch-card-expand-toggled']) {
		const path = e.composedPath();
		const card = path.find(p => (p as HTMLElement).matches('gl-branch-card')) as GlBranchCardBase | undefined;

		this.toggleSiblingCardsDebounced(card);
	}

	private toggleSiblingCards(card?: GlBranchCardBase) {
		if (card?.expanded !== true) return;

		this.branchCards.forEach(c => {
			if (c !== card) {
				c.expanded = false;
			}
		});
	}
	private toggleSiblingCardsDebounced = debounce(this.toggleSiblingCards.bind(this), 100);

	private renderSectionLabel() {
		if (this.isFetching || this.branches.length === 0) {
			return this.label;
		}

		return `${this.label} (${this.branches.length})`;
	}

	override render(): unknown {
		return html`
			<gl-section ?loading=${this.isFetching}>
				<span slot="heading">${this.renderSectionLabel()}</span>
				<span slot="heading-actions"><slot name="heading-actions"></slot></span>
				${when(
					this.branches.length > 0,
					() =>
						this.branches.map(
							branch =>
								html`<gl-branch-card
									expandable
									@open-actions-menu=${(e: typeof GlBranchCard.OpenContextMenuEvent) => {
										const evt = new CustomEvent('branch-context-opened', {
											detail: {
												branchRefs: e.detail.branchRefs,
												items: e.detail.items,
											},
										}) satisfies typeof GlBranchSection.OpenContextMenuEvent;
										this.dispatchEvent(evt);
									}}
									@close-actions-menu=${(e: CustomEvent) => {
										const evt = new CustomEvent<{
											branch: GetOverviewBranch;
										}>('branch-context-closed', {
											detail: {
												branch: branch,
											},
										});
										this.dispatchEvent(evt);
										console.log('closeVContext', { e: e }, branch);
									}}
									.repo=${this.repo}
									.branch=${branch}
								></gl-branch-card>`,
						),
					() => html`<p>No ${this.label} branches</p>`,
				)}
			</gl-section>
		`;
	}
}
