import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createCommandLink } from '../../../../../system/commands';
import { pluralize } from '../../../../../system/string';
import type { GetOverviewBranch } from '../../../../home/protocol';
import { renderBranchName } from '../../../shared/components/branch-name';
import { elementBase, linkBase, scrollableBase } from '../../../shared/components/styles/lit/base.css';
import { chipStyles } from '../../shared/components/chipStyles';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';

@customElement('gl-merge-target-status')
export class GlMergeTargetStatus extends LitElement {
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
			.header__actions {
				margin-top: 0.4rem;
			}

			.content {
				gap: 0.6rem;
			}

			:host-context(.vscode-dark),
			:host-context(.vscode-high-contrast) {
				--color-status--in-sync: #00bb00;
				--color-merge--clean: #00bb00;
				--color-merge--conflict: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--color-status--in-sync: #00aa00;
				--color-merge--clean: #00aa00;
				--color-merge--conflict: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			.header__title code-icon {
				margin-bottom: 0.1rem;
			}

			.header__title code-icon.status--warning {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			.status--conflict .icon {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			.status--conflict .status-indicator {
				/* color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor); */
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			.status--behind .icon {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			.status--behind .status-indicator {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			.status--behind .icon {
				/* color: var(--color-status--in-sync); */
			}

			.status--in-sync .status-indicator {
				color: var(--color-status--in-sync);
			}

			.status--merge-conflict {
				color: var(--color-merge--conflict);
			}

			.status--merge-clean {
				color: var(--color-merge--clean);
			}

			.status-indicator {
				margin-left: -0.5rem;
				margin-top: 0.8rem;
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
				margin: 0 0.2rem 0.4rem;
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
				color: var(--color-foreground);
				cursor: pointer;
				list-style: none;
				transition: transform ease-in-out 0.1s;
				padding: 0.4rem 0.6rem 0.4rem 0.6rem;
				z-index: 1;
			}

			summary:hover {
				color: var(--vscode-textLink-activeForeground);
			}

			details[open] > summary {
				color: var(--vscode-textLink-foreground);
				border-radius: 0.3rem 0.3rem 0 0;
				margin-left: 0;
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

			gl-popover {
				--max-width: 80vw;
			}
		`,
	];

	@property({ type: String })
	branch: string | undefined;

	@state()
	private _target: Awaited<GetOverviewBranch['mergeTarget']>;
	get target() {
		return this._target;
	}

	private _targetPromise: GetOverviewBranch['mergeTarget'];
	get targetPromise(): GetOverviewBranch['mergeTarget'] {
		return this._targetPromise;
	}
	@property({ type: Object })
	set targetPromise(value: GetOverviewBranch['mergeTarget']) {
		if (this._targetPromise === value) return;

		this._targetPromise = value;
		this._target = undefined;

		void this._targetPromise?.then(
			r => (this._target = r),
			() => {},
		);
	}

	private get conflicts() {
		return this.target?.potentialConflicts;
	}

	private get status() {
		return this.target?.status;
	}

	private get targetBranchRef() {
		if (this.target?.name == null) return undefined;

		return {
			repoPath: this.target.repoPath,
			branchId: this.target.name,
		};
	}

	override render() {
		if (!this.status && !this.conflicts) return nothing;

		let statusClass;
		let statusIndicator;
		if (this.conflicts) {
			statusClass = 'status--conflict';
			statusIndicator = 'warning';
		} else if ((this.status?.behind ?? 0) > 0) {
			statusClass = 'status--behind';
			statusIndicator = 'arrow-down';
		} else {
			statusClass = 'status--in-sync';
			statusIndicator = 'check';
		}

		const iconStatus = this.conflicts
			? 'icon--conflict'
			: (this.status?.behind ?? 0) > 0
			  ? 'icon--behind'
			  : 'icon--in-sync';

		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip ${statusClass}" tabindex="0"
				><code-icon class="icon " icon="gl-merge-target" size="18"></code-icon
				></code-icon><code-icon class="status-indicator ${iconStatus}" icon="${statusIndicator}" size="12"></code-icon>
			</span>
			<div slot="content" class="content">${this.renderContent()}</div>
		</gl-popover>`;
	}

	private renderContent() {
		const target = renderBranchName(this.target?.name);

		const mergeTargetInfo = html`<span class="header__actions"
			><gl-tooltip position="bottom" style="cursor:help;">
				<code-icon icon="question" size="18"></code-icon>
				<span slot="content"
					>The "merge target" is the branch that ${renderBranchName(this.branch)} is most likely to be merged
					into.</span
				>
			</gl-tooltip></span
		>`;

		if (this.conflicts) {
			return html`
				<div class="header">
					<span class="header__title"
						><code-icon class="status--warning" icon="warning"></code-icon> Potential Conflicts with Merge
						Target</span
					>
					${mergeTargetInfo}
				</div>
				<div class="body">
					${this.status
						? html`<p>
								Your current branch ${renderBranchName(this.branch)} is
								${pluralize('commit', this.status.behind)} behind its merge target ${target}.
						  </p>`
						: nothing}
					<div class="button-container">
						<gl-button
							full
							href="${createCommandLink('gitlens.home.rebaseCurrentOnto', this.targetBranchRef)}"
							>Rebase ${renderBranchName(this.conflicts.branch)} onto ${target}</gl-button
						>
						<gl-button
							full
							appearance="secondary"
							href="${createCommandLink('gitlens.home.mergeIntoCurrent', this.targetBranchRef)}"
							>Merge ${target} into ${renderBranchName(this.conflicts.branch)}</gl-button
						>
					</div>
					<p class="status--merge-conflict">
						<code-icon icon="warning"></code-icon> Merging will cause conflicts in
						${pluralize('file', this.conflicts.files.length)} that will need to be resolved.
					</p>
					${this.renderFiles(this.conflicts.files)}
				</div>
			`;
		}

		if (this.status != null) {
			if (this.status.behind > 0) {
				return html`<div class="header">
						<span class="header__title"
							><code-icon class="status--warning" icon="arrow-down"></code-icon> ${pluralize(
								'Commit',
								this.status.behind,
							)}
							Behind Merge Target</span
						>
						${mergeTargetInfo}
					</div>
					<div class="body">
						<p>
							Your current branch ${renderBranchName(this.branch)} is
							${pluralize('commit', this.status.behind)} behind its merge target ${target}.
						</p>
						<div class="button-container">
							<gl-button
								full
								href="${createCommandLink('gitlens.home.rebaseCurrentOnto', this.targetBranchRef)}"
								>Rebase ${renderBranchName(this.branch)} onto ${target}</gl-button
							>
							<gl-button
								full
								appearance="secondary"
								href="${createCommandLink('gitlens.home.mergeIntoCurrent', this.targetBranchRef)}"
								>Merge ${target} into ${renderBranchName(this.branch)}</gl-button
							>
						</div>
						<p class="status--merge-clean">
							<code-icon icon="check"></code-icon> Merging will not cause conflicts.
						</p>
					</div>`;
			}

			return html`<div class="header">
					<span class="header__title"><code-icon icon="check"></code-icon> Up to Date with Merge Target</span>
					${mergeTargetInfo}
				</div>
				<div class="body">
					<p>
						Your current branch ${renderBranchName(this.branch)} is up to date with its merge target
						${target}.
					</p>
				</div>`;
		}

		return nothing;
	}

	private renderFiles(files: { path: string }[]) {
		return html`
			<details>
				<summary>
					<code-icon icon="chevron-right"></code-icon>
					Show ${files.length} conflicting files
				</summary>
				<div class="files scrollable">${files.map(file => this.renderFile(file.path))}</div>
			</details>
		`;
	}

	private renderFile(path: string) {
		return html`<span class="files__item"><code-icon icon="file"></code-icon> ${path}</span>`;
	}
}
