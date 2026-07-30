import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { when } from 'lit/directives/when.js';
import { createCommandLink } from '../../../../system/commands.js';
import { boxSizingBase, scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import { graphStateContext } from './context.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/gitlens-logo-circle.js';

@customElement('gl-graph-empty-state')
export class GlGraphEmptyState extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		scrollableBase,
		css`
			/* Absolute-fill the workspace region (not a flex container) to center the content; no opaque
		   background or stacking needed since the graph subtree isn't rendered behind it (see graph-app render).
		   safe centering keeps the top reachable when the content outgrows a short panel. */
			:host {
				position: absolute;
				inset: 0;
			}

			.scroller {
				display: flex;
				align-items: safe center;
				justify-content: center;
				height: 100%;
				padding: var(--gl-space-24);
				overflow: auto;
			}

			.hero {
				inline-size: 100%;
				max-width: 42ch;
				margin-inline: auto;
				text-align: center;
			}

			.logo {
				margin-block: var(--gl-space-4) var(--gl-space-10);
				transform: scale(1.22);
			}

			.title {
				margin-block: 0;
				font-size: var(--gl-font-lg);
				font-weight: 600;
				color: var(--color-foreground);
			}

			.description {
				margin-block: var(--gl-space-8) 0;
				font-size: var(--gl-font-base);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				text-wrap: pretty;
			}

			.groups {
				margin-block-start: var(--gl-space-12);
			}

			.group {
				display: flex;
				flex-direction: column;
				inline-size: 100%;
				max-width: 42ch;
				margin-block-start: var(--gl-space-8);
			}

			.group__label {
				padding: var(--gl-space-6) var(--gl-space-10);
				margin: 0;
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.08em;
			}

			.action {
				display: flex;
				gap: var(--gl-space-10);
				align-items: center;
				padding: var(--gl-space-6) var(--gl-space-10);
				color: inherit;
				text-decoration: none;
				cursor: pointer;
				border-radius: var(--gl-radius-sm);
			}

			.action:hover {
				text-decoration: none;
				background: var(--vscode-list-hoverBackground);
			}

			.action:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.action__icon {
				flex: none;
				color: var(--color-foreground--85);
			}

			.action__icon.is-issue {
				color: var(--vscode-gitlens-openAutolinkedIssueIconColor);
			}

			.action__icon.is-pr {
				color: var(--vscode-gitlens-mergedPullRequestIconColor);
			}

			.action__body {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
				min-width: 0;
			}

			.action__title {
				font-size: var(--gl-font-base);
				color: var(--color-foreground);
			}

			.action__desc {
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65);
			}

			@media (height <= 360px) {
				.scroller {
					padding-block: var(--gl-space-12);
				}

				.logo {
					margin-block: 0 var(--gl-space-6);
					transform: none;
				}

				.groups {
					margin-block-start: var(--gl-space-6);
				}
			}

			@media (height <= 440px) and (width > 600px) {
				.groups {
					display: flex;
					flex-direction: row;
					gap: var(--gl-space-8);
				}

				.group {
					width: 36ch;
				}
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	override render(): unknown {
		return html`
			<div class="scroller scrollable">
				<div class="container">
					<div class="hero">
						<gitlens-logo-circle class="logo"></gitlens-logo-circle>
						<h1 class="title">No repository open</h1>
						<p class="description">Choose how you want to get started.</p>
					</div>
					<div class="groups">
						<div class="group" role="group" aria-labelledby="label-get-started">
							<h2 class="group__label" id="label-get-started">Get started</h2>
							${when(
								this.graphState.isWeb,
								() =>
									this.renderAction({
										href: 'command:remoteHub.openRepository',
										icon: 'globe',
										title: 'Open a Remote Repository',
										description: 'Work with a repository without cloning it locally',
									}),
								() => html`
									${this.renderAction({
										href: 'command:workbench.action.files.openFolder',
										icon: 'folder-opened',
										title: 'Open a Folder',
										description: 'Browse for a local folder or repository',
									})}
									${this.renderAction({
										href: 'command:git.clone',
										icon: 'repo-clone',
										title: 'Clone a Repository',
										description: 'Get a remote repository onto your machine',
									})}
									${this.renderAction({
										href: 'command:git.init',
										icon: 'new-folder',
										title: 'Start a New Project',
										description: 'Create a folder and initialize a repository',
									})}
								`,
							)}
						</div>

						<div class="group" role="group" aria-labelledby="label-your-work">
							<h2 class="group__label" id="label-your-work">Start from your work</h2>
							${this.renderAction({
								href: createCommandLink('gitlens.startWork', { source: 'graph' }),
								icon: 'issues',
								title: 'Start Work on an Issue',
								description: 'Pick an issue to start a branch from',
								accent: 'issue',
							})}
							${when(!this.graphState.isWeb, () =>
								this.renderAction({
									href: createCommandLink('gitlens.startReview', { source: { source: 'graph' } }),
									icon: 'git-pull-request',
									title: 'Start Review on a PR',
									description: 'Check out a pull request to review it',
									accent: 'pr',
								}),
							)}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	private renderAction(action: {
		href: string;
		icon: string;
		title: string;
		description: string;
		accent?: 'issue' | 'pr';
	}): TemplateResult {
		return html`
			<a class="action" href=${action.href}>
				<code-icon
					class=${classMap({
						action__icon: true,
						'is-issue': action.accent === 'issue',
						'is-pr': action.accent === 'pr',
					})}
					icon=${action.icon}
				></code-icon>
				<span class="action__body">
					<span class="action__title">${action.title}</span>
					<span class="action__desc">${action.description}</span>
				</span>
			</a>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-empty-state': GlGraphEmptyState;
	}
}
