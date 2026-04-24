import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { formatIdentityDisplayName } from '@gitlens/git/utils/commit.utils.js';
import type { Autolink } from '../../../../autolinks/models/autolinks.js';
import type { IpcSerialized } from '../../../../system/ipcSerialize.js';
import { serializeWebviewItemContext } from '../../../../system/webview.js';
import type {
	State as _State,
	CommitSignatureShape,
	DetailsItemContext,
	DetailsItemTypedContext,
} from '../../../commitDetails/protocol.js';
import { messageHeadlineSplitterToken } from '../../../commitDetails/protocol.js';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base.js';
import { commitDetailsStyles } from './gl-commit-details.css.js';
import { detailsBaseStyles } from './gl-details-base.css.js';
import type { File } from './gl-details-base.js';
import { GlDetailsBase } from './gl-details-base.js';
import '../../shared/components/button.js';
import '../../shared/components/chips/action-chip.js';
import '../../shared/components/chips/autolink-chip.js';
import '../../shared/components/chips/chip-overflow.js';
import '../../shared/components/menu/menu-divider.js';
import '../../shared/components/menu/menu-item.js';
import '../../shared/components/menu/menu-label.js';
import '../../shared/components/branch-name.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/copy-container.js';
import '../../shared/components/commit/commit-author.js';
import '../../shared/components/commit/commit-stats.js';
import '../../shared/components/commit-sha.js';
import '../../shared/components/markdown/markdown.js';
import '../../shared/components/panes/pane-group.js';
import '../../shared/components/rich/issue-pull-request.js';
import '../../shared/components/split-panel/split-panel.js';
import '../../shared/components/progress.js';
import '../../shared/components/ai-input.js';
import '../../shared/components/details-header/gl-details-header.js';

type State = IpcSerialized<_State>;
interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

@customElement('gl-commit-details')
export class GlCommitDetails extends GlDetailsBase {
	static override styles = [...detailsBaseStyles, commitDetailsStyles];

	@property({ type: Object })
	commit?: State['commit'];

	@property({ type: Boolean })
	autolinksEnabled = false;

	@property({ type: Array })
	autolinkedIssues?: IssueOrPullRequest[];

	@property({ type: Object })
	pullRequest?: PullRequestShape;

	@property({ type: Boolean })
	hasRemotes = true;

	@state()
	get isStash(): boolean {
		return this.commit?.stashNumber != null;
	}

	@state()
	explainBusy = false;

	@property({ type: Object })
	explain?: ExplainState;

	@property({ type: Object })
	reachability?: GitCommitReachability;

	@property({ type: String })
	reachabilityState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';

	@property({ type: Array })
	autolinks?: Autolink[];

	@property({ type: String })
	formattedMessage?: string;

	@property({ type: Object })
	signature?: CommitSignatureShape;

	@property({ type: String, attribute: 'branch-name' })
	branchName?: string;

	// Sub-panel mode support (review/compose body swap)
	@property({ type: Boolean })
	aiEnabled = false;

	/** Host advertises that it supports compare mode (graph orchestrator does, standalone doesn't). */
	@property({ type: Boolean, attribute: 'compare-enabled' })
	compareEnabled = false;

	@property()
	activeMode?: 'review' | 'compose' | 'compare' | null;

	@property({ attribute: false })
	subPanelContent?: ReturnType<typeof html> | typeof nothing;

	@property({ type: Boolean })
	loading = false;

	@property({ type: Boolean, attribute: 'panel-actions' })
	panelActions = true;

	@state()
	private _reachabilityExpanded = false;

	private _messagePanelHeight?: number;
	private _scrollbarObserver?: ResizeObserver;

	@state()
	private _userAdjustedSplitter = false;

	private _messagePanelSnap = ({ pos }: { pos: number }) => {
		return Math.max(5, Math.min(pos, 60));
	};

	private _onMessagePanelChange = (e: CustomEvent<{ position: number }>) => {
		this._messagePanelHeight = e.detail.position;
	};

	private _onMessagePanelDragEnd = () => {
		this._userAdjustedSplitter = true;
	};

