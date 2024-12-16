import { css, html, LitElement } from 'lit';
import { customElement, property, queryAll } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import { debounce } from '../../../../../system/function';
import type { GetOverviewBranch } from '../../../../home/protocol';
import type { GlBranchCardBase } from './branch-card';
import '../../../shared/components/progress';

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

	override render() {
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
	@property({ type: String }) label!: string;
	@property() repo!: string;
	@property({ type: Array }) branches!: GetOverviewBranch[];
	@property({ type: Boolean }) isFetching = false;

	@queryAll('gl-branch-card')
	private branchCards!: GlBranchCardBase[];

	override connectedCallback() {
		super.connectedCallback();
		this.addEventListener('gl-branch-card-expand-toggled', this.onCardExpanded.bind(this));
	}

	override disconnectedCallback() {
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

	override render() {
		return html`
			<gl-section ?loading=${this.isFetching}>
				<span slot="heading">${this.renderSectionLabel()}</span>
				<span slot="heading-actions"><slot name="heading-actions"></slot></span>
				${when(
					this.branches.length > 0,
					() =>
						this.branches.map(
							branch =>
								html`<gl-branch-card expandable .repo=${this.repo} .branch=${branch}></gl-branch-card>`,
						),
					() => html`<p>No ${this.label} branches</p>`,
				)}
			</gl-section>
		`;
	}
}
