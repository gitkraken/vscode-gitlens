import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { graphStateContext } from './context.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';

@customElement('gl-graph-empty-state')
export class GlGraphEmptyState extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			position: absolute;
			inset: 0;
			z-index: var(--gl-z-cover);
			display: flex;
			align-items: center;
			justify-content: center;
			padding: var(--gl-space-24);
			background: var(--vscode-editor-background);
			overflow: auto;
		}

		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--gl-space-16);
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

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	override render(): unknown {
		return html`
			<div class="container" role="group" aria-label="No repository open">
				<div class="icon"><code-icon icon="source-control"></code-icon></div>
				<h2 class="title">No repository open</h2>
				<p class="description">
					Open a folder or repository to visualize its history, branches, and commits in the Commit Graph.
				</p>
				<div class="actions">
					<gl-button full href="command:workbench.action.files.openFolder">
						<code-icon slot="prefix" icon="folder-opened"></code-icon>
						Open a Folder
					</gl-button>
					${when(
						this.graphState.isWeb,
						() => html`
							<gl-button appearance="secondary" full href="command:remoteHub.openRepository">
								<code-icon slot="prefix" icon="globe"></code-icon>
								Open Remote Repository
							</gl-button>
						`,
						() => html`
							<gl-button appearance="secondary" full href="command:git.clone">
								<code-icon slot="prefix" icon="repo-clone"></code-icon>
								Clone a Repository
							</gl-button>
							<gl-button appearance="secondary" full href="command:git.init">
								<code-icon slot="prefix" icon="new-folder"></code-icon>
								Start a New Project
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
