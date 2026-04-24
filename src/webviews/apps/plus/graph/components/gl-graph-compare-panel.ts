import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../../commands/cloudIntegrations.js';
import { createCommandLink } from '../../../../../system/commands.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type {
	CommitDetails,
	CommitSignatureShape,
	DetailsItemTypedContext,
	Preferences,
	State,
} from '../../../../plus/graph/detailsProtocol.js';
import { messageHeadlineSplitterToken } from '../../../../plus/graph/detailsProtocol.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import { redispatch } from '../../../shared/components/element.js';
import { elementBase, scrollbarThinFor, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemAction } from '../../../shared/components/tree/base.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { comparePanelStyles, panelActionInputStyles, panelHostStyles } from './gl-graph-compare-panel.css.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/commit/signature-badge.js';
import '../../../shared/components/commit/signature-details.js';
import '../../../shared/components/formatted-date.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/chips/autolink-chip.js';
import '../../../shared/components/chips/chip-overflow.js';
import '../../../shared/components/button.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/menu/menu-item.js';
import '../../../shared/components/menu/menu-label.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import '../../../shared/components/details-header/gl-details-header.js';
import './gl-commit-row.js';

@customElement('gl-graph-compare-panel')
export class GlGraphComparePanel extends LitElement {
	static override styles = [
		elementBase,
		panelHostStyles,
		panelActionInputStyles,
		comparePanelStyles,
		subPanelEnterStyles,
		scrollbarThinFor('.pole-popover__message'),
	];

	@property({ type: Object })
	commitFrom?: CommitDetails;

	@property({ type: Object })
	commitTo?: CommitDetails;

	@property({ type: Array })
	files?: readonly GitFileChangeShape[];

	@property({ type: Object })
	stats?: GitCommitStats;

	@property({ type: Boolean })
	swapped = false;

	@property({ type: Array })
	autolinks?: Autolink[];

	@property({ type: Boolean })
	loading = false;

	@property({ type: Number })
	betweenCount = 0;

	@property({ type: Object })
	signatureFrom?: CommitSignatureShape;

	@property({ type: Object })
	signatureTo?: CommitSignatureShape;

	@property({ type: Boolean })
	autolinksEnabled = false;

	@property({ type: Array })
	enrichedItems?: IssueOrPullRequest[];

	@property({ type: Boolean })
	enrichmentLoading = false;

	@property({ type: Boolean })
	explainBusy = false;

	@property({ type: Boolean })
	aiEnabled = false;

	@property()
	activeMode?: 'review' | 'compose' | 'compare' | null;

