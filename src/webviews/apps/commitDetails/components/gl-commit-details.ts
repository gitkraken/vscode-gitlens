import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { Autolink } from '../../../../autolinks/models/autolinks';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations';
import type { GitCommitReachability } from '../../../../git/gitProvider';
import type { IssueOrPullRequest } from '../../../../git/models/issueOrPullRequest';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import { createCommandLink } from '../../../../system/commands';
import type { IpcSerialized } from '../../../../system/ipcSerialize';
import { serializeWebviewItemContext } from '../../../../system/webview';
import type { State as _State, DetailsItemContext, DetailsItemTypedContext } from '../../../commitDetails/protocol';
import { messageHeadlineSplitterToken } from '../../../commitDetails/protocol';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base';
import { uncommittedSha } from '../commitDetails';
import type { File } from './gl-details-base';
import { GlDetailsBase } from './gl-details-base';
import '../../shared/components/button';
import '../../shared/components/chips/action-chip';
import '../../shared/components/chips/autolink-chip';
import '../../shared/components/code-icon';
import '../../shared/components/commit/commit-author';
import '../../shared/components/commit/commit-date';
import '../../shared/components/commit/commit-stats';
import '../../shared/components/markdown/markdown';
import '../../shared/components/panes/pane-group';
import '../../shared/components/rich/issue-pull-request';

type State = IpcSerialized<_State>;
interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

@customElement('gl-commit-details')
export class GlCommitDetails extends GlDetailsBase {
	override readonly tab = 'commit';

	@property({ type: Object })
	state?: State;

	@state()
	get isStash(): boolean {
		return this.state?.commit?.stashNumber != null;
	}

	@state()
	get shortSha(): string {
		return this.state?.commit?.shortSha ?? '';
	}

	@state()
	explainBusy = false;

	@property({ type: Object })
	explain?: ExplainState;

	@property({ type: Object })
	reachability?: GitCommitReachability;

	@property({ type: String })
	reachabilityState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';

	private _commit: State['commit'];
	get commit(): State['commit'] {
		return this._commit;
	}
	set commit(value: State['commit']) {
		this._commit = value;
		this.enrichedPromise = value?.enriched;
	}

	@state()
	private _enriched!: Awaited<NonNullable<State['commit']>['enriched']>;
	get enriched(): Awaited<NonNullable<State['commit']>['enriched']> {
		return this._enriched;
	}

	private _enrichedPromise!: NonNullable<State['commit']>['enriched'];
	get enrichedPromise(): NonNullable<State['commit']>['enriched'] {
		return this._enrichedPromise;
	}
	set enrichedPromise(value: NonNullable<State['commit']>['enriched']) {
		if (this._enrichedPromise === value) return;

		this._enrichedPromise = value;
		void this._enrichedPromise?.then(
			r => (this._enriched = r),
			() => (this._enriched = undefined),
		);
	}

	get navigation() {
		if (this.state?.navigationStack == null) {
			return {
				back: false,
				forward: false,
			};
		}

		const actions = {
			back: true,
			forward: true,
		};

		if (this.state.navigationStack.count <= 1) {
			actions.back = false;
			actions.forward = false;
		} else if (this.state.navigationStack.position === 0) {
			actions.back = true;
			actions.forward = false;
		} else if (this.state.navigationStack.position === this.state.navigationStack.count - 1) {
			actions.back = false;
			actions.forward = true;
		}

		return actions;
	}

	override updated(changedProperties: Map<string, any>): void {
		if (changedProperties.has('explain')) {
			this.explainBusy = false;
			this.querySelector('[data-region="commit-explanation"]')?.scrollIntoView();
		}

		if (changedProperties.has('state')) {
			this.commit = this.state?.commit;
			// Reset reachability when commit changes (different commit sha)
			if (changedProperties.get('state')?.commit?.sha !== this.state?.commit?.sha) {
				this.reachabilityState = 'idle';
				this.reachability = undefined;
			}
		}
	}

