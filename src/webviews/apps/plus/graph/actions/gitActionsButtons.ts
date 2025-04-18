import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fromNow } from '../../../../../system/date';
import { pluralize } from '../../../../../system/string';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type { BranchState, State } from '../../../../plus/graph/protocol';
import { inlineCode } from '../../../shared/components/styles/lit/base.css';
import { actionButton, linkBase, ruleBase } from '../styles/graph.css';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/tooltip';

@customElement('gl-git-actions-buttons')
export class GitActionsButtons extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}
	`;

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: String })
	branchName?: string;

	@property({ type: Object })
	lastFetched?: Date;

	@property({ type: Object })
	state!: State;

	private get fetchedText() {
		if (!this.lastFetched) return undefined;

		let lastFetchedDate: Date;
		if (typeof this.lastFetched === 'string') {
			lastFetchedDate = new Date(this.lastFetched);
		} else {
			lastFetchedDate = this.lastFetched;
		}

		return lastFetchedDate.getTime() !== 0 ? fromNow(lastFetchedDate) : undefined;
	}

	override render() {
		return html`
			<gl-push-pull-button
				.branchState=${this.branchState}
				.state=${this.state}
				.fetchedText=${this.fetchedText}
				.branchName=${this.branchName}
			></gl-push-pull-button>
			<gl-fetch-button
				.branchState=${this.branchState}
				.fetchedText=${this.fetchedText}
				.state=${this.state}
			></gl-fetch-button>
		`;
	}
}

@customElement('gl-fetch-button')
export class GlFetchButton extends LitElement {
	static override styles = [linkBase, inlineCode, actionButton, ruleBase];

	@property({ type: Object })
	state!: State;

	@property({ type: String })
	fetchedText?: string;

	@property({ type: Object })
	branchState?: BranchState;

	private get upstream() {
		return this.branchState?.upstream
			? html`<span class="inline-code">${this.branchState.upstream}</span>`
			: 'remote';
	}

	override render() {
		return html`
			<gl-tooltip placement="bottom">
				<a
					href=${createWebviewCommandLink(
						'gitlens.graph.fetch',
						this.state.webviewId,
						this.state.webviewInstanceId,
					)}
					class="action-button"
				>
					<code-icon class="action-button__icon" icon="repo-fetch"></code-icon>
					Fetch
					${this.fetchedText ? html`<span class="action-button__small">(${this.fetchedText})</span>` : ''}
				</a>
				<span slot="content">
					Fetch from ${this.upstream}
					${this.branchState?.provider?.name ? html` on ${this.branchState.provider.name}` : ''}
					${this.fetchedText
						? html`
								<hr />
								Last fetched ${this.fetchedText}
						  `
						: nothing}
				</span>
			</gl-tooltip>
		`;
	}
}

@customElement('gl-push-pull-button')
export class PushPullButton extends LitElement {
	static override styles = [
		linkBase,
		inlineCode,
		actionButton,
		ruleBase,
		css`
			:host {
				display: contents;
			}

			.pill {
				display: inline-block;
				padding: 0.2rem 0.5rem;
				border-radius: 0.5rem;
				font-size: 1rem;
				font-weight: 500;
				line-height: 1.2;
				text-transform: uppercase;
				color: var(--vscode-foreground);
				background-color: var(--vscode-editorWidget-background);
			}
			.pill code-icon {
				font-size: inherit !important;
				line-height: inherit !important;
			}
		`,
	];

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: Object })
	state!: State;

	@property({ type: String })
	fetchedText?: string;

	@property({ type: String })
	branchName?: string;

	private get isBehind(): boolean {
		return (this.branchState?.behind ?? 0) > 0;
	}

	private get isAhead(): boolean {
		return (this.branchState?.ahead ?? 0) > 0;
	}

	private get upstream() {
		return this.branchState?.upstream
			? html`<span class="inline-code">${this.branchState.upstream}</span>`
			: 'remote';
	}

	private renderBranchPrefix() {
		return html`<span class="inline-code">${this.branchName}</span> is`;
	}

	private renderTooltipContent(action: 'pull' | 'push') {
		if (!this.branchState) return nothing;

		const providerSuffix = this.branchState.provider?.name ? html` on ${this.branchState.provider.name}` : '';

		if (action === 'pull') {
			const mainContent = html`Pull ${pluralize('commit', this.branchState.behind)} from
			${this.upstream}${providerSuffix}`;

			if (this.isAhead) {
				return html`
					${mainContent}
					<hr />
					${this.renderBranchPrefix()} ${pluralize('commit', this.branchState.behind)} behind and
					${pluralize('commit', this.branchState.ahead)} ahead of ${this.upstream}${providerSuffix}
				`;
			}

			return html`
				${mainContent}
				<hr />
				${this.renderBranchPrefix()} ${pluralize('commit', this.branchState.behind)} behind
				${this.upstream}${providerSuffix}
			`;
		}

		return html`
			Push ${pluralize('commit', this.branchState.ahead)} to ${this.upstream}${providerSuffix}
			<hr />
			${this.renderBranchPrefix()} ${pluralize('commit', this.branchState.ahead)} ahead of ${this.upstream}
		`;
	}

	override render() {
		if (!this.branchState || (!this.isAhead && !this.isBehind)) {
			return nothing;
		}

		const action = this.isBehind ? 'pull' : 'push';
		const icon = this.isBehind ? 'repo-pull' : 'repo-push';
		const label = this.isBehind ? 'Pull' : 'Push';

		return html`
			<gl-tooltip placement="bottom">
				<a
					href=${createWebviewCommandLink(
						`gitlens.graph.${action}`,
						this.state.webviewId,
						this.state.webviewInstanceId,
					)}
					class="action-button${this.isBehind ? ' is-behind' : ''}${this.isAhead ? ' is-ahead' : ''}"
				>
					<code-icon class="action-button__icon" icon=${icon}></code-icon>
					${label}
					<span>
						<span class="pill action-button__pill">
							${this.isBehind
								? html`
										<span>
											${this.branchState.behind}
											<code-icon icon="arrow-down"></code-icon>
										</span>
								  `
								: ''}
							${this.isAhead
								? html`
										<span>
											${this.isBehind ? html`&nbsp;&nbsp;` : ''} ${this.branchState.ahead}
											<code-icon icon="arrow-up"></code-icon>
										</span>
								  `
								: ''}
						</span>
					</span>
				</a>
				<div slot="content" style="white-space: break-spaces">
					${this.renderTooltipContent(action)}
					${this.fetchedText
						? html`
								<hr />
								Last fetched ${this.fetchedText}
						  `
						: ''}
				</div>
			</gl-tooltip>
			${this.isAhead && this.isBehind
				? html`
						<gl-tooltip placement="top" slot="anchor">
							<a
								href=${createWebviewCommandLink(
									'gitlens.graph.pushWithForce',
									this.state.webviewId,
									this.state.webviewInstanceId,
								)}
								class="action-button"
								aria-label="Force Push"
							>
								<code-icon icon="repo-force-push" aria-hidden="true"></code-icon>
							</a>
							<span slot="content">
								Force Push ${pluralize('commit', this.branchState?.ahead)} to ${this.upstream}
								${this.branchState?.provider?.name ? html` on ${this.branchState.provider.name}` : ''}
							</span>
						</gl-tooltip>
				  `
				: ''}
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-git-actions-buttons': GitActionsButtons;
		'gl-fetch-button': GlFetchButton;
		'gl-push-pull-button': PushPullButton;
	}
}
