import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { MergeConflict } from '../../../../../git/models/mergeConflict';
import { createCommandLink } from '../../../../../system/commands';
import { pluralize } from '../../../../../system/string';
import { elementBase, linkBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import { chipStyles } from '../../shared/components/chipStyles';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';

@customElement('gl-merge-conflict-warning')
export class GlMergeConflictWarning extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		chipStyles,
		scrollableBase,
		css`
			.content {
				gap: 0.6rem;
			}

			.icon--warning {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
			}

			.body {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
				width: 100%;
			}

			.button-container {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
				margin-top: 0.4rem;
				margin-bottom: 0.4rem;
				align-items: center;
				justify-content: center;
				width: 100%;
			}

			.button-container gl-button {
				max-width: 30rem;
			}

			p {
				margin: 0 0.4rem;
			}

			p code-icon,
			gl-button code-icon {
				margin-bottom: 0.1rem;
			}

			details {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
				padding: 0;
				position: relative;
				margin: 0.4rem 0.2rem;
				overflow: hidden;
				border: 1px solid transparent;
				color: var(--color-foreground--85);
			}

			details[open] {
				border-radius: 0.3rem;
				border: 1px solid var(--vscode-sideBar-border);
			}

			summary {
				position: sticky;
				top: 0;
				color: var(--vscode-textLink-foreground);
				cursor: pointer;
				list-style: none;
				transition: transform ease-in-out 0.1s;
				padding: 0.2rem 0.6rem 0.4rem 0.6rem;
				z-index: 1;
			}

			summary:hover {
				color: var(--vscode-textLink-activeForeground);
			}

			details[open] > summary {
				border-radius: 0.3rem 0.3rem 0 0;

				background: var(--vscode-sideBar-background);
			}

			details[open] > summary code-icon {
				transform: rotate(90deg);
			}

			summary code-icon {
				transition: transform 0.2s;
			}

			.files {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;

				max-height: 8rem;
				overflow-y: auto;
				padding: 0.4rem 0.8rem;

				background: var(--vscode-sideBar-background);
			}
		`,
	];

	@property({ type: Object })
	conflict: MergeConflict | undefined;

	private get targetBranchRef() {
		if (this.conflict == null) return undefined;

		return {
			repoPath: this.conflict.repoPath,
			branchId: this.conflict.target,
		};
	}

	override render() {
		if (!this.conflict) return nothing;

		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip" tabindex="0"
				><code-icon class="icon--warning" icon="warning"></code-icon
			></span>
			<div slot="content" class="content">
				<div class="header">
					<span class="header__title">Potential Merge Conflicts</span>
				</div>
				<div class="body">
					<p>
						Merging ${this.renderBranch(this.conflict.branch)} into
						${this.renderBranch(this.conflict.target)} will likely cause conflicts in
						${pluralize('file', this.conflict.files.length)}.
					</p>
					${this.renderFiles(this.conflict.files)}
					<div class="button-container">
						<gl-button
							full
							href="${createCommandLink('gitlens.home.rebaseCurrentOnto', this.targetBranchRef)}"
							>Rebase ${this.renderBranch(this.conflict.branch)} onto
							${this.renderBranch(this.conflict.target)}</gl-button
						>
						<gl-button
							full
							appearance="secondary"
							href="${createCommandLink('gitlens.home.mergeIntoCurrent', this.targetBranchRef)}"
							>Merge ${this.renderBranch(this.conflict.target)} into
							${this.renderBranch(this.conflict.branch)}</gl-button
						>
					</div>
				</div>
			</div>
		</gl-popover>`;
	}

	private renderBranch(name: string) {
		return html`<code-icon icon="git-branch" size="12"></code-icon> <strong>${name}</strong>`;
	}

	private renderFiles(files: { path: string }[]) {
		return html`
			<details>
				<summary>
					<code-icon icon="chevron-right"></code-icon>
					Show ${files.length} affected files
				</summary>
				<div class="files scrollable">${files.map(file => this.renderFile(file.path))}</div>
			</details>
		`;
	}

	private renderFile(path: string) {
		return html`<span class="files__item"><code-icon icon="file"></code-icon> ${path}</span>`;
	}
}