	@property({ attribute: false })
	subPanelContent?: ReturnType<typeof html> | typeof nothing;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Boolean, attribute: 'file-icons' })
	fileIcons = false;

	@property({ type: Boolean, attribute: 'files-collapsable' })
	filesCollapsable = true;

	@property({ type: Boolean })
	hasAccount = false;

	@property({ type: Boolean })
	hasIntegrationsConnected = false;

	@property({ type: Object })
	searchContext?: GitCommitSearchContext;

	@state() private _enrichmentNoneFound = false;
	private _enrichmentNoneFoundTimer?: ReturnType<typeof setTimeout>;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', 'Comparing commits');
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		clearTimeout(this._enrichmentNoneFoundTimer);
	}

	protected override willUpdate(changedProperties: PropertyValues): void {
		super.willUpdate(changedProperties);

		if (changedProperties.has('enrichedItems')) {
			clearTimeout(this._enrichmentNoneFoundTimer);

			const prev = changedProperties.get('enrichedItems') as IssueOrPullRequest[] | undefined;
			// Transition from undefined (not yet loaded) to empty array (none found)
			if (prev === undefined && this.enrichedItems?.length === 0) {
				this._enrichmentNoneFound = true;
				this._enrichmentNoneFoundTimer = setTimeout(() => {
					this._enrichmentNoneFound = false;
				}, 3000);
			} else {
				this._enrichmentNoneFound = false;
			}
		}
	}

	override render() {
		const isInitialLoad = this.loading && !this.commitFrom && !this.commitTo;
		// Use a single template so the header element persists across mode toggles,
		// allowing the CSS transition on .mode-header to animate. `cache` keeps both
		// body sub-trees alive across sub-panel toggles so the explain input and file
		// tree retain focus, scroll position, and expansion state.
		const hasSubPanel = this.subPanelContent != null && this.subPanelContent !== nothing;

		return html`
			${isInitialLoad
				? html`<div class="details-loading" aria-busy="true" aria-live="polite">Loading...</div>`
				: html`
						${this.renderCompareHeader()} ${hasSubPanel ? nothing : this.renderMetadataBar()}
						${cache(
							hasSubPanel
								? html`<div class="sub-panel-enter">${this.subPanelContent}</div>`
								: html`${this.renderPoles()} ${this.renderAutolinksRow()} ${this.renderExplainInput()}
										<div class="compare-files">
											<webview-pane-group flexible>
												<gl-file-tree-pane
													.files=${this.files}
													.filesLayout=${this.preferences?.files}
													.showIndentGuides=${this.preferences?.indentGuides}
													.collapsable=${this.filesCollapsable}
													?show-file-icons=${this.fileIcons}
													.fileActions=${this.fileActions}
													.fileContext=${this.getFileContext}
													.searchContext=${this.searchContext}
													.buttons=${this.getMultiDiffRefs()
														? ['layout', 'search', 'multi-diff']
														: undefined}
													@file-compare-previous=${this.handleFileCompareBetween}
													@file-open=${this.redispatch}
													@file-compare-working=${this.redispatch}
													@file-more-actions=${this.redispatch}
													@change-files-layout=${this.redispatch}
													@gl-file-tree-pane-open-multi-diff=${this.handleOpenMultiDiff}
												></gl-file-tree-pane>
											</webview-pane-group>
										</div>`,
						)}
					`}
		`;
	}

	private get fileActions(): TreeItemAction[] {
		return [
			{
				icon: 'go-to-file',
				label: 'Open File',
				action: 'file-open',
			},
			{
				icon: 'git-compare',
				label: 'Open Changes with Working File',
				action: 'file-compare-working',
			},
		];
	}

	private getFileContext = (file: GitFileChangeShape): string | undefined => {
		const sha = this.commitTo?.sha;
		const repoPath = this.commitTo?.repoPath;
		if (!sha || !repoPath) return undefined;

		const context: DetailsItemTypedContext = {
			webviewItem: 'gitlens:file:comparison',
			webviewItemValue: {
				type: 'file',
				path: file.path,
				repoPath: repoPath,
				sha: sha,
				comparisonSha: this.commitFrom?.sha,
				status: file.status,
			},
		};

		return serializeWebviewItemContext(context);
	};

	private handleFileCompareBetween(e: CustomEvent<FileChangeListItemDetail>) {
		this.dispatchEvent(
			new CustomEvent('file-compare-between', { detail: e.detail, bubbles: true, composed: true }),
		);
	}

	private getMultiDiffRefs(): { repoPath: string; lhs: string; rhs: string; title?: string } | undefined {
		const files = this.files;
		if (!files?.length) return undefined;
		const repoPath = this.commitFrom?.repoPath ?? this.commitTo?.repoPath;
		const lhs = this.swapped ? this.commitTo?.sha : this.commitFrom?.sha;
		const rhs = this.swapped ? this.commitFrom?.sha : this.commitTo?.sha;
		if (!repoPath || !lhs || !rhs) return undefined;

		return {
			repoPath: repoPath,
			lhs: lhs,
			rhs: rhs,
			title: `Changes between ${shortenRevision(lhs)} and ${shortenRevision(rhs)}`,
		};
	}

	private handleOpenMultiDiff = (): void => {
		const refs = this.getMultiDiffRefs();
		const files = this.files;
		if (!refs || !files?.length) return;

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
	};

	private redispatch = redispatch.bind(this);

	private renderCompareHeader() {
		// Compare mode is always available — pivots the existing comparison through the
		// compare-refs picker so the user can swap one side for any branch/ref.
		const modes = this.aiEnabled ? (['review', 'compare'] as const) : (['compare'] as const);
		return html`<gl-details-header
			.activeMode=${this.activeMode}
			.loading=${this.loading}
			.modes=${modes}
			style="--mode-header-bg: var(--titlebar-bg, var(--vscode-sideBar-background, var(--color-background)))"
		>
			<span class="compare-header__title">Comparing Between Commits</span>
		</gl-details-header>`;
	}

	private renderMetadataBar() {
		const fromSha = this.commitFrom?.sha;
		const toSha = this.commitTo?.sha;
		if (!fromSha || !toSha) return nothing;

		return html`<div class="compare-metadata">
			<div class="compare-metadata__left">
				<gl-commit-sha-copy
					class="compare-metadata__sha"
					appearance="toolbar"
					tooltip-placement="bottom"
					copy-label="Copy SHA"
					copied-label="Copied!"
					.sha=${fromSha}
					icon="git-commit"
				></gl-commit-sha-copy>
				<span class="compare-metadata__dots">..</span>
				<gl-commit-sha-copy
					class="compare-metadata__sha"
					appearance="toolbar"
					tooltip-placement="bottom"
					copy-label="Copy SHA"
					copied-label="Copied!"
					.sha=${toSha}
					icon="git-commit"
				></gl-commit-sha-copy>
			</div>
			<div class="compare-metadata__right">${this.renderCommitStats(this.stats)}</div>
		</div>`;
	}

	private renderPoles() {
		return html`<div class="compare-poles">
			${this.renderPoleCard(this.commitFrom, this.signatureFrom)}
			<div class="compare-middle">
				<div class="compare-middle__line">
					<div class="compare-middle__rule"></div>
					<gl-tooltip hoist content="Swap Direction" placement="bottom">
						<button
							class="compare-middle__swap"
							aria-label="Swap comparison direction"
							@click=${this.handleSwap}
						>
							<code-icon icon="arrow-swap"></code-icon>
						</button>
					</gl-tooltip>
					<div class="compare-middle__rule"></div>
				</div>
				${this.betweenCount > 0
					? html`<span class="compare-middle__count"
							>${pluralize('commit', this.betweenCount)} in between</span
						>`
					: nothing}
			</div>
			${this.renderPoleCard(this.commitTo, this.signatureTo)}
		</div>`;
	}

	private renderPoleCard(commit: CommitDetails | undefined, signature?: CommitSignatureShape) {
		if (!commit) return html`<div class="pole-card pole-card--loading">Loading...</div>`;

		const message = commit.message;
		const showSignature = this.preferences?.showSignatureBadges && signature != null;

		// Map CommitDetails into the shared gl-commit-row data shape so the multi-commit pole
		// anchor and the WIP-compare commit list render identically. The signature badge stays
		// as a card-only adornment overlaid on the avatar (passed via the row's signature slot
		// would couple gl-commit-row to signature concerns; instead the card renders it next to
		// the row).
		const rowData = {
			sha: commit.sha,
			shortSha: commit.shortSha,
			message: message,
			author: commit.author.name,
			authorEmail: commit.author.email,
			avatarUrl: commit.author.avatar ?? undefined,
			date:
				typeof commit.author.date === 'string'
					? commit.author.date
					: (commit.author.date.toISOString?.() ?? ''),
		};

		return html`<gl-popover hoist placement="bottom" trigger="hover focus" class="pole-card__popover">
			<div slot="anchor" class="pole-card" tabindex="0" @click=${() => this.handlePoleClick(commit.sha)}>
				${showSignature
					? html`<gl-signature-badge
							class="pole-card__signature"
							.signature=${signature}
							.committerEmail=${commit.committer?.email}
						></gl-signature-badge>`
					: nothing}
				<gl-commit-row .commit=${rowData} .preferences=${this.preferences}></gl-commit-row>
			</div>
			<div slot="content" class="pole-popover">
				<div class="pole-popover__header">
					<div class="pole-popover__info">
						<img class="pole-popover__avatar" src=${commit.author.avatar ?? ''} alt=${commit.author.name} />
						<div class="pole-popover__details">
							<span class="pole-popover__name">${commit.author.name}</span>
							${commit.author.email
								? html`<span class="pole-popover__email"
										><a href="mailto:${commit.author.email}">${commit.author.email}</a></span
									>`
								: nothing}
						</div>
					</div>
					<formatted-date
						class="pole-popover__date"
						.date=${commit.author.date}
						.format=${this.preferences?.dateFormat ?? 'MMMM Do, YYYY h:mma'}
						.dateStyle=${'absolute'}
					></formatted-date>
				</div>
				${showSignature
					? html`<gl-signature-details
							.signature=${signature}
							.committerEmail=${commit.committer?.email}
						></gl-signature-details>`
					: nothing}
				<div class="pole-popover__message">${message.replaceAll(messageHeadlineSplitterToken, '\n')}</div>
			</div>
		</gl-popover>`;
	}

	private getMergedAutolinks() {
		const autolinks = this.autolinks;
		const enriched = this.enrichedItems;

		if (!enriched?.length) {
			return { autolinks: autolinks ?? [], enriched: [] };
		}

		// Enriched items upgrade matching basic autolinks — deduplicate by ID
		const enrichedIds = new Set(enriched.map(i => i.id));
		const remaining = autolinks?.filter(a => !enrichedIds.has(a.id)) ?? [];
		return { autolinks: remaining, enriched: enriched };
	}

	private renderAutolinksRow() {
		const { autolinks, enriched } = this.getMergedAutolinks();
		const hasAutolinks = autolinks.length > 0;
		const hasEnriched = enriched.length > 0;
		const hasChips = hasAutolinks || hasEnriched;

		return html`<div class="compare-enrichment">
			<gl-chip-overflow max-rows="1">
				${hasChips ? nothing : html`<span slot="prefix">${this.renderLearnAboutAutolinks(true)}</span>`}
				${hasAutolinks
					? autolinks.map(autolink => {
							const name = autolink.description ?? autolink.title ?? `${autolink.prefix}${autolink.id}`;
							return html`<gl-autolink-chip
								type="autolink"
								name=${name}
								url=${autolink.url}
								identifier="${autolink.prefix}${autolink.id}"
							></gl-autolink-chip>`;
						})
					: nothing}
				${hasEnriched
					? enriched.map(
							item =>
								html`<gl-autolink-chip
									type=${item.type === 'pullrequest' ? 'pr' : 'issue'}
									name=${item.title}
									url=${item.url}
									identifier="#${item.id}"
									status=${item.state}
									.date=${item.closed ? item.closedDate : item.createdDate}
									.dateFormat=${this.preferences?.dateFormat}
									.dateStyle=${this.preferences?.dateStyle}
								></gl-autolink-chip>`,
						)
					: nothing}
				${this.renderAutolinksPopover(autolinks, enriched)} ${this.renderEnrichButton()}
				${hasChips ? html`<span slot="suffix">${this.renderLearnAboutAutolinks()}</span>` : nothing}
			</gl-chip-overflow>
		</div>`;
	}

	private renderAutolinksPopover(autolinks: Autolink[], enriched: IssueOrPullRequest[]) {
		if (!autolinks.length && !enriched.length) return nothing;

		const enrichedPrs = enriched.filter(i => i.type === 'pullrequest');
		const enrichedIssues = enriched.filter(i => i.type !== 'pullrequest');
		let needsDivider = false;

		return html`<div slot="popover">
			${enrichedPrs.length > 0
				? html`<menu-label>Pull Requests</menu-label> ${enrichedPrs.map(
							pr =>
								html`<menu-item href=${pr.url}>
									<code-icon icon="git-pull-request"></code-icon> #${pr.id}
									${pr.title ? ` — ${pr.title}` : ''}
								</menu-item>`,
						)}${((needsDivider = true), nothing)}`
				: nothing}
			${enrichedIssues.length > 0
				? html`${needsDivider ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Issues</menu-label>
						${enrichedIssues.map(
							issue =>
								html`<menu-item href=${issue.url}>
									<code-icon icon="issues"></code-icon> #${issue.id}
									${issue.title ? ` — ${issue.title}` : ''}
								</menu-item>`,
						)}${((needsDivider = true), nothing)}`
				: nothing}
			${autolinks.length > 0
				? html`${needsDivider ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Autolinks</menu-label>
						${autolinks.map(
							a =>
								html`<menu-item href=${a.url}>
									<code-icon icon="link"></code-icon> ${a.prefix}${a.id}${a.provider?.name
										? ` on ${a.provider.name}`
										: ''}
								</menu-item>`,
						)}`
				: nothing}
		</div>`;
	}

	private renderEnrichButton() {
		if (!this.hasIntegrationsConnected) return nothing;

		if (this._enrichmentNoneFound) {
			return html`<gl-action-chip
				slot="suffix"
				icon="info"
				label="No Additional Issues or Pull Requests Found"
				overlay="tooltip"
			></gl-action-chip>`;
		}

		if (this.enrichedItems != null) return nothing;

		if (this.enrichmentLoading) {
			return html`<gl-action-chip
				slot="suffix"
				icon="loading"
				label="Loading Issues and Pull Requests..."
				overlay="tooltip"
				disabled
			></gl-action-chip>`;
		}

		return html`<gl-action-chip
			slot="suffix"
			icon="sync"
			label="Load Associated Issues and Pull Requests"
			overlay="tooltip"
			@click=${this.handleEnrichAutolinks}
		></gl-action-chip>`;
	}

	private handleEnrichAutolinks() {
		this.dispatchEvent(new CustomEvent('enrich-autolinks', { bubbles: true, composed: true }));
	}

	private renderExplainInput() {
		if (this.orgSettings?.ai === false) return nothing;

		return html`<gl-ai-input multiline .busy=${this.explainBusy}></gl-ai-input>`;
	}

	private renderCommitStats(stats?: GitCommitStats, appearance?: 'pill') {
		if (stats?.files == null) return undefined;

		if (typeof stats.files === 'number') {
			return html`<commit-stats
				modified="${stats.files}"
				additions="${stats.additions ?? nothing}"
				deletions="${stats.deletions ?? nothing}"
				symbol="icons"
				appearance="${appearance ?? nothing}"
			></commit-stats>`;
		}

		const { added, deleted, changed } = stats.files;
		return html`<commit-stats
			added="${added}"
			modified="${changed}"
			removed="${deleted}"
			additions="${stats.additions ?? nothing}"
			deletions="${stats.deletions ?? nothing}"
			symbol="icons"
			appearance="${appearance ?? nothing}"
		></commit-stats>`;
	}

	private renderLearnAboutAutolinks(showLabel = false) {
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

	private handleCloseDetails() {
		this.dispatchEvent(new CustomEvent('close-details', { bubbles: true, composed: true }));
	}

	private handlePoleClick(sha: string) {
		this.dispatchEvent(new CustomEvent('select-commit', { detail: { sha: sha }, bubbles: true, composed: true }));
	}

	private handleSwap() {
		// Swaps the multi-commit compare selection order (from/to). Distinct from
		// `swap-refs` in the wip-compare panel, which swaps ahead/behind refs.
		this.dispatchEvent(new CustomEvent('swap-selection', { bubbles: true, composed: true }));
	}
}
