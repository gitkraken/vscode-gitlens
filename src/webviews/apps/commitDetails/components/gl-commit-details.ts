import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { Autolink } from '../../../../autolinks';
import type {
	ConnectCloudIntegrationsCommandArgs,
	ManageCloudIntegrationsCommandArgs,
} from '../../../../commands/cloudIntegrations';
import type { IssueIntegrationId, SupportedCloudIntegrationIds } from '../../../../constants.integrations';
import type { IssueOrPullRequest } from '../../../../git/models/issue';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import type { Serialized } from '../../../../system/vscode/serialize';
import type { State } from '../../../commitDetails/protocol';
import { messageHeadlineSplitterToken } from '../../../commitDetails/protocol';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base';
import { uncommittedSha } from './commit-details-app';
import type { File } from './gl-details-base';
import { GlDetailsBase } from './gl-details-base';
import '../../shared/components/actions/action-item';
import '../../shared/components/actions/action-nav';
import '../../shared/components/button';
import '../../shared/components/code-icon';
import '../../shared/components/commit/commit-identity';
import '../../shared/components/commit/commit-stats';
import '../../shared/components/markdown/markdown';
import '../../shared/components/overlays/popover';
import '../../shared/components/overlays/tooltip';
import '../../shared/components/rich/issue-pull-request';
import '../../shared/components/skeleton-loader';
import '../../shared/components/webview-pane';

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
	get isStash() {
		return this.state?.commit?.stashNumber != null;
	}

	@state()
	get shortSha() {
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

	override updated(changedProperties: Map<string, any>) {
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

	private renderCommitMessage() {
		const details = this.state?.commit;
		if (details == null) return undefined;

		const message = details.message;
		const index = message.indexOf(messageHeadlineSplitterToken);
		return html`
			<div class="section section--message">
				${when(
					!this.isStash,
					() => html`
						<commit-identity
							class="mb-1"
							name="${details.author.name}"
							url="${details.author.email ? `mailto:${details.author.email}` : undefined}"
							date=${details.author.date}
							.dateFormat="${this.preferences?.dateFormat}"
							.avatarUrl="${details.author.avatar ?? ''}"
							.showAvatar="${this.preferences?.avatars ?? true}"
							.actionLabel="${details.sha === uncommittedSha ? 'modified' : 'committed'}"
						></commit-identity>
					`,
				)}
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
			</div>
		`;
	}

	private renderJiraLink() {
		if (this.state == null) return 'Jira issues';

		const { hasAccount, hasConnectedJira } = this.state;

		let message = html`<a
				href="command:gitlens.plus.cloudIntegrations.connect?${encodeURIComponent(
					JSON.stringify({
						integrationIds: ['jira' as IssueIntegrationId.Jira] as SupportedCloudIntegrationIds[],
						source: 'inspect',
						detail: {
							action: 'connect',
							integration: 'jira',
						},
					} satisfies ConnectCloudIntegrationsCommandArgs),
				)}"
				>Connect to Jira Cloud</a
			>
			&mdash; ${hasAccount ? '' : 'sign up and '}get access to automatic rich Jira autolinks`;

		if (hasAccount && hasConnectedJira) {
			message = html`<i class="codicon codicon-check" style="vertical-align: text-bottom"></i> Jira connected
				&mdash; automatic rich Jira autolinks are enabled`;
		}

		return html`<gl-popover hoist class="inline-popover">
			<span class="tooltip-hint" slot="anchor"
				>Jira issues <code-icon icon="${hasConnectedJira ? 'check' : 'gl-unplug'}"></code-icon
			></span>
			<span slot="content">${message}</span>
		</gl-popover>`;
	}

	private renderAutoLinks() {
		if (this.isUncommitted) return undefined;

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
				deduped.set(issue.id, { type: 'issue', value: issue });
				if (issue.url != null) {
					const autoLinkId = autolinkIdsByUrl.get(issue.url);
					if (autoLinkId != null) {
						deduped.delete(autoLinkId);
					}
				}
			}
		}

		if (this.state?.pullRequest != null) {
			deduped.set(this.state.pullRequest.id, { type: 'pr', value: this.state.pullRequest });
			if (this.state.pullRequest.url != null) {
				const autoLinkId = autolinkIdsByUrl.get(this.state.pullRequest.url);
				if (autoLinkId != null) {
					deduped.delete(autoLinkId);
				}
			}
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

		const { hasAccount, hasConnectedJira } = this.state ?? {};
		const jiraIntegrationLink = hasConnectedJira
			? `command:gitlens.plus.cloudIntegrations.manage?${encodeURIComponent(
					JSON.stringify({
						source: 'inspect',
						detail: {
							action: 'connect',
							integration: 'jira',
						},
					} satisfies ManageCloudIntegrationsCommandArgs),
			  )}`
			: `command:gitlens.plus.cloudIntegrations.connect?${encodeURIComponent(
					JSON.stringify({
						integrationIds: ['jira' as IssueIntegrationId.Jira] as SupportedCloudIntegrationIds[],
						source: 'inspect',
						detail: {
							action: 'connect',
							integration: 'jira',
						},
					} satisfies ConnectCloudIntegrationsCommandArgs),
			  )}`;
		return html`
			<webview-pane
				collapsable
				?expanded=${this.state?.preferences?.autolinksExpanded ?? true}
				?loading=${!this.state?.includeRichContent}
				data-region="rich-pane"
			>
				<span slot="title">Autolinks</span>
				<span slot="subtitle" data-region="autolink-count"
					>${this.state?.includeRichContent || deduped.size ? `${deduped.size} found ` : ''}${this.state
						?.includeRichContent
						? ''
						: '…'}</span
				>
				<action-nav slot="actions">
					<action-item
						label="${hasAccount && hasConnectedJira ? 'Manage Jira' : 'Connect to Jira Cloud'}"
						icon="gl-provider-jira"
						href="${jiraIntegrationLink}"
					></action-item>
					<action-item
						data-action="autolinks-settings"
						label="Autolinks Settings"
						icon="gear"
						href="command:gitlens.showSettingsPage!autolinks"
					></action-item>
				</action-nav>
				${when(
					this.state == null,
					() => html`
						<div class="section" data-region="autolinks">
							<section class="auto-link" aria-label="Custom Autolinks" data-region="custom-autolinks">
								<skeleton-loader lines="2"></skeleton-loader>
							</section>
							<section class="pull-request" aria-label="Pull request" data-region="pull-request">
								<skeleton-loader lines="2"></skeleton-loader>
							</section>
							<section class="issue" aria-label="Issue" data-region="issue">
								<skeleton-loader lines="2"></skeleton-loader>
							</section>
						</div>
					`,
					() => {
						if (deduped.size === 0) {
							return html`
								<div class="section" data-region="rich-info">
									<p>
										<code-icon icon="info"></code-icon>&nbsp;Use
										<gl-tooltip hoist>
											<a
												href="command:gitlens.showSettingsPage!autolinks"
												data-action="autolink-settings"
												>autolinks</a
											>
											<span slot="content">Configure autolinks</span>
										</gl-tooltip>
										to linkify external references, like ${this.renderJiraLink()} or Zendesk
										tickets, in commit messages.
									</p>
								</div>
							`;
						}
						return html`
							<div class="section" data-region="autolinks">
								${autolinks.length
									? html`
											<section
												class="auto-link"
												aria-label="Custom Autolinks"
												data-region="custom-autolinks"
											>
												${autolinks.map(autolink => {
													let name = autolink.description ?? autolink.title;
													if (name === undefined) {
														name = `Custom Autolink ${autolink.prefix}${autolink.id}`;
													}
													return html`
														<issue-pull-request
															type="autolink"
															name="${name}"
															url="${autolink.url}"
															identifier="${autolink.prefix}${autolink.id}"
															status=""
														></issue-pull-request>
													`;
												})}
											</section>
									  `
									: undefined}
								${prs.length
									? html`
											<section
												class="pull-request"
												aria-label="Pull request"
												data-region="pull-request"
											>
												${prs.map(
													pr => html`
														<issue-pull-request
																type="pr"
																name="${pr.title}"
																url="${pr.url}"
																identifier="#${pr.id}"
																status="${pr.state}"
																.date=${pr.updatedDate}
																.dateFormat="${this.state!.preferences.dateFormat}"
																.dateStyle="${this.state!.preferences.dateStyle}"
															></issue-pull-request>
														</section>
									  				`,
												)}
											</section>
									  `
									: undefined}
								${issues.length
									? html`
											<section class="issue" aria-label="Issue" data-region="issue">
												${issues.map(
													issue => html`
														<issue-pull-request
															type="issue"
															name="${issue.title}"
															url="${issue.url}"
															identifier="${issue.id}"
															status="${issue.state}"
															.date=${issue.closed ? issue.closedDate : issue.createdDate}
															.dateFormat="${this.state!.preferences.dateFormat}"
															.dateStyle="${this.state!.preferences.dateStyle}"
														></issue-pull-request>
													`,
												)}
											</section>
									  `
									: undefined}
							</div>
						`;
					},
				)}
			</webview-pane>
		`;
	}

	private renderExplainAi() {
		if (this.state?.orgSettings.ai === false) return undefined;

		const markdown =
			this.explain?.result != null ? `${this.explain.result.summary}\n\n${this.explain.result.body}` : undefined;

		// TODO: add loading and response states
		return html`
			<webview-pane collapsable data-region="explain-pane">
				<span slot="title">Explain (AI)</span>
				<span slot="subtitle"><code-icon icon="beaker" size="12"></code-icon></span>
				<action-nav slot="actions">
					<action-item data-action="switch-ai" label="Switch AI Model" icon="hubot"></action-item>
				</action-nav>

				<div class="section">
					<p>Let AI assist in understanding the changes made with this commit.</p>
					<p class="button-container">
						<span class="button-group button-group--single">
							<gl-button
								full
								class="button--busy"
								data-action="explain-commit"
								aria-busy="${this.explainBusy ? 'true' : nothing}"
								@click=${this.onExplainChanges}
								@keydown=${this.onExplainChanges}
								><code-icon icon="loading" modifier="spin" slot="prefix"></code-icon>Explain
								Changes</gl-button
							>
						</span>
					</p>
					${markdown
						? html`<div class="ai-content" data-region="commit-explanation">
								<gl-markdown
									class="ai-content__summary scrollable"
									markdown="${markdown}"
								></gl-markdown>
						  </div>`
						: this.explain?.error
						  ? html`<div class="ai-content has-error" data-region="commit-explanation">
									<p class="ai-content__summary scrollable">
										${this.explain.error.message ?? 'Error retrieving content'}
									</p>
						    </div>`
						  : undefined}
				</div>
			</webview-pane>
		`;
	}

	override render() {
		if (this.state?.commit == null) {
			return this.renderEmptyContent();
		}

		return html`
			${this.renderCommitMessage()}
			<webview-pane-group flexible>
				${this.renderAutoLinks()}
				${this.renderChangedFiles(
					this.isStash ? 'stash' : 'commit',
					this.renderCommitStats(this.state.commit.stats),
				)}
				${this.renderExplainAi()}
			</webview-pane-group>
		`;
	}

	onExplainChanges(e: MouseEvent | KeyboardEvent) {
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
