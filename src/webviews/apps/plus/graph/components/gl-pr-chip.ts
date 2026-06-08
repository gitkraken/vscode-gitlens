import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { OverviewBranchPullRequest } from '../../../../shared/overviewBranches.js';
import { getAutolinkIcon } from '../../../shared/components/rich/utils.js';
import { focusOutline } from '../../../shared/components/styles/lit/a11y.css.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';

@customElement('gl-pr-chip')
export class GlPrChip extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			min-width: 0;
			max-width: 100%;
		}

		.chip {
			display: inline-flex;
			gap: 0.4rem;
			align-items: center;
			min-width: 0;
			max-width: 100%;
			height: 2rem;
			padding: 0 0.4rem;
			overflow: hidden;
			color: inherit;
			text-decoration: none;
			cursor: pointer;
			border-radius: 0.5rem;
		}

		.chip:hover {
			text-decoration: none;
			background-color: var(--vscode-toolbar-hoverBackground);
		}

		.chip:active {
			background-color: var(--vscode-toolbar-activeBackground);
		}

		.chip:focus-visible {
			${focusOutline}
		}

		.chip.loading {
			pointer-events: none;
			opacity: 0.6;
		}

		.icon {
			flex: 0 0 auto;
		}

		.chip--pr-opened .icon {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.chip--pr-closed .icon {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}

		.chip--pr-merged .icon {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.chip--pr-draft .icon {
			color: var(--vscode-descriptionForeground);
		}

		.identifier {
			flex: 0 0 auto;
			font-size: var(--gl-font-sm);
			color: var(--color-foreground--65);
		}

		.title {
			flex: 0 1 auto;
			min-width: 0;
			max-width: 24rem;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: var(--gl-font-sm);
			white-space: nowrap;
		}
	`;

	@property({ type: Object }) pullRequest?: OverviewBranchPullRequest;
	@property({ type: Boolean }) loading = false;

	override render(): unknown {
		const pr = this.pullRequest;
		if (pr == null) {
			if (!this.loading) return nothing;
			return html`<span class="chip loading" aria-busy="true">
				<code-icon class="icon" icon="loading" modifier="spin"></code-icon>
			</span>`;
		}

		const status = pr.state === 'merged' || pr.state === 'closed' ? pr.state : 'opened';
		const { icon, modifier } = getAutolinkIcon('pr', status, pr.draft);
		const label = `Pull request #${pr.id}${pr.title ? ` - ${pr.title}` : ''}`;

		return html`<gl-tooltip content=${label} placement="bottom">
			<a class="chip chip--${modifier}" href=${pr.url} aria-label=${label}>
				<code-icon class="icon" icon=${icon}></code-icon>
				<span class="identifier">#${pr.id}</span>
				<span class="title">${pr.title}</span>
			</a>
		</gl-tooltip>`;
	}
}
