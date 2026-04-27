import type { CSSResultGroup, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { FileShowOptions, Preferences, State } from '../../../commitDetails/protocol.js';
import type { OpenMultipleChangesArgs } from '../../shared/actions/file.js';
import { renderCommitStatsIcons } from '../../shared/components/commit/commit-stats.js';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base.js';
import { detailsBaseStyles } from './gl-details-base.css.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/tree/gl-file-tree-pane.js';

type Files = Mutable<NonNullable<NonNullable<State['commit']>['files']>>;
export type File = Files[0];
type Mode = 'commit' | 'stash' | 'wip';

export interface FileChangeListItemDetail extends File {
	showOptions?: FileShowOptions;
}

export class GlDetailsBase extends LitElement {
	static override styles: CSSResultGroup = detailsBaseStyles;

	@property({ reflect: true })
	variant: 'standalone' | 'embedded' = 'standalone';

	@property({ type: Array })
	files?: Files;

	@property({ type: Boolean })
	isUncommitted = false;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Object })
	searchContext?: State['searchContext'];

	@property({ type: Boolean, attribute: 'file-icons' })
	fileIcons = false;

	@property({ type: Boolean, attribute: 'files-collapsable' })
	filesCollapsable = true;

	@property({ type: Boolean })
	hasAccount = false;

	@property({ type: Boolean })
	hasIntegrationsConnected = false;

	@property({ attribute: 'empty-text' })
	emptyText? = 'No Files';

	protected _getFileActions = (file: File, opts?: Partial<TreeItemBase>) => this.getFileActions(file, opts);
	protected _getFileContext = (file: File) => this.getFileContext(file);
	protected _onFileChecked = (e: CustomEvent) => this.onFileChecked(e);

	protected renderChangedFiles(
		_mode: Mode,
		options?: {
			stats?: import('@gitlens/git/models/commit.js').GitCommitStats;
			multiDiff?: { repoPath: string; lhs: string; rhs: string; title?: string };
			loading?: boolean;
		},
	): TemplateResult<1> {
		const multiDiff = options?.multiDiff;
		const buttons: ('layout' | 'search' | 'multi-diff')[] | undefined = multiDiff
			? ['layout', 'search', 'multi-diff']
			: undefined;

		// Cold-cache transition: when the embedded panel has been handed a "lite" commit shell
		// (files == null) while a full fetch is in flight, suppress the empty-text and render
		// a spinner in the before-tree slot — same pattern as gl-details-compare-mode-panel —
		// so users don't read "No Files" as a final answer during the brief load.
		const isLoadingEmpty = options?.loading === true && !this.files?.length;

		return html`
			<gl-file-tree-pane
				.files=${this.files}
				.filesLayout=${this.preferences?.files}
				.showIndentGuides=${this.preferences?.indentGuides}
				.collapsable=${this.filesCollapsable}
				?show-file-icons=${this.fileIcons}
				.fileActions=${this._getFileActions}
				.fileContext=${this._getFileContext}
				.searchContext=${this.searchContext}
				.buttons=${buttons}
				empty-text=${isLoadingEmpty ? '' : (this.emptyText ?? 'No Files')}
				@file-checked=${this._onFileChecked}
				@gl-file-tree-pane-open-multi-diff=${multiDiff ? () => this.onOpenMultiDiff(multiDiff) : null}
			>
				${options?.stats
					? html`<span slot="subtitle" style="opacity: 1">${this.renderCommitStats(options.stats)}</span>`
					: nothing}
				${isLoadingEmpty
					? html`<div slot="before-tree" class="files-loading" aria-busy="true">
							<code-icon icon="loading" modifier="spin"></code-icon>
							<span>Loading…</span>
						</div>`
					: nothing}
				${this.renderChangedFilesSlottedContent()}
			</gl-file-tree-pane>
		`;
	}

	private onOpenMultiDiff(refs: { repoPath: string; lhs: string; rhs: string; title?: string }): void {
		const files = this.files;
		if (!files?.length) return;

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: {
					files: files,
					repoPath: refs.repoPath,
					lhs: refs.lhs,
					rhs: refs.rhs,
					title: refs.title,
				} satisfies OpenMultipleChangesArgs,
				bubbles: true,
				composed: true,
			}),
		);
	}

	protected onFileChecked(_e: CustomEvent): void {
		// Override in subclasses to handle file checked events (e.g., stage/unstage)
	}

	protected renderChangedFilesSlottedContent(): TemplateResult<1> | typeof nothing {
		return nothing;
	}

	protected renderLearnAboutAutolinks(showLabel = false) {
		const autolinkSettingsLink = createCommandLink('gitlens.showSettingsPage!autolinks', {
			showOptions: { preserveFocus: true },
		});

		let label =
			'Configure autolinks to linkify external references, like Jira or Zendesk tickets, in commit messages.';
		if (!this.hasIntegrationsConnected) {
			label = `<a href="${autolinkSettingsLink}">Configure autolinks</a> to linkify external references, like Jira or Zendesk tickets, in commit messages.`;
			label += `\n\n<a href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
				'gitlens.plus.cloudIntegrations.connect',
				{
					source: {
						source: 'inspect',
						detail: {
							action: 'connect',
						},
					},
				},
			)}">Connect an Integration</a> &mdash;`;

			if (!this.hasAccount) {
				label += ' sign up and';
			}

			label += ' to get access to automatic rich autolinks for services like Jira, GitHub, and more.';
		}

		return html`<gl-action-chip
			href=${autolinkSettingsLink}
			data-action="autolink-settings"
			icon="info"
			.label=${label}
			overlay=${this.hasIntegrationsConnected ? 'tooltip' : 'popover'}
			>${showLabel ? html`<span class="mq-hide-sm">&nbsp;No autolinks found</span>` : nothing}</gl-action-chip
		>`;
	}

	protected renderCommitStats(stats?: GitCommitStats) {
		return renderCommitStatsIcons(stats, { includeLineStats: true });
	}

	protected onShareWipChanges(_e: Event, staged: boolean, hasFiles: boolean): void {
		if (!hasFiles) return;
		const event = new CustomEvent('share-wip', {
			detail: {
				checked: staged,
			},
		});
		this.dispatchEvent(event);
	}

	protected getFileActions(_file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		return [];
	}

	protected getFileContext(_file: File): string | undefined {
		return undefined;
	}
}