	override render(): unknown {
		if (this.state?.commit == null) {
			return this.renderEmptyContent();
		}

		return html`
			${this.renderHiddenNotice()} ${this.renderCommitMessage()}
			<webview-pane-group flexible>
				${this.renderChangedFiles(
					this.isStash ? 'stash' : 'commit',
					this.renderCommitStats(this.state.commit.stats),
				)}
			</webview-pane-group>
		`;
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

	private renderExplainChanges() {
		if (this.state?.orgSettings.ai === false) return undefined;

		return html`
			<gl-action-chip
				label=${this.isUncommitted
					? 'Explain Working Changes'
					: `Explain Changes in this ${this.isStash ? 'Stash' : 'Commit'}`}
				icon="sparkle"
				data-action="explain-commit"
				aria-busy="${this.explainBusy ? 'true' : nothing}"
				?disabled="${this.explainBusy ? true : nothing}"
				@click=${this.onExplainChanges}
				@keydown=${this.onExplainChanges}
				><span>explain</span></gl-action-chip
			>
		`;
	}

	private renderCommitMessage() {
		const details = this.state?.commit;
		if (details == null) return undefined;

		// Use formatted message from promise if available, otherwise use basic message
		const message = this._enriched?.formattedMessage ?? details.message;
		const index = message.indexOf(messageHeadlineSplitterToken);
		return html`
			<div class="section section--message">
				<div class="message-block-row">
					${when(
						!this.isStash,
						() => html`
							<gl-commit-author
								name="${details.author.name}"
								url="${details.author.email ? `mailto:${details.author.email}` : undefined}"
								.avatarUrl="${details.author.avatar ?? ''}"
								.showAvatar="${this.preferences?.avatars ?? true}"
							></gl-commit-author>
						`,
					)}
					${this.renderExplainChanges()}
				</div>
				<div>
					<div class="message-block">
						${when(
							index === -1,
							() =>
								html`<p class="message-block__text scrollable" data-region="message">
									<strong>${unsafeHTML(message)}</strong>
								</p>`,
							() =>
								html`<p class="message-block__text scrollable" data-region="message">
									<strong>${unsafeHTML(message.substring(0, index))}</strong><br /><span
										>${unsafeHTML(message.substring(index + 3))}</span
									>
								</p>`,
						)}
					</div>
					<div class="message-block-row message-block-row--actions">
						${this.renderAutoLinksChips()}
						${when(
							!this.isStash,
							() => html`
								<gl-commit-date
									.date=${details.author.date}
									.dateFormat="${this.preferences?.dateFormat ?? 'absolute'}"
									.dateStyle="${this.preferences?.dateStyle ?? 'relative'}"
									.actionLabel="${details.sha === uncommittedSha ? 'Modified' : 'Committed'}"
								></gl-commit-date>
							`,
						)}
					</div>
					<div class="message-block-row message-block-row--actions">${this.renderReachability()}</div>
				</div>
			</div>
		`;
	}

	private get autolinkState() {
		if (!this.state?.autolinksEnabled || this.isUncommitted) return undefined;

		const deduped = new Map<
			string,
			| { type: 'autolink'; value: Autolink }
			| { type: 'issue'; value: IssueOrPullRequest }
			| { type: 'pr'; value: PullRequestShape }
		>();

		const autolinkIdsByUrl = new Map<string, string>();

		if (this.state?.commit?.autolinks != null) {
			for (const autolink of this.state.commit.autolinks) {
				deduped.set(autolink.id, { type: 'autolink', value: autolink });
				autolinkIdsByUrl.set(autolink.url, autolink.id);
			}
		}

		// Use resolved enriched autolinks from promise
		const enrichedAutolinks = this._enriched?.autolinkedIssues ?? this.state?.autolinkedIssues;
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

		// Use resolved pull request from promise
		const pullRequest = this._enriched?.associatedPullRequest ?? this.state?.pullRequest;
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

	private renderLearnAboutAutolinks(compact = false) {
		const chipLabel = compact ? nothing : html`<span class="mq-hide-sm">Learn about autolinks</span>`;

		const autolinkSettingsLink = createCommandLink('gitlens.showSettingsPage!autolinks', {
			showOptions: { preserveFocus: true },
		});

		const hasIntegrationsConnected = this.state?.hasIntegrationsConnected ?? false;
		let label =
			'Configure autolinks to linkify external references, like Jira or Zendesk tickets, in commit messages.';
		if (!hasIntegrationsConnected) {
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

			if (!this.state?.hasAccount) {
				label += ' sign up and';
			}

			label += ' to get access to automatic rich autolinks for services like Jira, GitHub, and more.';
		}

		return html`<gl-action-chip
			href=${autolinkSettingsLink}
			data-action="autolink-settings"
			icon="info"
			.label=${label}
			overlay=${hasIntegrationsConnected ? 'tooltip' : 'popover'}
			>${chipLabel}</gl-action-chip
		>`;
	}

	private renderAutoLinksChips() {
		const autolinkState = this.autolinkState;
		if (autolinkState == null) return this.renderLearnAboutAutolinks();

		const { autolinks, issues, prs, size } = autolinkState;

		if (size === 0) {
			return this.renderLearnAboutAutolinks();
		}

		return html`<div class="message-block-group">
			${this.renderLearnAboutAutolinks(true)}
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
							.dateFormat="${this.state!.preferences.dateFormat}"
							.dateStyle="${this.state!.preferences.dateStyle}"
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
							identifier="${issue.id}"
							status="${issue.state}"
							.date=${issue.closed ? issue.closedDate : issue.createdDate}
							.dateFormat="${this.state!.preferences.dateFormat}"
							.dateStyle="${this.state!.preferences.dateStyle}"
						></gl-autolink-chip>`,
				),
			)}
		</div>`;
	}

	private renderReachability() {
		if (this.isUncommitted) return nothing;

		if (this.reachabilityState === 'loading') {
			return html`<gl-action-chip icon="loading" label="Loading branches and tags which contain this commit"
				>Loading...</gl-action-chip
			>`;
		}

		if (this.reachabilityState === 'error') {
			return html`<gl-action-chip
				class="error"
				icon="error"
				label="Failed to load branches and tags. Click to retry."
				overlay="tooltip"
				@click=${() => this.dispatchEvent(new CustomEvent('refresh-reachability'))}
				><span class="mq-hide-sm">Failed to load</span></gl-action-chip
			>`;
		}

		if (this.reachabilityState === 'idle') {
			return html`<gl-action-chip
				icon="git-branch"
				label="Show which branches and tags contain this commit"
				overlay="tooltip"
				@click=${() => this.dispatchEvent(new CustomEvent('load-reachability'))}
				><span class="mq-hide-sm">Show Branches &amp; Tags</span></gl-action-chip
			>`;
		}

		if (this.reachability == null) return nothing;

		const { refs } = this.reachability;
		if (!refs.length) {
			return html`<gl-action-chip
				class="warning"
				icon="git-branch"
				label="Commit is not on any branch or tag"
				overlay="tooltip"
				><span class="mq-hide-sm">Not on any branch or tag</span></gl-action-chip
			>`;
		}

		const branches = refs.filter(r => r.refType === 'branch');
		const tags = refs.filter(r => r.refType === 'tag');

		return html`<div class="reachability-summary">
			${this.renderReachabilityChip('branch', branches)} ${this.renderReachabilityChip('tag', tags)}
		</div>`;
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
				>${first.name}</gl-action-chip
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

	private onExplainChanges(e: MouseEvent | KeyboardEvent) {
		if (this.explainBusy === true || (e instanceof KeyboardEvent && e.key !== 'Enter')) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		this.explainBusy = true;
	}

	private renderCommitStats(stats?: NonNullable<NonNullable<typeof this.state>['commit']>['stats']) {
		if (stats?.files == null) return undefined;

		if (typeof stats.files === 'number') {
			return html`<commit-stats modified="${stats.files}" symbol="icons" appearance="pill"></commit-stats>`;
		}

		const { added, deleted, changed } = stats.files;
		return html`<commit-stats
			added="${added}"
			modified="${changed}"
			removed="${deleted}"
			symbol="icons"
			appearance="pill"
		></commit-stats>`;
	}

	override getFileActions(_file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		const actions = [
			{
				icon: 'go-to-file',
				label: 'Open file',
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

		if (!this.isStash) {
			actions.push({
				icon: 'globe',
				label: 'Open on remote',
				action: 'file-open-on-remote',
			});
		}
		return actions;
	}

	override getFileContextData(file: File): string | undefined {
		if (!this.state?.commit) return undefined;

		// Build webviewItem with modifiers matching view context values
		// Pattern: gitlens:file+committed[+current][+HEAD][+unpublished]
		const commit = this.state.commit;
		const isStash = commit.stashNumber != null;

		let webviewItem: DetailsItemContext['webviewItem'];
		if (isStash) {
			webviewItem = 'gitlens:file+stashed';
		} else {
			webviewItem = 'gitlens:file+committed';
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
