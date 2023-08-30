import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import { ViewFilesLayout } from '../../../../../config';
import type { State } from '../../../../../plus/webviews/patchDetails/protocol';
import { messageHeadlineSplitterToken } from '../../../../../plus/webviews/patchDetails/protocol';
import type { HierarchicalItem } from '../../../../../system/array';
import { makeHierarchical } from '../../../../../system/array';
import type { Serialized } from '../../../../../system/serialize';
import { uncommittedSha } from '../patchDetails';

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	summary?: string;
}

@customElement('gl-patch-details-app')
export class GlPatchDetailsApp extends LitElement {
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
		return html`<list-container>
			${this.state!.selected!.files!.map(
				(file: Record<string, any>) => html`
					<file-change-list-item
						?stash=${this.isStash}
						?uncommitted=${this.isUncommitted}
						path="${file.path}"
						repo="${file.repoPath}"
						icon="${file.icon.dark}"
						status="${file.status}"
					></file-change-list-item>
				`,
			)}
		</list-container>`;
	}

	private renderFileTree() {
		const tree = makeHierarchical(
			this.state!.selected!.files!,
			n => n.path.split('/'),
			(...parts: string[]) => parts.join('/'),
			this.state!.preferences?.files?.compact ?? true,
		);
		const flatTree = flattenHeirarchy(tree);
		return html`<list-container class="indentGuides-${this.state!.indentGuides}">
			<list-item level="1" tree branch>
				<code-icon slot="icon" icon="repo" title="Repository" aria-label="Repository"></code-icon>
				gitkraken/shared-web-components
				<span slot="actions">
					<a class="change-list__action" href="#" title="Apply..." aria-label="Apply..."
						><code-icon icon="cloud-download"></code-icon
					></a>
					<a class="change-list__action" href="#" title="Change Base" aria-label="Change Base"
						><code-icon icon="git-commit"></code-icon
					></a>
					<a
						class="change-list__action"
						href="#"
						title="Open in Commit Graph"
						aria-label="Open in Commit Graph"
						><code-icon icon="gl-graph"></code-icon
					></a>
					<a class="change-list__action" href="#" title="More options..." aria-label="More options..."
						><code-icon icon="ellipsis"></code-icon
					></a>
				</span>
			</list-item>
			${flatTree.map(({ level, item }) => {
				if (item.name === '') {
					return undefined;
				}

				if (item.value == null) {
					return html`
						<list-item level="${level + 1}" tree branch>
							<code-icon slot="icon" icon="folder" title="Directory" aria-label="Directory"></code-icon>
							${item.name}
						</list-item>
					`;
				}

				return html`
					<file-change-list-item
						tree
						level="${level + 1}"
						?stash=${this.isStash}
						?uncommitted=${this.isUncommitted}
						path="${item.value.path}"
						repo="${item.value.repoPath}"
						icon="${item.value.icon.dark}"
						status="${item.value.status}"
					></file-change-list-item>
				`;
			})}
		</list-container>`;
	}

	private renderChangedFiles() {
		const layout = this.state?.preferences?.files?.layout ?? ViewFilesLayout.Auto;

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		let isTree = false;
		if (this.state?.selected?.files != null) {
			if (layout === ViewFilesLayout.Auto) {
				isTree = this.state.selected.files.length > (this.state.preferences?.files?.threshold ?? 5);
			} else {
				isTree = layout === ViewFilesLayout.Tree;
			}

			switch (layout) {
				case ViewFilesLayout.Auto:
					value = 'list';
					icon = 'list-flat';
					label = 'View as List';
					break;
				case ViewFilesLayout.List:
					value = 'tree';
					icon = 'list-tree';
					label = 'View as Tree';
					break;
				case ViewFilesLayout.Tree:
					value = 'auto';
					icon = 'gl-list-auto';
					label = 'View as Auto';
					break;
			}
		}

		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Files changed </span>
				<span slot="subtitle" data-region="stats">${this.renderCommitStats()}</span>
				<action-nav slot="actions">
					<action-item data-switch-value="${value}" label="${label}" icon="${icon}"></action-item>
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

	renderPatches() {
		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Patches</span>

				<div class="h-spacing">
					<list-container>
						<list-item>
							<code-icon slot="icon" icon="repo" title="Repository" aria-label="Repository"></code-icon>
							axosoft/GitKraken
						</list-item>
						<list-item>
							<code-icon slot="icon" icon="repo" title="Repository" aria-label="Repository"></code-icon>
							gitkraken/shared-web-components
						</list-item>
						<list-item>
							<code-icon slot="icon" icon="repo" title="Repository" aria-label="Repository"></code-icon>
							gitkraken/vscode-gitlens
						</list-item>
					</list-container>
				</div>
			</webview-pane>
		`;
	}

	renderCollaborators() {
		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Collaborators</span>

				<div class="h-spacing">
					<list-container>
						<list-item>
							<code-icon
								slot="icon"
								icon="account"
								title="Collaborator"
								aria-label="Collaborator"
							></code-icon>
							justin.roberts@gitkraken.com
						</list-item>
						<list-item>
							<code-icon
								slot="icon"
								icon="account"
								title="Collaborator"
								aria-label="Collaborator"
							></code-icon>
							eamodio@gitkraken.com
						</list-item>
						<list-item>
							<code-icon
								slot="icon"
								icon="account"
								title="Collaborator"
								aria-label="Collaborator"
							></code-icon>
							keith.daulton@gitkraken.com
						</list-item>
					</list-container>
				</div>
			</webview-pane>
		`;
	}

	override render() {
		if (this.state?.selected == null) {
			return html` <div class="commit-detail-panel scrollable">${this.renderEmptyContent()}</div>`;
		}

		return html`
			<div class="commit-detail-panel scrollable">
				<main id="main" tabindex="-1">
					<div class="top-details">
						<div class="top-details__top-menu">
							<div class="top-details__actionbar">
								<div class="top-details__actionbar-group"></div>
								<div class="top-details__actionbar-group">
									<a class="commit-action" href="#">
										<code-icon icon="link"></code-icon>
										<span class="top-details__sha">Copy Link</span></a
									>
									<a class="commit-action" href="#">
										<code-icon icon="send"></code-icon>
										<span class="top-details__sha">Share</span></a
									>
									<a
										class="commit-action"
										href="#"
										aria-label="Show Patch Actions"
										title="Show Patch Actions"
										><code-icon icon="kebab-vertical"></code-icon
									></a>
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
					${this.renderCommitMessage()}${this.renderPatches()}${this.renderCollaborators()}${this.renderChangedFiles()}${this.renderExplainAi()}
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
