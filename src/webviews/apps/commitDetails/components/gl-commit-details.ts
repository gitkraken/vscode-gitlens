import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { Autolink } from '../../../../autolinks/models/autolinks';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations';
import type { IssueOrPullRequest } from '../../../../git/models/issueOrPullRequest';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import { createCommandLink } from '../../../../system/commands';
import type { Serialized } from '../../../../system/serialize';
import type { State } from '../../../commitDetails/protocol';
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

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

@customElement('gl-commit-details')
export class GlCommitDetails extends GlDetailsBase {
	override readonly tab = 'commit';

	@property({ type: Object })
	state?: Serialized<State>;

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

		const message = details.message;
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
									date=${details.author.date}
									.dateFormat="${this.preferences?.dateFormat}"
									.dateStyle="${this.preferences?.dateStyle}"
									.actionLabel="${details.sha === uncommittedSha ? 'Modified' : 'Committed'}"
								></gl-commit-date>
							`,
						)}
					</div>
				</div>
			</div>
		`;
	}

	private get autolinkState() {
		if (!this.state?.autolinksEnabled || this.isUncommitted) return undefined;

		const deduped = new Map<
			string,
			| { type: 'autolink'; value: Serialized<Autolink> }
			| { type: 'issue'; value: Serialized<IssueOrPullRequest> }
			| { type: 'pr'; value: Serialized<PullRequestShape> }
		>();

		const autolinkIdsByUrl = new Map<string, string>();

		if (this.state?.commit?.autolinks != null) {
			for (const autolink of this.state.commit.autolinks) {
				deduped.set(autolink.id, { type: 'autolink', value: autolink });
				autolinkIdsByUrl.set(autolink.url, autolink.id);
			}
		}

		if (this.state?.autolinkedIssues != null) {
			for (const issue of this.state.autolinkedIssues) {
				if (issue.url != null) {
					const autoLinkId = autolinkIdsByUrl.get(issue.url);
					if (autoLinkId != null) {
						deduped.delete(autoLinkId);
					}
				}
				deduped.set(issue.id, { type: 'issue', value: issue });
			}
		}

		if (this.state?.pullRequest != null) {
			if (this.state.pullRequest.url != null) {
				const autoLinkId = autolinkIdsByUrl.get(this.state.pullRequest.url);
				if (autoLinkId != null) {
					deduped.delete(autoLinkId);
				}
			}
			deduped.set(this.state.pullRequest.id, { type: 'pr', value: this.state.pullRequest });
		}

		const autolinks: Serialized<Autolink>[] = [];
		const issues: Serialized<IssueOrPullRequest>[] = [];
		const prs: Serialized<PullRequestShape>[] = [];

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

	override render(): unknown {
		if (this.state?.commit == null) {
			return this.renderEmptyContent();
		}

		return html`
			${this.renderCommitMessage()}
			<webview-pane-group flexible>
				${this.renderChangedFiles(
					this.isStash ? 'stash' : 'commit',
					this.renderCommitStats(this.state.commit.stats),
				)}
			</webview-pane-group>
		`;
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
			return html`<commit-stats added="?" modified="${stats.files}" removed="?"></commit-stats>`;
		}

		const { added, deleted, changed } = stats.files;
		return html`<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>`;
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
		actions.push({
			icon: 'ellipsis',
			label: 'Show more actions',
			action: 'file-more-actions',
		});
		return actions;
	}
}
