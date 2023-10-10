import { defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { DraftDetails, State } from '../../../../../plus/webviews/patchDetails/protocol';
import { messageHeadlineSplitterToken } from '../../../../../plus/webviews/patchDetails/protocol';
import type { HierarchicalItem } from '../../../../../system/array';
import { makeHierarchical } from '../../../../../system/array';

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	summary?: string;
}

export interface ApplyPatchDetail {
	draft: DraftDetails;
	target?: 'current' | 'branch' | 'worktree';
	base?: string;
	// [key: string]: unknown;
}

export interface ChangePatchBaseDetail {
	draft: DraftDetails;
	// [key: string]: unknown;
}

export interface SelectPatchRepoDetail {
	draft: DraftDetails;
	repoPath?: string;
	// [key: string]: unknown;
}

export interface ShowPatchInGraphDetail {
	draft: DraftDetails;
	// [key: string]: unknown;
}

@customElement('gl-draft-details')
export class GlDraftDetails extends LitElement {
	@property({ type: Object })
	state!: State;

	@state()
	explainBusy = false;

	@property({ type: Object })
	explain?: ExplainState;

	constructor() {
		super();

		defineGkElement(Popover, Menu, MenuItem);
	}

	override updated(changedProperties: Map<string, any>) {
		if (changedProperties.has('explain')) {
			this.explainBusy = false;
			this.querySelector('[data-region="ai-explanation"]')?.scrollIntoView();
		}
	}

	private renderEmptyContent() {
		return html`
			<div class="section section--empty" id="empty">
				<button-container>
					<gl-button full href="command:gitlens.openPatch">Open Patch...</gl-button>
				</button-container>
			</div>
		`;
	}

