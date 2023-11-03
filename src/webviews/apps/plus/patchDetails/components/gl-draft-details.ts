import { defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { TextDocumentShowOptions } from 'vscode';
import type { GitFileChangeShape } from '../../../../../git/models/file';
import type { DraftDetails, FileActionParams, State } from '../../../../../plus/webviews/patchDetails/protocol';
import { makeHierarchical } from '../../../../../system/array';
import type {
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
} from '../../../shared/components/tree/base';
import { GlTreeBase } from './gl-tree-base';
import '../../../shared/components/tree/tree-generator';

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

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
export class GlDraftDetails extends GlTreeBase {
	@property({ type: Object })
	state!: State;

	@state()
	explainBusy = false;

	@property({ type: Object })
	explain?: ExplainState;

	get canSubmit() {
		return this.state.draft?.repoPath != null && this.state.draft?.baseRef != null;
	}

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
		if (this.state?.draft?.title == null) {
			return undefined;
		}

		const title = this.state.draft.title;
		const description = this.state.draft.type === 'cloud' ? this.state.draft.description : undefined;
		return html`
			<div class="section section--message">
				<div class="message-block">
					${when(
						description != null,
						() =>
							html`<p class="message-block__text scrollable" data-region="message">
								<strong>${unsafeHTML(title)}</strong>
							</p>`,
						() =>
							html`<p class="message-block__text scrollable" data-region="message">
								<strong>${unsafeHTML(title)}</strong><br /><span>${unsafeHTML(description)}</span>
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
								aria-busy="${ifDefined(this.explainBusy ? 'true' : undefined)}"
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
				.added=${undefined}
				modified="${this.state.draft.stats.changedFiles}"
				.removed=${undefined}
			></commit-stats>`;
		}

		const { added, deleted, changed } = this.state.draft.stats.changedFiles;
		return html`<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>`;
	}

	private renderChangedFiles() {
		const layout = this.state?.preferences?.files?.layout ?? 'auto';

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		if (this.state?.draft?.files != null) {
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
					<action-item data-switch-value="${value}" label="${label}" icon="${icon}"></action-item>
				</action-nav>

				<div class="change-list" data-region="files">
					${when(
						this.state?.draft?.files == null,
						() => this.renderLoading(),
						() => this.renderTreeView(this.treeModel, this.state?.preferences?.indentGuides),
					)}
				</div>
			</webview-pane>
		`;
	}

	get treeModel(): TreeModel[] {
		if (this.state?.draft == null) return [];

		const draft = this.state.draft;
		// const files = draft.files;

		const layout = this.state?.preferences?.files?.layout ?? 'auto';
		let isTree = false;
		if (this.state?.draft?.files != null) {
			if (layout === 'auto') {
				isTree = this.state.draft.files.length > (this.state.preferences?.files?.threshold ?? 5);
			} else {
				isTree = layout === 'tree';
			}
		}

		// checkable only for multi-repo
		const options = { checkable: false };
		const testModel = this.draftDetailsToTreeModel(draft, isTree, this.state.preferences?.files?.compact, options);
		console.log(testModel);

		return [testModel];
	}

	renderPatches() {
		// const path = this.state.draft?.repoPath;
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
					this.canSubmit,
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
										email="${ifDefined(this.state.draft!.author!.email)}"
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
			${this.renderPatchMessage()}${this.renderPatches()}${this.renderChangedFiles()}${this.renderExplainAi()}
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

	override onTreeItemActionClicked(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context || !e.detail.action) return;

		const action = e.detail.action;
		switch (action.action) {
			// repo actions
			case 'apply-patch':
				this.onApplyPatch();
				break;
			case 'change-patch-base':
				this.onChangePatchBase();
				break;
			case 'show-patch-in-graph':
				this.onShowInGraph();
				break;
			// file actions
			case 'file-open':
				this.onOpenFile(e);
				break;
			case 'file-compare-working':
				this.onCompareWorking(e);
				break;
		}
	}

	fireFileEvent(name: string, file: GitFileChangeShape, showOptions?: TextDocumentShowOptions) {
		const event = new CustomEvent(name, {
			detail: {
				path: file.path,
				repoPath: file.repoPath,
				staged: file.staged,
				showOptions: showOptions,
			},
		});
		this.dispatchEvent(event);
	}

	onCompareWorking(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		this.fireFileEvent('file-compare-working', file, {
			preview: false,
			viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
		});
	}

	onOpenFile(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		this.fireFileEvent('file-open', file, {
			preview: false,
			viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
		});
	}

	override onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>) {
		if (!e.detail.context) return;

		const [repoPath] = e.detail.context;
		const event = new CustomEvent('repo-checked', {
			detail: {
				path: repoPath,
			},
		});
		this.dispatchEvent(event);
	}

	override onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent<FileActionParams>('file-compare-previous', {
			detail: {
				path: file.path,
				repoPath: file.repoPath,
			},
		});
		this.dispatchEvent(event);
	}

	onApplyPatch(e?: MouseEvent | KeyboardEvent, target: 'current' | 'branch' | 'worktree' = 'current') {
		if (this.canSubmit === false) {
			return;
		}
		const evt = new CustomEvent<ApplyPatchDetail>('apply-patch', {
			detail: {
				draft: this.state.draft!,
				target: target,
			},
		});
		this.dispatchEvent(evt);
	}

	onSelectApplyOption(e: CustomEvent<{ target: MenuItem }>) {
		if (this.canSubmit === false) {
			return;
		}
		const target = e.detail?.target;
		if (target?.dataset?.value != null) {
			this.onApplyPatch(undefined, target.dataset.value as 'current' | 'branch' | 'worktree');
		}
	}

	onChangePatchBase(_e?: MouseEvent | KeyboardEvent) {
		const evt = new CustomEvent<ChangePatchBaseDetail>('change-patch-base', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
	}

	onSelectPatchRepo(_e?: MouseEvent | KeyboardEvent) {
		const evt = new CustomEvent<SelectPatchRepoDetail>('select-patch-repo', {
			detail: {
				draft: this.state.draft!,
			},
		});
		this.dispatchEvent(evt);
	}

	onShowInGraph(_e?: MouseEvent | KeyboardEvent) {
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

	draftDetailsToTreeModel(
		details: DraftDetails,
		isTree = false,
		compact = true,
		options?: Partial<TreeItemBase>,
	): TreeModel {
		const model = this.repoToTreeModel(details.repoName!, details.repoPath!, options);

		if (details.files == null) {
			return model;
		}

		const children = [];
		if (isTree) {
			const fileTree = makeHierarchical(
				details.files,
				n => n.path.split('/'),
				(...parts: string[]) => parts.join('/'),
				compact,
			);
			if (fileTree.children != null) {
				for (const child of fileTree.children.values()) {
					const childModel = this.walkFileTree(child, { level: 2 });
					children.push(childModel);
				}
			}
		} else {
			for (const file of details.files) {
				const child = this.fileToTreeModel(file, { level: 2, branch: false }, true);
				children.push(child);
			}
		}

		if (children.length > 0) {
			model.branch = true;
			model.children = children;
		}

		return model;
	}

	override getRepoActions(_name: string, _path: string, _options?: Partial<TreeItemBase>) {
		return [
			{
				icon: 'cloud-download',
				label: 'Apply...',
				action: 'apply-patch',
			},
			{
				icon: 'git-commit',
				label: 'Change Base',
				action: 'change-patch-base',
			},
			{
				icon: 'gl-graph',
				label: 'Open in Commit Graph',
				action: 'show-patch-in-graph',
			},
		];
	}

	override getFileActions(_file: GitFileChangeShape, _options?: Partial<TreeItemBase>) {
		return [
			{
				icon: 'go-to-file',
				label: 'Open file',
				action: 'file-open',
			},
			{
				icon: 'git-compare',
				label: 'Open Changes with Working File',
				action: 'file-compare-working',
			},
		];
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-patch-details': GlDraftDetails;
	}
}
