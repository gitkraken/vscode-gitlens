import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { graphStateContext } from './context.js';
import '../../shared/components/button.js';
import '@gitlens/components/components/codeIcon.js';

@customElement('gl-graph-empty-state')
export class GlGraphEmptyState extends SignalWatcher(LitElement) {
	static override styles = css`
		/* Absolute-fill the workspace region (not a flex container) to center the content; no opaque
   background or stacking needed since the graph subtree isn't rendered behind it (see graph-app render). */
		:host {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: var(--gl-space-24);
			overflow: auto;
		}

		.container {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-16);
			align-items: center;
			width: 100%;
			max-width: 36rem;
			text-align: center;
		}

		.icon {
			color: var(--vscode-descriptionForeground);
		}

		.icon code-icon {
			font-size: 4rem;
		}

		.title {
			margin: 0;
			font-size: var(--gl-font-lg);
			font-weight: 600;
		}

		.description {
			margin: 0;
			font-size: var(--gl-font-base);
			color: var(--vscode-descriptionForeground);
		}

		.actions {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-8);
			width: 100%;
			margin-top: var(--gl-space-8);
		}
	`;

	@consume({ context: graphStateContext, subscribe: false })
	graphState!: typeof graphStateContext.__context__;

	override render(): unknown {
		if (this.graphState.trusted === false) {
			return html`
				<div class="container" role="group" aria-label=${l10n.t('Untrusted workspace')}>
					<div class="icon"><code-icon icon="workspace-untrusted"></code-icon></div>
					<h2 class="title">${l10n.t('Untrusted workspace')}</h2>
					<p class="description">
						${l10n.t(
							"GitLens can't open repositories while this workspace is in Restricted Mode. Trust this workspace to visualize its history, branches, and commits in the Commit Graph.",
						)}
					</p>
					<div class="actions">
						<gl-button full href="command:workbench.trust.manage">
							<code-icon slot="prefix" icon="shield"></code-icon>
							${l10n.t('Manage Workspace Trust')}
						</gl-button>
					</div>
				</div>
			`;
		}

		if (this.graphState.hasUnsafeRepositories) {
			return html`
				<div class="container" role="group" aria-label=${l10n.t('Unsafe repository')}>
					<div class="icon"><code-icon icon="warning"></code-icon></div>
					<h2 class="title">${l10n.t('Unsafe repository')}</h2>
					<p class="description">
						${l10n.t(
							'Unable to open any repositories — Git blocked them as potentially unsafe, because their folders are not owned by the current user. Mark them as safe in Source Control to visualize their history, branches, and commits in the Commit Graph.',
						)}
					</p>
					<div class="actions">
						<gl-button full href="command:workbench.view.scm">
							<code-icon slot="prefix" icon="source-control"></code-icon>
							${l10n.t('Manage in Source Control')}
						</gl-button>
					</div>
				</div>
			`;
		}

		return html`
			<div class="container" role="group" aria-label=${l10n.t('No repository open')}>
				<div class="icon"><code-icon icon="source-control"></code-icon></div>
				<h2 class="title">${l10n.t('No repository open')}</h2>
				<p class="description">
					${l10n.t('Open a folder or repository to visualize its history, branches, and commits in the Commit Graph.')}
				</p>
				<div class="actions">
					${when(
						this.graphState.isWeb,
						() => html`
							<gl-button appearance="secondary" full href="command:remoteHub.openRepository">
								<code-icon slot="prefix" icon="globe"></code-icon>
								${l10n.t('Open Remote Repository')}
							</gl-button>
						`,
						() => html`
							<gl-button full href="command:workbench.action.files.openFolder">
								<code-icon slot="prefix" icon="folder-opened"></code-icon>
								Open a Folder
							</gl-button>
							<gl-button appearance="secondary" full href="command:git.clone">
								<code-icon slot="prefix" icon="repo-clone"></code-icon>
								${l10n.t('Clone a Repository')}
							</gl-button>
							<gl-button appearance="secondary" full href="command:git.init">
								<code-icon slot="prefix" icon="new-folder"></code-icon>
								${l10n.t('Start a New Project')}
							</gl-button>
						`,
					)}
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-empty-state': GlGraphEmptyState;
	}
}