	private renderPatchMessage() {
		if (this.state?.draft?.message == null) {
			return undefined;
		}

		// if (this.state.draft.message == null) {
		// 	return html`
		// 		<div class="section section--message">
		// 			<div class="message-block">
		// 				<p class="message-block__text scrollable" data-region="message">
		// 					<strong>Cloud</strong>
		// 				</p>
		// 			</div>
		// 		</div>
		// 	`;
		// }

		const message = this.state.draft.message ?? '';
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
					<p>Let AI assist in understanding the changes made with this patch.</p>
					<p class="button-container">
						<span class="button-group">
							<button
								class="button button--full button--busy"
								type="button"
								data-action="ai-explain"
								aria-busy="${this.explainBusy ? 'true' : nothing}"
								@click=${this.onExplainChanges}
								@keydown=${this.onExplainChanges}
							>
								<code-icon icon="loading" modifier="spin"></code-icon>Explain this Change
							</button>
						</span>
					</p>
					${when(
						this.explain,
						() => html`
							<div
								class="ai-content${this.explain?.error ? ' has-error' : ''}"
								data-region="ai-explanation"
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
		if (this.state?.draft?.stats?.changedFiles == null) {
			return undefined;
		}

		if (typeof this.state.draft.stats.changedFiles === 'number') {
			return html`<commit-stats
				added="?"
				modified="${this.state.draft.stats.changedFiles}"
				removed="?"
			></commit-stats>`;
		}

		const { added, deleted, changed } = this.state.draft.stats.changedFiles;
		return html`<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>`;
	}

	private renderFileList() {
		return html`<list-container>
			${this.state.draft!.files!.map(
				(file: Record<string, any>) => html`
					<file-change-list-item
						?stash=${false}
						?uncommitted=${false}
						path="${file.path}"
						repo="${file.repoPath}"
						status="${file.status}"
					></file-change-list-item>
				`,
			)}
		</list-container>`;
	}

	private renderFileTree() {
		const tree = makeHierarchical(
			this.state.draft!.files!,
			n => n.path.split('/'),
			(...parts: string[]) => parts.join('/'),
			this.state.preferences?.files?.compact ?? true,
		);
		const flatTree = flattenHeirarchy(tree);
		return html`<list-container class="indentGuides-${this.state.preferences?.indentGuides}">
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
						?stash=${false}
						?uncommitted=${false}
						path="${item.value.path}"
						repo="${item.value.repoPath}"
						status="${item.value.status}"
					></file-change-list-item>
				`;
			})}
		</list-container>`;
	}

	private renderChangedFiles() {
		const layout = this.state?.preferences?.files?.layout ?? 'auto';

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		let isTree = false;
		if (this.state?.draft?.files != null) {
			if (layout === 'auto') {
				isTree = this.state.draft.files.length > (this.state.preferences?.files?.threshold ?? 5);
			} else {
				isTree = layout === 'tree';
			}

			switch (layout) {
				case 'auto':
					value = 'list';
					icon = 'list-flat';
					label = 'View as List';
					break;
				case 'list':
					value = 'tree';
					icon = 'list-tree';
					label = 'View as Tree';
					break;
				case 'tree':
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
						this.state?.draft?.files == null,
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
		const path = this.state.draft?.repoPath;
		const repo = this.state.draft?.repoName;
		const base = this.state.draft?.baseRef;

		const getActions = () => {
			if (!repo) {
				return html`
					<a href="#" class="commit-action" data-action="select-patch-repo" @click=${this.onSelectPatchRepo}
						><code-icon icon="repo" title="Repository" aria-label="Repository"></code-icon
						><span class="top-details__sha">Select base repo</span></a
					>
					<a href="#" class="commit-action is-disabled"><code-icon icon="gl-graph"></code-icon></a>
				`;
			}

			if (!base) {
				return html`
					<a href="#" class="commit-action" data-action="select-patch-repo" @click=${this.onSelectPatchRepo}
						><code-icon icon="repo" title="Repository" aria-label="Repository"></code-icon
						><span class="top-details__sha">${repo}</span></a
					>
					<a href="#" class="commit-action" data-action="select-patch-base" @click=${this.onChangePatchBase}
						><code-icon icon="git-commit" title="Repository" aria-label="Repository"></code-icon
						><span class="top-details__sha">Select base</span></a
					>
					<a href="#" class="commit-action is-disabled"><code-icon icon="gl-graph"></code-icon></a>
				`;
			}

			return html`
				<a href="#" class="commit-action" data-action="select-patch-repo" @click=${this.onSelectPatchRepo}
					><code-icon icon="repo" title="Repository" aria-label="Repository"></code-icon
					><span class="top-details__sha">${repo}</span></a
				>
				<a href="#" class="commit-action" data-action="select-patch-base" @click=${this.onChangePatchBase}
					><code-icon icon="git-commit"></code-icon
					><span class="top-details__sha">${base?.substring(0, 7)}</span></a
				>
				<a href="#" class="commit-action" data-action="patch-base-in-graph" @click=${this.onShowInGraph}
					><code-icon icon="gl-graph"></code-icon
				></a>
			`;
		};

		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Patches</span>
				<div class="section">
					<div class="patch-base">${getActions()}</div>
				</div>
				${when(
					path != null && base != null,
					() => html`
						<div class="section section--sticky-actions">
							<p class="button-container">
								<span class="button-group button-group--single">
									<gl-button full @click=${this.onApplyPatch}>Apply Patch</gl-button>
									<gk-popover placement="bottom">
										<gl-button
											slot="trigger"
											density="compact"
											aria-label="Apply Patch Options..."
											title="Apply Patch Options..."
											><code-icon icon="chevron-down"></code-icon
										></gl-button>
										<gk-menu class="mine-menu" @select=${this.onSelectApplyOption}>
											<gk-menu-item data-value="branch">Apply to new branch</gk-menu-item>
											<gk-menu-item data-value="worktree">Apply to new worktree</gk-menu-item>
										</gk-menu>
									</gk-popover>
								</span>
							</p>
						</div>
					`,
					() => html`
						<div class="section section--sticky-actions">
							<p class="button-container">
								<span class="button-group button-group--single">
									<gl-button disabled full>Apply Patch</gl-button>
									<gl-button
										disabled
										density="compact"
										aria-label="Apply Patch Options..."
										title="Apply Patch Options..."
										><code-icon icon="chevron-down"></code-icon
									></gl-button>
								</span>
							</p>
						</div>
					`,
				)}
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
		if (this.state?.draft == null) {
			return html` <div class="commit-detail-panel scrollable">${this.renderEmptyContent()}</div>`;
		}

		return html`
			<div class="top-details">
				<div class="top-details__top-menu">
					<div class="top-details__actionbar">
						<div class="top-details__actionbar-group"></div>
						<div class="top-details__actionbar-group">
							${when(
								this.state?.draft?.type === 'cloud',
								() => html`
									<a class="commit-action" href="#" @click=${this.onCopyCloudLink}>
										<code-icon icon="link"></code-icon>
										<span class="top-details__sha">Copy Link</span></a
									>
								`,
								() => html`
									<a
										class="commit-action"
										href="#"
										aria-label="Share Patch"
										title="Share Patch"
										@click=${this.onShareLocalPatch}
										>Share</a
									>
								`,
							)}
							<a class="commit-action" href="#" aria-label="Show Patch Actions" title="Show Patch Actions"
								><code-icon icon="kebab-vertical"></code-icon
							></a>
						</div>
					</div>
					${when(
						this.state.draft?.type === 'cloud' && this.state.draft?.author != null,
						() => html`
							<ul class="top-details__authors" aria-label="Authors">
								<li class="top-details__author" data-region="author">
									<commit-identity
										name="${this.state.draft!.author!.name}"
										email="${this.state.draft!.author!.email}"
										date="${this.state.draft!.createdAt!}"
										dateFormat="${this.state.preferences.dateFormat}"
										avatarUrl="${this.state.draft!.author!.avatar ?? ''}"
										?showavatar=${this.state.preferences?.avatars ?? true}
									></commit-identity>
								</li>
							</ul>
						`,
					)}
				</div>
			</div>
			${this.renderPatchMessage()}${this.renderPatches()} ${this.renderChangedFiles()}${this.renderExplainAi()}
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

	onApplyPatch(e?: MouseEvent | KeyboardEvent, target: 'current' | 'branch' | 'worktree' = 'current') {
		const evt = new CustomEvent<ApplyPatchDetail>('apply-patch', {
			detail: {
				draft: this.state.draft!,
				target: target,
			},
		});
		this.dispatchEvent(evt);
	}

	onSelectApplyOption(e: CustomEvent<{ target: MenuItem }>) {
		const target = e.detail?.target;
		if (target?.dataset?.value != null) {
			this.onApplyPatch(undefined, target.dataset.value as 'current' | 'branch' | 'worktree');
		}
	}

	onChangePatchBase(_e: MouseEvent | KeyboardEvent) {
		const evt = new CustomEvent<ChangePatchBaseDetail>('change-patch-base', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
	}

	onSelectPatchRepo(_e: MouseEvent | KeyboardEvent) {
		const evt = new CustomEvent<SelectPatchRepoDetail>('select-patch-repo', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
	}

	onShowInGraph(_e: MouseEvent | KeyboardEvent) {
		const evt = new CustomEvent<ShowPatchInGraphDetail>('graph-show-patch', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
	}

	onCopyCloudLink() {
		const evt = new CustomEvent('copy-cloud-link', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
	}

	onShareLocalPatch() {
		const evt = new CustomEvent('share-local-patch', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
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

declare global {
	interface HTMLElementTagNameMap {
		'gl-patch-details': GlDraftDetails;
	}
}
