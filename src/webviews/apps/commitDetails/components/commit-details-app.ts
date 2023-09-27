import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { Autolink } from '../../../../annotations/autolinks';
import type { IssueOrPullRequest } from '../../../../git/models/issue';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import type { HierarchicalItem } from '../../../../system/array';
import { makeHierarchical } from '../../../../system/array';
import type { Serialized } from '../../../../system/serialize';
import type { State } from '../../../commitDetails/protocol';
import { messageHeadlineSplitterToken } from '../../../commitDetails/protocol';
import { uncommittedSha } from '../commitDetails';

type Files = NonNullable<NonNullable<State['selected']>['files']>;
type File = Files[0];

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	summary?: string;
}

@customElement('gl-commit-details-app')
export class GlCommitDetailsApp extends LitElement {
	@property({ type: Object })
	state?: Serialized<State>;

	@state()
	explainBusy = false;

	@property({ type: Object })
	explain?: ExplainState;

	get isUncommitted() {
		return this.state?.selected?.sha === uncommittedSha;
	}

	get isStash() {
		return this.state?.selected?.stashNumber != null;
	}

	get shortSha() {
		return this.state?.selected?.shortSha ?? '';
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

				<p>Alternatively, search for or choose a commit</p>

				<p class="button-container">
					<span class="button-group">
						<button class="button button--full" type="button" data-action="pick-commit">
							Choose Commit...
						</button>
						<button
							class="button"
							type="button"
							data-action="search-commit"
							aria-label="Search for Commit"
							title="Search for Commit"
						>
							<code-icon icon="search"></code-icon>
						</button>
					</span>
				</p>
			</div>
		`;
	}

	private renderCommitMessage() {
		if (this.state?.selected == null) {
			return undefined;
		}

		const message = this.state.selected.message;
		const index = message.indexOf(messageHeadlineSplitterToken);
		return html`
			<div class="section section--message">
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

	private renderAutoLinks() {
		if (this.isUncommitted) {
			return undefined;
		}

		const deduped = new Map<
			string,
			| { type: 'autolink'; value: Serialized<Autolink> }
			| { type: 'issue'; value: Serialized<IssueOrPullRequest> }
			| { type: 'pr'; value: Serialized<PullRequestShape> }
		>();

		if (this.state?.selected?.autolinks != null) {
			for (const autolink of this.state.selected.autolinks) {
				deduped.set(autolink.id, { type: 'autolink', value: autolink });
			}
		}

		if (this.state?.autolinkedIssues != null) {
			for (const issue of this.state.autolinkedIssues) {
				deduped.set(issue.id, { type: 'issue', value: issue });
			}
		}

		if (this.state?.pullRequest != null) {
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
										<a href="#" data-action="autolink-settings" title="Configure autolinks"
											>autolinks</a
										>
										to linkify external references, like Jira issues or Zendesk tickets, in commit
										messages.
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
															key="${autolink.prefix}${autolink.id}"
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
																key="#${pr.id}"
																status="${pr.state}"
																date=${pr.date}
																dateFormat="${this.state!.dateFormat}"
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
															key="${issue.id}"
															status="${issue.state}"
															date="${issue.closed ? issue.closedDate : issue.date}"
															dateFormat="${this.state!.dateFormat}"
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
						<span class="button-group">
							<button
								class="button button--full button--busy"
								type="button"
								data-action="explain-commit"
								aria-busy="${this.explainBusy ? 'true' : nothing}"
								@click=${this.onExplainChanges}
								@keydown=${this.onExplainChanges}
							>
								<code-icon icon="loading" modifier="spin"></code-icon>Explain this Commit
							</button>
						</span>
					</p>
					${when(
						this.explain,
						() => html`
							<div
								class="ai-content${this.explain?.error ? ' has-error' : ''}"
								data-region="commit-explanation"
							>
								${when(
									this.explain?.error,
									() =>
										html`<p class="ai-content__summary scrollable">
											${this.explain!.error!.message ?? 'Error retrieving content'}
										</p>`,
								)}
								${when(
									this.explain?.summary,
									() => html`<p class="ai-content__summary scrollable">${this.explain!.summary}</p>`,
								)}
							</div>
						`,
					)}
				</div>
			</webview-pane>
		`;
	}

	private renderCommitStats() {
		if (this.state?.selected?.stats?.changedFiles == null) {
			return undefined;
		}

		if (typeof this.state.selected.stats.changedFiles === 'number') {
			return html`<commit-stats
				added="?"
				modified="${this.state.selected.stats.changedFiles}"
				removed="?"
			></commit-stats>`;
		}

		const { added, deleted, changed } = this.state.selected.stats.changedFiles;
		return html`<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>`;
	}

	private renderFileList() {
		const files = this.state!.selected!.files!;

		let items;
		let classes;

		if (this.isUncommitted) {
			items = [];
			classes = `indentGuides-${this.state!.indentGuides}`;

			const staged = files.filter(f => f.staged);
			if (staged.length) {
				items.push(html`<list-item tree branch hide-icon>Staged Changes</list-item>`);

				for (const f of staged) {
					items.push(this.renderFile(f, 2, true));
				}
			}

			const unstaged = files.filter(f => !f.staged);
			if (unstaged.length) {
				items.push(html`<list-item tree branch hide-icon>Unstaged Changes</list-item>`);

				for (const f of unstaged) {
					items.push(this.renderFile(f, 2, true));
				}
			}
		} else {
			items = files.map(f => this.renderFile(f));
		}

		return html`<list-container class=${classes ?? nothing}>${items}</list-container>`;
	}

	private renderFileTree() {
		const files = this.state!.selected!.files!;
		const compact = this.state!.preferences?.files?.compact ?? true;

		let items;

		if (this.isUncommitted) {
			items = [];

			const staged = files.filter(f => f.staged);
			if (staged.length) {
				items.push(html`<list-item tree branch hide-icon>Staged Changes</list-item>`);
				items.push(...this.renderFileSubtree(staged, 1, compact));
			}

			const unstaged = files.filter(f => !f.staged);
			if (unstaged.length) {
				items.push(html`<list-item tree branch hide-icon>Unstaged Changes</list-item>`);
				items.push(...this.renderFileSubtree(unstaged, 1, compact));
			}
		} else {
			items = this.renderFileSubtree(files, 0, compact);
		}

		return html`<list-container class="indentGuides-${this.state!.indentGuides}">${items}</list-container>`;
	}

	private renderFileSubtree(files: Files, rootLevel: number, compact: boolean) {
		const tree = makeHierarchical(
			files,
			n => n.path.split('/'),
			(...parts: string[]) => parts.join('/'),
			compact,
		);
		const flatTree = flattenHeirarchy(tree);
		return flatTree.map(({ level, item }) => {
			if (item.name === '') return undefined;

			if (item.value == null) {
				return html`
					<list-item level="${rootLevel + level}" tree branch>
						<code-icon slot="icon" icon="folder" title="Directory" aria-label="Directory"></code-icon>
						${item.name}
					</list-item>
				`;
			}

			return this.renderFile(item.value, rootLevel + level, true);
		});
	}

	private renderFile(file: File, level: number = 1, tree: boolean = false): TemplateResult<1> {
		return html`
			<file-change-list-item
				?tree=${tree}
				level="${level}"
				?stash=${this.isStash}
				?uncommitted=${this.isUncommitted}
				icon="${file.icon.dark}"
				path="${file.path}"
				repo="${file.repoPath}"
				?staged=${file.staged}
				status="${file.status}"
			></file-change-list-item>
		`;
	}

	private renderChangedFiles() {
		const layout = this.state?.preferences?.files?.layout ?? 'auto';

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		let isTree = false;
		if (this.state?.selected?.files != null) {
			if (layout === 'auto') {
				isTree = this.state.selected.files.length > (this.state.preferences?.files?.threshold ?? 5);
			} else {
				isTree = layout === 'tree';
			}

			switch (layout) {
				case 'auto':
					value = 'list';
					icon = 'gl-list-auto';
					label = 'View as List';
					break;
				case 'list':
					value = 'tree';
					icon = 'list-flat';
					label = 'View as Tree';
					break;
				case 'tree':
					value = 'auto';
					icon = 'list-tree';
					label = 'View as Auto';
					break;
			}
		}

		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Files changed </span>
				<span slot="subtitle" data-region="stats">${this.renderCommitStats()}</span>
				<action-nav slot="actions">
					<action-item
						data-action="files-layout"
						data-files-layout="${value}"
						label="${label}"
						icon="${icon}"
					></action-item>
				</action-nav>

				<div class="change-list" data-region="files">
					${when(
						this.state?.selected?.files == null,
						() => html`
							<div class="section section--skeleton">
								<skeleton-loader></skeleton-loader>
							</div>
							<div class="section section--skeleton">
								<skeleton-loader></skeleton-loader>
							</div>
							<div class="section section--skeleton">
								<skeleton-loader></skeleton-loader>
							</div>
						`,
						() => (isTree ? this.renderFileTree() : this.renderFileList()),
					)}
				</div>
			</webview-pane>
		`;
	}

	override render() {
		if (this.state?.selected == null) {
			return html` <div class="commit-detail-panel scrollable">${this.renderEmptyContent()}</div>`;
		}

		const pinLabel = this.state.pinned
			? 'Unpin this Commit\nRestores Automatic Following'
			: 'Pin this Commit\nSuspends Automatic Following';
		return html`
			<div class="commit-detail-panel scrollable">
				<main id="main" tabindex="-1">
					<div class="top-details">
						<div class="top-details__top-menu">
							<div class="top-details__actionbar${this.state.pinned ? ' is-pinned' : ''}">
								<div class="top-details__actionbar-group">
									<a
										class="commit-action${this.state.pinned ? ' is-active' : ''}"
										href="#"
										data-action="pin"
										aria-label="${pinLabel}"
										title="${pinLabel}"
										><code-icon
											icon="${this.state.pinned ? 'gl-pinned-filled' : 'pin'}"
											data-region="commit-pin"
										></code-icon
									></a>
									<a
										class="commit-action${this.navigation.back ? '' : ' is-disabled'}"
										aria-disabled="${this.navigation.back ? nothing : 'true'}"
										href="#"
										data-action="back"
										aria-label="Back"
										title="Back"
										><code-icon icon="arrow-left" data-region="commit-back"></code-icon
									></a>
									${when(
										this.navigation.forward,
										() => html`
											<a
												class="commit-action"
												href="#"
												data-action="forward"
												aria-label="Forward"
												title="Forward"
												><code-icon icon="arrow-right" data-region="commit-forward"></code-icon
											></a>
										`,
									)}
									${when(
										this.state.navigationStack.hint,
										() => html`
											<a
												class="commit-action commit-action--emphasis-low"
												href="#"
												title="View this Commit"
												data-action="${this.state!.pinned ? 'forward' : 'back'}"
												><code-icon icon="git-commit"></code-icon
												><span data-region="commit-hint"
													>${this.state!.navigationStack.hint}</span
												></a
											>
										`,
									)}
								</div>
								<div class="top-details__actionbar-group">
									${when(
										!this.isUncommitted,
										() => html`
											<a
												class="commit-action"
												href="#"
												data-action="commit-actions"
												data-action-type="sha"
												aria-label="Copy SHA
	[⌥] Pick Commit..."
												title="Copy SHA
	[⌥] Pick Commit..."
											>
												<code-icon icon="git-commit"></code-icon>
												<span class="top-details__sha" data-region="shortsha"
													>${this.shortSha}</span
												></a
											>
										`,
										() => html`
											<a
												class="commit-action"
												href="#"
												data-action="commit-actions"
												data-action-type="scm"
												aria-label="Open SCM view"
												title="Open SCM view"
												><code-icon icon="source-control"></code-icon
											></a>
										`,
									)}
									<a
										class="commit-action"
										href="#"
										data-action="commit-actions"
										data-action-type="graph"
										aria-label="Open in Commit Graph"
										title="Open in Commit Graph"
										><code-icon icon="gl-graph"></code-icon
									></a>
									${when(
										!this.isUncommitted,
										() => html`
											<a
												class="commit-action"
												href="#"
												data-action="commit-actions"
												data-action-type="more"
												aria-label="Show Commit Actions"
												title="Show Commit Actions"
												><code-icon icon="kebab-vertical"></code-icon
											></a>
										`,
									)}
								</div>
							</div>
							${when(
								this.state.selected && this.state.selected.stashNumber == null,
								() => html`
									<ul class="top-details__authors" aria-label="Authors">
										<li class="top-details__author" data-region="author">
											<commit-identity
												name="${this.state!.selected!.author.name}"
												email="${this.state!.selected!.author.email}"
												date=${this.state!.selected!.author.date}
												dateFormat="${this.state!.dateFormat}"
												avatarUrl="${this.state!.selected!.author.avatar ?? ''}"
												showAvatar="${this.state!.preferences?.avatars ?? true}"
												actionLabel="${this.state!.selected!.sha === uncommittedSha
													? 'modified'
													: 'committed'}"
											></commit-identity>
										</li>
									</ul>
								`,
							)}
						</div>
					</div>
					${this.renderCommitMessage()} ${this.renderAutoLinks()} ${this.renderChangedFiles()}
					${this.renderExplainAi()}
				</main>
			</div>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}

	onExplainChanges(e: MouseEvent | KeyboardEvent) {
		if (this.explainBusy === true || (e instanceof KeyboardEvent && e.key !== 'Enter')) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		this.explainBusy = true;
	}
}

function flattenHeirarchy<T>(item: HierarchicalItem<T>, level = 0): { level: number; item: HierarchicalItem<T> }[] {
	const flattened: { level: number; item: HierarchicalItem<T> }[] = [];
	if (item == null) return flattened;

	flattened.push({ level: level, item: item });

	if (item.children != null) {
		const children = Array.from(item.children.values());
		children.sort((a, b) => {
			if (!a.value || !b.value) {
				return (a.value ? 1 : -1) - (b.value ? 1 : -1);
			}

			if (a.relativePath < b.relativePath) {
				return -1;
			}

			if (a.relativePath > b.relativePath) {
				return 1;
			}

			return 0;
		});

		children.forEach(child => {
			flattened.push(...flattenHeirarchy(child, level + 1));
		});
	}

	return flattened;
}