	private _onDividerDblClick = () => {
		// Reset to the same auto-size state as initial render:
		// position=25 with fit-content(25%) handles the sizing via CSS
		this._userAdjustedSplitter = false;
		this._messagePanelHeight = undefined;

		// Force the split panel to pick up the reset position immediately
		// (attribute binding alone may not re-trigger if Lit optimizes the update)
		const splitEl =
			this.renderRoot.querySelector<import('../../shared/components/split-panel/split-panel.js').GlSplitPanel>(
				'gl-split-panel',
			);
		if (splitEl) {
			splitEl.position = 25;
		}

		this.requestUpdate();
	};

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._scrollbarObserver?.disconnect();
		this._scrollbarObserver = undefined;
		this._userAdjustedSplitter = false;
		this._messagePanelHeight = undefined;
	}

	override updated(changedProperties: Map<string, any>): void {
		if (changedProperties.has('explain')) {
			this.explainBusy = false;
			this.renderRoot.querySelector('[data-region="commit-explanation"]')?.scrollIntoView();
		}
		if (changedProperties.has('commit')) {
			this.explainBusy = false;
			this._reachabilityExpanded = false;
			this.renderRoot.querySelector('[data-region="message"]')?.scrollTo?.(0, 0);
		}

		this.observeMessageScrollbar();
	}

	private observeMessageScrollbar(): void {
		const el = this.renderRoot.querySelector<HTMLElement>('[data-region="message"]');
		if (!el || this._scrollbarObserver) return;

		const update = () => {
			const hasScrollbar = el.scrollHeight > el.clientHeight;
			el.closest('.message-block')?.toggleAttribute('data-has-scrollbar', hasScrollbar);
		};

		this._scrollbarObserver = new ResizeObserver(update);
		this._scrollbarObserver.observe(el);
		update();
	}

	override render(): unknown {
		if (this.commit == null) {
			if (this.panelActions) return nothing;
			return this.renderEmptyContent();
		}

		return this.renderEmbedded();
	}

	private renderEmbedded() {
		const commit = this.commit;
		if (!commit) return nothing;

		// Use a single template so the header element persists across mode toggles,
		// allowing the CSS transition on .mode-header to animate.
		const hasSubPanel = this.subPanelContent != null && this.subPanelContent !== nothing;
		const hasMessage = !this.isUncommitted;
		const fileMode = this.isStash ? 'stash' : 'commit';
		const renderOpts = { multiDiff: this.getMultiDiffRefs() };

		return html`
			${hasSubPanel ? nothing : this.renderHiddenNotice()} ${this.renderEmbeddedAuthorHeader()}
			${hasSubPanel
				? html`${this.activeMode !== 'compare' ? this.renderEmbeddedMetadataBar() : nothing}
						<div class="sub-panel-enter">${this.subPanelContent}</div>`
				: html`${this.renderEmbeddedMetadataBar()}
					${hasMessage
						? html`<gl-split-panel
								orientation="vertical"
								primary="start"
								class="split ${this._userAdjustedSplitter ? '' : 'split--auto-size'}"
								position="${this._messagePanelHeight ?? 25}"
								.snap=${this._messagePanelSnap}
								@gl-split-panel-change=${this._onMessagePanelChange}
								@gl-split-panel-drag-end=${this._onMessagePanelDragEnd}
								@gl-split-panel-dblclick=${this._onDividerDblClick}
							>
								<div slot="start" class="msg-slot">${this.renderEmbeddedMessage()}</div>
								<div slot="divider" class="split__handle"></div>
								<div slot="end" class="bottom-section">
									${this.renderEmbeddedAutolinks()} ${this.renderEmbeddedExplainInput()}
									<div class="files">
										<webview-pane-group flexible>
											${this.renderChangedFiles(fileMode, renderOpts)}
										</webview-pane-group>
									</div>
								</div>
							</gl-split-panel>`
						: html`<div class="files">
								<webview-pane-group flexible>
									${this.renderChangedFiles(fileMode, renderOpts)}
								</webview-pane-group>
							</div>`}`}
		`;
	}

	private getMultiDiffRefs(): { repoPath: string; lhs: string; rhs: string; title?: string } | undefined {
		const commit = this.commit;
		if (!commit) return undefined;

		return {
			repoPath: commit.repoPath,
			lhs: commit.parents[0] ?? '',
			rhs: commit.sha,
			title: `Changes in ${commit.shortSha}`,
		};
	}

	private renderEmbeddedAuthorHeader() {
		const commit = this.commit;
		if (!commit) return nothing;

		const authorName = formatIdentityDisplayName(commit.author, this.preferences?.currentUserNameStyle ?? 'you');
		const authorTemplate = html`<gl-commit-author
			class="author-header__author"
			layout="stacked"
			.avatarUrl="${commit.author.avatar ?? ''}"
			.committerEmail="${commit.committer.email}"
			.committerAvatarUrl="${commit.committer.avatar}"
			.committerName="${commit.committer.name}"
			email="${commit.author.email}"
			name="${authorName}"
			author-name="${commit.author.name}"
			.authorDate="${commit.author.date}"
			.committerDate="${commit.committer.date}"
			.dateFormat="${this.preferences?.dateFormat}"
			.dateStyle="${this.preferences?.dateStyle ?? 'relative'}"
			.showAvatar="${this.preferences?.avatars ?? true}"
			.showSignature="${this.preferences?.showSignatureBadges ?? true}"
			.signature="${this.signature}"
		></gl-commit-author>`;

		if (!this.panelActions) {
			return html`<div class="author-header">${authorTemplate}</div>`;
		}

		const { isStash } = this;

		return html`<gl-details-header
			.activeMode=${this.activeMode}
			.loading=${this.loading}
			.modes=${this.computeCommitModes()}
			style="--mode-header-bg: var(--titlebar-bg, var(--vscode-sideBar-background, var(--color-background)))"
		>
			${authorTemplate}
			${when(
				!isStash && this.hasRemotes && this.activeMode == null,
				() =>
					html`<gl-action-chip
						slot="actions"
						icon="globe"
						label="Open Commit on Remote"
						overlay="tooltip"
						@click=${() =>
							this.dispatchEvent(
								new CustomEvent('open-on-remote', {
									detail: { sha: commit.sha },
									bubbles: true,
									composed: true,
								}),
							)}
					></gl-action-chip>`,
			)}
		</gl-details-header>`;
	}

	private computeCommitModes(): ('review' | 'compose' | 'compare')[] {
		const modes: ('review' | 'compose' | 'compare')[] = [];
		if (this.aiEnabled) {
			modes.push('review');
		}
		// Compare mode requires the host (graph orchestrator) to wire in a compare-refs panel
		// for the @toggle-mode event. Stashes have no useful default ref to compare against.
		if (this.compareEnabled && this.commit?.stashNumber == null) {
			modes.push('compare');
		}
		return modes;
	}

	private renderEmbeddedMetadataBar() {
		const commit = this.commit;
		if (!commit) return nothing;

		const { isStash } = this;

		return html`<div class="metadata-bar">
				<div class="metadata-bar__left">
					<gl-commit-sha-copy
						class="metadata-bar__sha"
						appearance="toolbar"
						tooltip-placement="bottom"
						copy-label="${isStash ? 'Copy Stash Number' : 'Copy SHA'}"
						copied-label="Copied!"
						.sha=${isStash ? `#${commit.stashNumber}` : commit.sha}
						.icon=${isStash ? 'gl-stashes-view' : 'git-commit'}
					></gl-commit-sha-copy>
					${isStash
						? this.branchName
							? html`<gl-tooltip hoist content="Stashed on ${this.branchName}">
									<span class="metadata-bar__branch-indicator">
										<gl-branch-name
											class="metadata-bar__branch"
											.name=${this.branchName}
										></gl-branch-name>
									</span>
								</gl-tooltip>`
							: nothing
						: !this.isUncommitted
							? this.renderBranchIndicator()
							: nothing}
				</div>
				<div class="metadata-bar__right">${this.renderCommitStats(commit.stats)}</div>
			</div>
			${this._reachabilityExpanded ? html`<div class="reachability">${this.renderReachability()}</div>` : nothing}`;
	}

	private renderBranchIndicator() {
		const state = this.reachabilityState;
		const refs = this.reachability?.refs;
		const extraCount = refs?.length ? refs.length - (this.branchName ? 1 : 0) : 0;

		// Loading
		if (state === 'loading') {
			return html`<button class="metadata-bar__branch-indicator" disabled aria-label="Loading branches and tags">
				<code-icon icon="git-branch"></code-icon>
				<code-icon icon="loading" modifier="spin" class="metadata-bar__branch-status"></code-icon>
			</button>`;
		}

		// Error
		if (state === 'error') {
			return html`<gl-tooltip hoist content="Unable to load branch reachability. Click to Retry">
				<button
					class="metadata-bar__branch-indicator metadata-bar__branch-indicator--error"
					@click=${() => this.dispatchEvent(new CustomEvent('refresh-reachability'))}
				>
					<code-icon icon="git-branch"></code-icon>
					<code-icon icon="error" class="metadata-bar__branch-status"></code-icon>
				</button>
			</gl-tooltip>`;
		}

		// Loaded, no refs — unreachable commit
		if (state === 'loaded' && refs?.length === 0) {
			return html`<gl-tooltip hoist content="This commit is not reachable from any branch or tag">
				<span class="metadata-bar__branch-unreachable">
					<code-icon icon="git-branch"></code-icon> Unreachable
				</span>
			</gl-tooltip>`;
		}

		// Loaded with refs — show branch name + count
		if (this.branchName) {
			return html`<gl-tooltip
				hoist
				content="${this._reachabilityExpanded
					? 'Hide All Branches & Tags Containing this Commit'
					: 'Show All Branches & Tags Containing this Commit'}"
			>
				<button
					class="metadata-bar__branch-indicator"
					aria-expanded="${this._reachabilityExpanded}"
					@click=${this.onToggleReachability}
				>
					<gl-branch-name class="metadata-bar__branch" .name=${this.branchName}></gl-branch-name>
					${extraCount > 0 ? html`<span class="metadata-bar__ref-count">+${extraCount}</span>` : nothing}
				</button>
			</gl-tooltip>`;
		}

		// Idle / no data — click to load
		return html`<gl-tooltip hoist content="Show All Branches &amp; Tags Containing this Commit">
			<button
				class="metadata-bar__branch-indicator metadata-bar__branch-indicator--idle"
				aria-label="Show all branches and tags"
				@click=${this.onBranchIndicatorClick}
			>
				<code-icon icon="git-branch"></code-icon>
				<code-icon icon="ellipsis" class="metadata-bar__branch-status"></code-icon>
			</button>
		</gl-tooltip>`;
	}

	private onBranchIndicatorClick() {
		if (this.reachabilityState === 'idle' && !this.reachability) {
			this.dispatchEvent(new CustomEvent('load-reachability'));
		} else {
			this.onToggleReachability();
		}
	}

	private renderEmbeddedMessage() {
		const commit = this.commit;
		if (!commit) return nothing;

		const message = this.formattedMessage ?? commit.message;
		const index = message.indexOf(messageHeadlineSplitterToken);

		return html`<div class="message">
			<div class="message-block">
				${when(
					index === -1,
					() =>
						html`<div class="message-block__text scrollable" data-region="message">
							<gl-copy-container
								class="message-block__copy"
								.content=${commit.message.replaceAll(messageHeadlineSplitterToken, '\n')}
								copyLabel="Copy Message"
								copiedLabel="Copied!"
								placement="bottom"
							>
								<code-icon icon="copy"></code-icon>
							</gl-copy-container>
							<strong><gl-markdown .markdown=${message} density="compact"></gl-markdown></strong>
						</div>`,
					() =>
						html`<div class="message-block__text scrollable" data-region="message">
							<gl-copy-container
								class="message-block__copy"
								.content=${commit.message.replaceAll(messageHeadlineSplitterToken, '\n')}
								copyLabel="Copy Message"
								copiedLabel="Copied!"
								placement="bottom"
							>
								<code-icon icon="copy"></code-icon>
							</gl-copy-container>
							<strong
								><gl-markdown .markdown=${message.substring(0, index)} density="compact"></gl-markdown
							></strong>
							<gl-markdown .markdown=${message.substring(index + 3)} density="compact"></gl-markdown>
						</div>`,
				)}
			</div>
		</div>`;
	}

	private renderEmbeddedAutolinks() {
		return html`<div class="autolinks">${this.renderAutoLinksChips()}</div>`;
	}

	private renderEmbeddedExplainInput() {
		if (this.orgSettings?.ai === false) return nothing;

		return html`<gl-ai-input
			multiline
			.busy=${this.explainBusy}
			@gl-explain=${this.onExplainChanges}
		></gl-ai-input>`;
	}

	private onToggleReachability() {
		// Only allow expansion when there are refs to show
		if (!this._reachabilityExpanded && !this.reachability?.refs?.length) return;
		this._reachabilityExpanded = !this._reachabilityExpanded;
	}

	private renderHiddenNotice() {
		if (!this.searchContext?.hiddenFromGraph) return nothing;

		return html`
			<div class="section">
				<div class="alert alert--warning">
					<code-icon icon="warning"></code-icon>
					<p class="alert__content">
						This ${this.isStash ? 'stash' : 'commit'} is not currently visible in the Commit Graph.
					</p>
				</div>
			</div>
		`;
	}

	private renderEmptyContent() {
		return html`
			<div class="section section--empty" id="empty">
				<p>Rich details for commits and stashes are shown as you navigate:</p>

				<ul class="bulleted">
					<li>lines in the text editor</li>
					<li>
						commits in the <a href="command:gitlens.showGraph">Commit Graph</a>,
						<a href="command:gitlens.showTimelineView">Visual File History</a>, or
						<a href="command:gitlens.showCommitsView">Commits view</a>
					</li>
					<li>stashes in the <a href="command:gitlens.showStashesView">Stashes view</a></li>
				</ul>

				<p>Alternatively, show your work-in-progress, or search for or choose a commit</p>

				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full data-action="wip">Overview</gl-button>
					</span>
				</p>
				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full data-action="pick-commit">Choose Commit...</gl-button>
						<gl-button density="compact" data-action="search-commit" tooltip="Search for Commit"
							><code-icon icon="search"></code-icon
						></gl-button>
					</span>
				</p>
			</div>
		`;
	}

	private get autolinkState() {
		if (!this.autolinksEnabled || this.isUncommitted) return undefined;

		const deduped = new Map<
			string,
			| { type: 'autolink'; value: Autolink }
			| { type: 'issue'; value: IssueOrPullRequest }
			| { type: 'pr'; value: PullRequestShape }
		>();

		const autolinkIdsByUrl = new Map<string, string>();

		if (this.autolinks != null) {
			for (const autolink of this.autolinks) {
				deduped.set(autolink.id, { type: 'autolink', value: autolink });
				autolinkIdsByUrl.set(autolink.url, autolink.id);
			}
		}

		// Enriched autolinks (resolved issues) override basic autolinks by URL
		const enrichedAutolinks = this.autolinkedIssues;
		if (enrichedAutolinks != null) {
			for (const issue of enrichedAutolinks) {
				if (issue.url != null) {
					const autoLinkId = autolinkIdsByUrl.get(issue.url);
					if (autoLinkId != null) {
						deduped.delete(autoLinkId);
					}
				}
				deduped.set(issue.id, { type: 'issue', value: issue });
			}
		}

		const pullRequest = this.pullRequest;
		if (pullRequest != null) {
			if (pullRequest.url != null) {
				const autoLinkId = autolinkIdsByUrl.get(pullRequest.url);
				if (autoLinkId != null) {
					deduped.delete(autoLinkId);
				}
			}
			deduped.set(pullRequest.id, { type: 'pr', value: pullRequest });
		}

		const autolinks: Autolink[] = [];
		const issues: IssueOrPullRequest[] = [];
		const prs: PullRequestShape[] = [];

		for (const item of deduped.values()) {
			switch (item.type) {
				case 'autolink':
					autolinks.push(item.value);
					break;
				case 'issue':
					issues.push(item.value);
					break;
				case 'pr':
					prs.push(item.value);
					break;
			}
		}
		return {
			autolinks: autolinks,
			issues: issues,
			prs: prs,
			size: deduped.size,
		};
	}

	private renderAutoLinksChips() {
		const autolinkState = this.autolinkState;
		if (autolinkState == null) return this.renderLearnAboutAutolinks(true);

		const { autolinks, issues, prs, size } = autolinkState;

		if (size === 0) {
			return this.renderLearnAboutAutolinks(true);
		}

		return html`<gl-chip-overflow max-rows="1">
			${when(autolinks.length, () =>
				autolinks.map(autolink => {
					let name = autolink.description ?? autolink.title;
					if (name === undefined) {
						name = `Custom Autolink ${autolink.prefix}${autolink.id}`;
					}
					return html`<gl-autolink-chip
						type="autolink"
						name="${name}"
						url="${autolink.url}"
						identifier="${autolink.prefix}${autolink.id}"
					></gl-autolink-chip>`;
				}),
			)}
			${when(prs.length, () =>
				prs.map(
					pr =>
						html`<gl-autolink-chip
							type="pr"
							name="${pr.title}"
							url="${pr.url}"
							identifier="#${pr.id}"
							status="${pr.state}"
							.date=${pr.updatedDate}
							.dateFormat="${this.preferences?.dateFormat}"
							.dateStyle="${this.preferences?.dateStyle}"
							.author=${pr.author?.name}
							?isDraft=${pr.isDraft}
							.reviewDecision=${pr.reviewDecision}
						></gl-autolink-chip>`,
				),
			)}
			${when(issues.length, () =>
				issues.map(
					issue =>
						html`<gl-autolink-chip
							type="issue"
							name="${issue.title}"
							url="${issue.url}"
							identifier="#${issue.id}"
							status="${issue.state}"
							.date=${issue.closed ? issue.closedDate : issue.createdDate}
							.dateFormat="${this.preferences?.dateFormat}"
							.dateStyle="${this.preferences?.dateStyle}"
						></gl-autolink-chip>`,
				),
			)}
			${this.renderAutoLinksPopover(autolinks, prs, issues)}
			<span slot="suffix">${this.renderLearnAboutAutolinks()}</span>
		</gl-chip-overflow>`;
	}

	private renderAutoLinksPopover(autolinks: Autolink[], prs: PullRequestShape[], issues: IssueOrPullRequest[]) {
		if (autolinks.length === 0 && prs.length === 0 && issues.length === 0) return nothing;

		return html`<div slot="popover">
			${prs.length > 0
				? html`<menu-label>Pull Requests</menu-label> ${prs.map(
							pr =>
								html`<menu-item href=${pr.url}>
									<code-icon icon="git-pull-request"></code-icon> #${pr.id}${pr.title
										? ` — ${pr.title}`
										: ''}
								</menu-item>`,
						)}`
				: nothing}
			${issues.length > 0
				? html`${prs.length > 0 ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Issues</menu-label>
						${issues.map(
							issue =>
								html`<menu-item href=${issue.url}>
									<code-icon icon="issues"></code-icon> #${issue.id}${issue.title
										? ` — ${issue.title}`
										: ''}
								</menu-item>`,
						)}`
				: nothing}
			${autolinks.length > 0
				? html`${prs.length > 0 || issues.length > 0 ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Autolinks</menu-label>
						${autolinks.map(
							a =>
								html`<menu-item href=${a.url}>
									<code-icon icon="link"></code-icon> ${a.prefix}${a.id}${a.title
										? ` — ${a.title}`
										: ''}
								</menu-item>`,
						)}`
				: nothing}
		</div>`;
	}

	private renderReachability() {
		if (!this.reachability?.refs?.length) return nothing;

		const { refs } = this.reachability;
		const branches = refs.filter(r => r.refType === 'branch');
		const tags = refs.filter(r => r.refType === 'tag');

		return html`<div class="reachability-summary">
				${this.renderReachabilityChip('branch', branches)} ${this.renderReachabilityChip('tag', tags)}
			</div>
			${this.reachability.partial
				? html`<gl-tooltip hoist content="Load All Branches &amp; Tags">
						<button
							class="reachability__load-all"
							aria-label="Load all branches and tags"
							@click=${() => this.dispatchEvent(new CustomEvent('load-reachability'))}
						>
							<code-icon icon="sync"></code-icon></button
					></gl-tooltip>`
				: nothing}`;
	}

	private renderReachabilityChip(type: 'branch' | 'tag', refs: NonNullable<typeof this.reachability>['refs']) {
		if (!refs.length) return nothing;

		const icon = type === 'branch' ? 'git-branch' : 'tag';
		const count = refs.length;
		const [first] = refs;

		// Single ref - just show it
		if (count === 1) {
			const refTypeLabel = first.refType === 'branch' ? (first.remote ? 'remote branch' : 'branch') : 'tag';
			return html`<gl-action-chip
				icon="${icon}"
				label="Commit on 1 ${refTypeLabel}: ${first.name}"
				overlay="tooltip"
				class="reachability-range-chip reachability-range-chip--${first.refType === 'branch'
					? first.remote
						? 'remote-branch'
						: 'local-branch'
					: 'tag'}${first.current ? ' reachability-range-chip--current' : ''}"
				><span class="reachability-range-chip__label">${first.name}</span></gl-action-chip
			>`;
		}

		// Multiple refs - show range with popover
		const last = refs.at(-1)!;

		return html`<gl-popover placement="bottom" trigger="hover focus click" class="reachability-range-chip-wrapper">
			<gl-action-chip
				slot="anchor"
				class="reachability-range-chip reachability-range-chip--range reachability-range-chip--${type ===
				'branch'
					? 'local-branch'
					: 'tag'}"
				><span class="reachability-range-chip__label">
					<code-icon icon="${icon}"></code-icon>${first.name}
					<span class="reachability-range-chip__ellipsis">...</span>
					<code-icon icon="${icon}"></code-icon>${last.name}
				</span>
				<span class="reachability-range-chip__count">+${count}</span></gl-action-chip
			>
			<div slot="content" class="reachability-popover">
				<div class="reachability-popover__header">
					Commit is on ${count} ${type === 'branch' ? 'branches' : 'tags'}
				</div>
				<div class="reachability-popover__list scrollable">
					${refs.map(
						r =>
							html`<div
								class="reachability-list-item${r.current ? ' reachability-list-item--current' : ''}"
							>
								<code-icon
									icon="${type === 'branch' ? 'git-branch' : 'tag'}"
									class="reachability-list-item__icon"
								></code-icon>
								<span class="reachability-list-item__label">${r.name}</span>
							</div>`,
					)}
				</div>
			</div>
		</gl-popover>`;
	}

	private onExplainChanges(e: CustomEvent<{ prompt?: string }> | MouseEvent) {
		if (this.explainBusy) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		e.stopPropagation();
		this.explainBusy = true;

		const prompt = e instanceof CustomEvent ? e.detail?.prompt : undefined;

		this.dispatchEvent(
			new CustomEvent('explain-commit', { detail: { prompt: prompt }, bubbles: true, composed: true }),
		);
	}

	override getFileActions(file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		const actions = [
			{
				icon: 'go-to-file',
				label: 'Open File',
				action: 'file-open',
			},
		];

		if (this.isUncommitted) {
			return actions;
		}

		actions.push({
			icon: 'git-compare',
			label: 'Open Changes with Working File',
			action: 'file-compare-working',
		});

		if (!this.isStash && file.submodule == null) {
			actions.push({
				icon: 'globe',
				label: 'Open on Remote',
				action: 'file-open-on-remote',
			});
		}
		return actions;
	}

	override getFileContext(file: File): string | undefined {
		if (!this.commit) return undefined;

		// Build webviewItem with modifiers matching view context values
		// Pattern: gitlens:file+committed[+current][+HEAD][+unpublished][+submodule]
		const commit = this.commit;
		const isStash = commit.stashNumber != null;
		const submodule = file.submodule != null ? '+submodule' : '';

		let webviewItem: DetailsItemContext['webviewItem'];
		if (isStash) {
			webviewItem = `gitlens:file+stashed${submodule}`;
		} else {
			webviewItem = `gitlens:file+committed${submodule}`;
		}

		const context: DetailsItemTypedContext = {
			webviewItem: webviewItem,
			webviewItemValue: {
				type: 'file',
				path: file.path,
				repoPath: commit.repoPath,
				sha: commit.sha,
				stashNumber: commit.stashNumber,
				status: file.status,
			},
		};

		return serializeWebviewItemContext(context);
	}
}
