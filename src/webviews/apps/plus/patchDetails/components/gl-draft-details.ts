import { Avatar, Button, defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { map } from 'lit/directives/map.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { when } from 'lit/directives/when.js';
import type { TextDocumentShowOptions } from 'vscode';
import type { DraftPatchFileChange, DraftRole, DraftVisibility } from '../../../../../gk/models/drafts';
import type {
	CloudDraftDetails,
	DraftDetails,
	DraftUserSelection,
	FileActionParams,
	PatchDetails,
	State,
} from '../../../../../plus/webviews/patchDetails/protocol';
import { makeHierarchical } from '../../../../../system/array';
import { flatCount } from '../../../../../system/iterable';
import type {
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
} from '../../../shared/components/tree/base';
import { GlTreeBase } from './gl-tree-base';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-nav';
import '../../../shared/components/button-container';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/commit/commit-identity';
import '../../../shared/components/tree/tree-generator';
import '../../../shared/components/webview-pane';

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
	selectedPatches?: string[];
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

export interface PatchCheckedDetail {
	patch: PatchDetails;
	checked: boolean;
}

export interface PatchDetailsUpdateSelectionEventDetail {
	selection: DraftUserSelection;
	role: Exclude<DraftRole, 'owner'> | 'remove';
}

@customElement('gl-draft-details')
export class GlDraftDetails extends GlTreeBase {
	@property({ type: Object })
	state!: State;

	@state()
	explainBusy = false;

	@property({ type: Object })
	explain?: ExplainState;

	@state()
	selectedPatches: string[] = [];

	@state()
	validityMessage?: string;

	@state()
	private _copiedLink: boolean = false;

	get canSubmit() {
		return this.selectedPatches.length > 0;
		// return this.state.draft?.repoPath != null && this.state.draft?.baseRef != null;
	}

	constructor() {
		super();

		defineGkElement(Avatar, Button, Popover, Menu, MenuItem);
	}

	override updated(changedProperties: Map<string, any>) {
		if (changedProperties.has('explain')) {
			this.explainBusy = false;
			this.querySelector('[data-region="ai-explanation"]')?.scrollIntoView();
		}

		if (changedProperties.has('state')) {
			const patches = this.state?.draft?.patches;
			if (!patches?.length) {
				this.selectedPatches = [];
			} else {
				this.selectedPatches = patches.map(p => p.id);
				for (const patch of patches) {
					const index = this.selectedPatches.indexOf(patch.id);
					if (patch.repository.located) {
						if (index === -1) {
							this.selectedPatches.push(patch.id);
						}
					} else if (index > -1) {
						this.selectedPatches.splice(index, 1);
					}
				}
			}
			// } else if (patches?.length === 1) {
			// 	this.selectedPatches = [patches[0].id];
			// } else {
			// 	this.selectedPatches = this.selectedPatches.filter(id => {
			// 		return patches.find(p => p.id === id) != null;
			// 	});
			// }
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
		if (this.state?.draft?.title == null) return undefined;
		let description = this.state.draft.draftType === 'cloud' ? this.state.draft.description : undefined;
		if (description == null) return undefined;

		description = description.trim();

		return html`
			<div class="message-block">
				<p class="message-block__text scrollable" data-region="message">
					<span>${unsafeHTML(description)}</span>
				</p>
			</div>
		`;
	}

	private renderExplainAi() {
		if (this.state?.orgSettings.ai === false) return undefined;

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
						<span class="button-group button-group--single">
							<gl-button
								full
								class="button--busy"
								data-action="ai-explain"
								aria-busy="${ifDefined(this.explainBusy ? 'true' : undefined)}"
								@click=${this.onExplainChanges}
								@keydown=${this.onExplainChanges}
								><code-icon icon="loading" modifier="spin"></code-icon>Explain Changes</gl-button
							>
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

	// private renderCommitStats() {
	// 	if (this.state?.draft?.stats?.changedFiles == null) {
	// 		return undefined;
	// 	}

	// 	if (typeof this.state.draft.stats.changedFiles === 'number') {
	// 		return html`<commit-stats
	// 			.added=${undefined}
	// 			modified="${this.state.draft.stats.changedFiles}"
	// 			.removed=${undefined}
	// 		></commit-stats>`;
	// 	}

	// 	const { added, deleted, changed } = this.state.draft.stats.changedFiles;
	// 	return html`<commit-stats added="${added}" modified="${changed}" removed="${deleted}"></commit-stats>`;
	// }

	private renderChangedFiles() {
		const layout = this.state?.preferences?.files?.layout ?? 'auto';

		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Files changed </span>
				<!-- <span slot="subtitle" data-region="stats">\${this.renderCommitStats()}</span> -->
				<action-nav slot="actions">${this.renderLayoutAction(layout)}</action-nav>

				${when(
					this.validityMessage != null,
					() =>
						html`<div class="section">
							<div class="alert alert--error">
								<code-icon icon="error"></code-icon>
								<p class="alert__content">${this.validityMessage}</p>
							</div>
						</div>`,
				)}
				<div class="change-list" data-region="files">
					${when(
						this.state?.draft?.patches == null,
						() => this.renderLoading(),
						() => this.renderTreeView(this.treeModel, this.state?.preferences?.indentGuides),
					)}
				</div>
			</webview-pane>
		`;
	}

	// TODO: make a local state instead of a getter
	get treeModel(): TreeModel[] {
		if (this.state?.draft?.patches == null) return [];

		const {
			draft: { patches },
		} = this.state;

		const layout = this.state?.preferences?.files?.layout ?? 'auto';
		let isTree = false;

		const fileCount = flatCount(patches, p => p?.files?.length ?? 0);
		if (layout === 'auto') {
			isTree = fileCount > (this.state.preferences?.files?.threshold ?? 5);
		} else {
			isTree = layout === 'tree';
		}

		const models = patches?.map(p =>
			this.draftPatchToTreeModel(p, isTree, this.state.preferences?.files?.compact, {
				checkable: true,
				checked: this.selectedPatches.includes(p.id),
			}),
		);
		return models;
	}

	renderUserSelection(userSelection: DraftUserSelection, role: DraftRole) {
		const selectionRole = userSelection.pendingRole ?? userSelection.user!.role;
		const options = new Map<string, string>([
			['owner', 'owner'],
			['admin', 'admin'],
			['editor', 'can edit'],
			['viewer', 'can view'],
			['remove', 'un-invite'],
		]);
		const roleLabel = options.get(selectionRole);
		return html`
			<div class="user-selection">
				<div class="user-selection__avatar">
					<gk-avatar .src=${userSelection.avatarUrl}></gk-avatar>
				</div>
				<div class="user-selection__info">
					<div class="user-selection__name">
						${userSelection.member.name ?? userSelection.member.username}
					</div>
				</div>
				<div class="user-selection__actions">
					${when(
						selectionRole !== 'owner' && (role === 'owner' || role === 'admin'),
						() => html`
							<gk-popover>
								<gk-button slot="trigger"
									>${roleLabel} <code-icon icon="chevron-down"></code-icon
								></gk-button>
								<gk-menu>
									${map(options, ([value, label]) =>
										value === 'owner'
											? undefined
											: html`<gk-menu-item
													@click=${(e: MouseEvent) =>
														this.onChangeSelectionRole(
															e,
															userSelection,
															value as PatchDetailsUpdateSelectionEventDetail['role'],
														)}
											  >
													<code-icon
														icon="check"
														class="user-selection__check ${selectionRole === value
															? 'is-active'
															: ''}"
													></code-icon>
													${label}
											  </gk-menu-item>`,
									)}
								</gk-menu>
							</gk-popover>
						`,
						() => html`${roleLabel}`,
					)}
				</div>
			</div>
		`;
	}

	renderUserSelectionList(draft: CloudDraftDetails) {
		if (draft.userSelections == null || draft.userSelections.length === 0) {
			return undefined;
		}

		return html`
			<div class="message-input">
				<div class="user-selection-container scrollable">
					${repeat(
						draft.userSelections,
						userSelection => userSelection.member.id,
						userSelection => this.renderUserSelection(userSelection, draft.role),
					)}
				</div>
			</div>
		`;
	}

	renderPatchPermissions() {
		const draft = this.state.draft!.draftType === 'cloud' ? this.state.draft! : undefined;
		if (draft == null) return undefined;

		if (draft.role === 'admin' || draft.role === 'owner') {
			const hasChanges = draft.userSelections?.some(selection => selection.change !== undefined);
			let visibilityIcon: string | undefined;
			switch (draft.visibility) {
				case 'private':
					visibilityIcon = 'organization';
					break;
				case 'invite_only':
					visibilityIcon = 'lock';
					break;
				default:
					visibilityIcon = 'globe';
					break;
			}
			return html`
				<div class="message-input message-input--group">
					<div class="message-input__select">
						<span class="message-input__select-icon"><code-icon icon=${visibilityIcon}></code-icon></span>
						<select id="visibility" class="message-input__control" @change=${this.onVisibilityChange}>
							<option value="public" ?selected=${draft.visibility === 'public'}>
								Anyone with the link
							</option>
							<option value="private" ?selected=${draft.visibility === 'private'}>
								Members of my Org with the link
							</option>
							<option value="invite_only" ?selected=${draft.visibility === 'invite_only'}>
								Collaborators only
							</option>
						</select>
						<span class="message-input__select-caret"><code-icon icon="chevron-down"></code-icon></span>
					</div>
					<gl-button appearance="secondary" @click=${this.onInviteUsers}
						><code-icon icon="person-add"></code-icon> Invite</gl-button
					>
				</div>
				${this.renderUserSelectionList(draft)}
				${when(
					hasChanges,
					() => html`
						<p class="button-container">
							<span class="button-group button-group--single">
								<gl-button appearance="secondary" full @click=${this.onUpdatePatch}
									>Update Patch</gl-button
								>
							</span>
						</p>
					`,
				)}
			`;
		}

		return html`
			<div class="message-input">
				<div class="message-input__control message-input__control--text">
					${when(
						draft.visibility === 'public',
						() => html`<code-icon icon="globe"></code-icon> Anyone with the link`,
					)}
					${when(
						draft.visibility === 'private',
						() => html`<code-icon icon="organization"></code-icon> Members of my Org with the link`,
					)}
					${when(
						draft.visibility === 'invite_only',
						() => html`<code-icon icon="lock"></code-icon> Collaborators only`,
					)}
				</div>
			</div>
			${this.renderUserSelectionList(draft)}
		`;
	}

	renderPatches() {
		// // const path = this.state.draft?.repoPath;
		// const repo = this.state.draft?.repoName;
		// const base = this.state.draft?.baseRef;

		// const getActions = () => {
		// 	if (!repo) {
		// 		return html`
		// 			<a href="#" class="commit-action" data-action="select-patch-repo" @click=${this.onSelectPatchRepo}
		// 				><code-icon icon="repo" title="Repository" aria-label="Repository"></code-icon
		// 				><span class="top-details__sha">Select base repo</span></a
		// 			>
		// 			<a href="#" class="commit-action is-disabled"><code-icon icon="gl-graph"></code-icon></a>
		// 		`;
		// 	}

		// 	if (!base) {
		// 		return html`
		// 			<a href="#" class="commit-action" data-action="select-patch-repo" @click=${this.onSelectPatchRepo}
		// 				><code-icon icon="repo" title="Repository" aria-label="Repository"></code-icon
		// 				><span class="top-details__sha">${repo}</span></a
		// 			>
		// 			<a href="#" class="commit-action" data-action="select-patch-base" @click=${this.onChangePatchBase}
		// 				><code-icon icon="git-commit" title="Repository" aria-label="Repository"></code-icon
		// 				><span class="top-details__sha">Select base</span></a
		// 			>
		// 			<a href="#" class="commit-action is-disabled"><code-icon icon="gl-graph"></code-icon></a>
		// 		`;
		// 	}

		// 	return html`
		// 		<a href="#" class="commit-action" data-action="select-patch-repo" @click=${this.onSelectPatchRepo}
		// 			><code-icon icon="repo" title="Repository" aria-label="Repository"></code-icon
		// 			><span class="top-details__sha">${repo}</span></a
		// 		>
		// 		<a href="#" class="commit-action" data-action="select-patch-base" @click=${this.onChangePatchBase}
		// 			><code-icon icon="git-commit"></code-icon
		// 			><span class="top-details__sha">${base?.substring(0, 7)}</span></a
		// 		>
		// 		<a href="#" class="commit-action" data-action="patch-base-in-graph" @click=${this.onShowInGraph}
		// 			><code-icon icon="gl-graph"></code-icon
		// 		></a>
		// 	`;
		// };

		// <div class="section">
		// 	<div class="patch-base">${getActions()}</div>
		// </div>

		return html`
			<div class="section section--action">
				${this.renderPatchPermissions()}
				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full @click=${this.onApplyPatch}>Apply Patch</gl-button>
						<gk-popover placement="top">
							<gl-button
								slot="trigger"
								density="compact"
								aria-label="Apply Patch Options..."
								title="Apply Patch Options..."
								><code-icon icon="chevron-down"></code-icon
							></gl-button>
							<gk-menu class="mine-menu" @select=${this.onSelectApplyOption}>
								<gk-menu-item data-value="branch">Apply to a Branch</gk-menu-item>
								<!-- <gk-menu-item data-value="worktree">Apply to new worktree</gk-menu-item> -->
							</gk-menu>
						</gk-popover>
					</span>
				</p>
			</div>
		`;
	}

	// renderCollaborators() {
	// 	return html`
	// 		<webview-pane collapsable expanded>
	// 			<span slot="title">Collaborators</span>

	// 			<div class="h-spacing">
	// 				<list-container>
	// 					<list-item>
	// 						<code-icon
	// 							slot="icon"
	// 							icon="account"
	// 							title="Collaborator"
	// 							aria-label="Collaborator"
	// 						></code-icon>
	// 						justin.roberts@gitkraken.com
	// 					</list-item>
	// 					<list-item>
	// 						<code-icon
	// 							slot="icon"
	// 							icon="account"
	// 							title="Collaborator"
	// 							aria-label="Collaborator"
	// 						></code-icon>
	// 						eamodio@gitkraken.com
	// 					</list-item>
	// 					<list-item>
	// 						<code-icon
	// 							slot="icon"
	// 							icon="account"
	// 							title="Collaborator"
	// 							aria-label="Collaborator"
	// 						></code-icon>
	// 						keith.daulton@gitkraken.com
	// 					</list-item>
	// 				</list-container>
	// 			</div>
	// 		</webview-pane>
	// 	`;
	// }

	renderActionbar() {
		const draft = this.state?.draft;
		if (draft == null) return undefined;

		if (draft.draftType === 'local') {
			return html`
				<div class="top-details__actionbar">
					<div class="top-details__actionbar-group"></div>
					<div class="top-details__actionbar-group">
						<a
							class="commit-action"
							href="#"
							aria-label="Share Patch"
							title="Share Patch"
							@click=${this.onShareLocalPatch}
							>Share</a
						>
					</div>
				</div>
			`;
		}

		return html`
			<div class="top-details__actionbar">
				<div class="top-details__actionbar-group"></div>
				<div class="top-details__actionbar-group">
					<a class="commit-action" href="#" @click=${this.onCopyCloudLink}>
						<code-icon icon="${this._copiedLink ? 'check' : 'link'}"></code-icon>
						<span class="top-details__sha">Copy Link</span></a
					>
				</div>
			</div>
		`;
	}

	override render() {
		if (this.state?.draft == null) {
			return html` <div class="commit-detail-panel scrollable">${this.renderEmptyContent()}</div>`;
		}

		return html`
			<div class="pane-groups">
				<div class="pane-groups__group-fixed">
					<div class="section">
						${this.renderActionbar()}
						${when(
							this.state.draft?.title != null,
							() => html`
								<h1 class="title">${this.state.draft?.title}</h1>
								${this.renderPatchMessage()}
							`,
						)}
					</div>
				</div>
				<div class="pane-groups__group">${this.renderChangedFiles()}</div>
				<div class="pane-groups__group-fixed pane-groups__group--bottom">
					${this.renderExplainAi()}${this.renderPatches()}
				</div>
			</div>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}

	private onInviteUsers(_e: Event) {
		this.fireEvent('gl-patch-details-invite-users');
	}

	private onChangeSelectionRole(
		e: MouseEvent,
		selection: DraftUserSelection,
		role: PatchDetailsUpdateSelectionEventDetail['role'],
	) {
		this.fireEvent('gl-patch-details-update-selection', { selection: selection, role: role });

		const popoverEl: Popover | null = (e.target as HTMLElement)?.closest('gk-popover');
		popoverEl?.hidePopover();
	}

	private onVisibilityChange(e: Event) {
		const draft = this.state.draft as CloudDraftDetails;
		draft.visibility = (e.target as HTMLInputElement).value as DraftVisibility;
		this.fireEvent('gl-patch-details-update-metadata', {
			visibility: draft.visibility,
		});
	}

	private onUpdatePatch(_e: Event) {
		this.fireEvent('gl-patch-details-update-permissions');
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

	fireFileEvent(name: string, file: DraftPatchFileChange, showOptions?: TextDocumentShowOptions) {
		const event = new CustomEvent(name, {
			detail: { ...file, showOptions: showOptions },
		});
		this.dispatchEvent(event);
	}

	onCompareWorking(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		this.fireEvent('gl-patch-file-compare-working', {
			...file,
			showOptions: {
				preview: false,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			},
		});
	}

	onOpenFile(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		this.fireEvent('gl-patch-file-open', {
			...file,
			showOptions: {
				preview: false,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			},
		});
	}

	override onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>) {
		if (!e.detail.context) return;

		const [gkRepositoryId] = e.detail.context;
		const patch = this.state.draft?.patches?.find(p => p.gkRepositoryId === gkRepositoryId);
		if (!patch) return;
		const selectedIndex = this.selectedPatches.indexOf(patch?.id);
		if (e.detail.checked) {
			if (selectedIndex === -1) {
				this.selectedPatches.push(patch.id);
				this.validityMessage = undefined;
			}
		} else if (selectedIndex > -1) {
			this.selectedPatches.splice(selectedIndex, 1);
		}

		const event = new CustomEvent('gl-patch-checked', {
			detail: {
				patch: patch,
				checked: e.detail.checked,
			},
		});
		this.dispatchEvent(event);
	}

	override onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		this.fireEvent('gl-patch-file-compare-previous', { ...file });
	}

	onApplyPatch(e?: MouseEvent | KeyboardEvent, target: 'current' | 'branch' | 'worktree' = 'current') {
		if (this.canSubmit === false) {
			this.validityMessage = 'Please select changes to apply';
			return;
		}

		this.validityMessage = undefined;

		this.fireEvent('gl-patch-apply-patch', {
			draft: this.state.draft!,
			target: target,
			selectedPatches: this.selectedPatches,
		});
	}

	onSelectApplyOption(e: CustomEvent<{ target: MenuItem }>) {
		if (this.canSubmit === false) {
			this.validityMessage = 'Please select changes to apply';
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
		this.fireEvent('gl-patch-details-graph-show-patch', { draft: this.state.draft! });
	}

	onCopyCloudLink() {
		this.fireEvent('gl-patch-details-copy-cloud-link', { draft: this.state.draft! });
		this._copiedLink = true;
		setTimeout(() => (this._copiedLink = false), 1000);
	}

	onShareLocalPatch() {
		this.fireEvent('gl-patch-details-share-local-patch', { draft: this.state.draft! });
	}

	draftPatchToTreeModel(
		patch: NonNullable<DraftDetails['patches']>[0],
		isTree = false,
		compact = true,
		options?: Partial<TreeItemBase>,
	): TreeModel {
		const model = this.repoToTreeModel(
			patch.repository.name,
			patch.gkRepositoryId,
			options,
			patch.repository.located ? undefined : 'missing',
		);

		if (!patch.files?.length) return model;

		const children = [];
		if (isTree) {
			const fileTree = makeHierarchical(
				patch.files,
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
			for (const file of patch.files) {
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

	// override getRepoActions(_name: string, _path: string, _options?: Partial<TreeItemBase>) {
	// 	return [
	// 		{
	// 			icon: 'cloud-download',
	// 			label: 'Apply...',
	// 			action: 'apply-patch',
	// 		},
	// 		// {
	// 		// 	icon: 'git-commit',
	// 		// 	label: 'Change Base',
	// 		// 	action: 'change-patch-base',
	// 		// },
	// 		{
	// 			icon: 'gl-graph',
	// 			label: 'Open in Commit Graph',
	// 			action: 'show-patch-in-graph',
	// 		},
	// 	];
	// }

	override getFileActions(_file: DraftPatchFileChange, _options?: Partial<TreeItemBase>) {
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
		'gl-draft-details': GlDraftDetails;
	}

	interface WindowEventMap {
		'gl-patch-apply-patch': CustomEvent<ApplyPatchDetail>;
		'gl-patch-details-graph-show-patch': CustomEvent<{ draft: DraftDetails }>;
		'gl-patch-details-share-local-patch': CustomEvent<{ draft: DraftDetails }>;
		'gl-patch-details-copy-cloud-link': CustomEvent<{ draft: DraftDetails }>;
		'gl-patch-file-compare-previous': CustomEvent<FileActionParams>;
		'gl-patch-file-compare-working': CustomEvent<FileActionParams>;
		'gl-patch-file-open': CustomEvent<FileActionParams>;
		'gl-patch-checked': CustomEvent<PatchCheckedDetail>;
		'gl-patch-details-invite-users': CustomEvent<undefined>;
		'gl-patch-details-update-selection': CustomEvent<PatchDetailsUpdateSelectionEventDetail>;
		'gl-patch-details-update-metadata': CustomEvent<{ visibility: DraftVisibility }>;
		'gl-patch-details-update-permissions': CustomEvent<undefined>;
	}
}
