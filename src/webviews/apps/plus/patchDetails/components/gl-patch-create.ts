import { Avatar, Button, defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { GitFileChangeShape } from '../../../../../git/models/file';
import type { DraftRole, DraftVisibility } from '../../../../../gk/models/drafts';
import type {
	Change,
	DraftUserSelection,
	FileActionParams,
	State,
} from '../../../../../plus/webviews/patchDetails/protocol';
import { flatCount } from '../../../../../system/iterable';
import type { Serialized } from '../../../../../system/serialize';
import type {
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
} from '../../../shared/components/tree/base';
import { GlTreeBase } from './gl-tree-base';
import '../../../shared/components/actions/action-nav';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/webview-pane';

export interface CreatePatchEventDetail {
	title: string;
	description?: string;
	visibility: DraftVisibility;
	changesets: Record<string, Change>;
	userSelections: DraftUserSelection[] | undefined;
}

export interface CreatePatchMetadataEventDetail {
	title: string;
	description: string | undefined;
	visibility: DraftVisibility;
}

export interface CreatePatchCheckRepositoryEventDetail {
	repoUri: string;
	checked: boolean | 'staged';
}

export interface CreatePatchUpdateSelectionEventDetail {
	selection: DraftUserSelection;
	role: Exclude<DraftRole, 'owner'> | 'remove';
}

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

export type GlPatchCreateEvents = {
	[K in Extract<keyof WindowEventMap, `gl-patch-${string}` | `gl-patch-create-${string}`>]: WindowEventMap[K];
};

@customElement('gl-patch-create')
export class GlPatchCreate extends GlTreeBase<GlPatchCreateEvents> {
	@property({ type: Object }) state?: Serialized<State>;

	// @state()
	// patchTitle = this.create.title ?? '';

	// @state()
	// description = this.create.description ?? '';

	@query('#title')
	titleInput!: HTMLInputElement;

	@query('#desc')
	descInput!: HTMLInputElement;

	@state()
	validityMessage?: string;

	get create() {
		return this.state!.create!;
	}

	get createChanges() {
		return Object.values(this.create.changes);
	}

	get createEntries() {
		return Object.entries(this.create.changes);
	}

	get hasWipChanges() {
		return this.createChanges.some(change => change?.type === 'wip');
	}

	get selectedChanges(): [string, Change][] {
		if (this.createChanges.length === 1) return this.createEntries;

		return this.createEntries.filter(([, change]) => change.checked !== false);
	}

	get canSubmit() {
		return this.create.title != null && this.create.title.length > 0 && this.selectedChanges.length > 0;
	}

	get fileLayout() {
		return this.state?.preferences?.files?.layout ?? 'auto';
	}

	get isCompact() {
		return this.state?.preferences?.files?.compact ?? true;
	}

	get filesModified() {
		return flatCount(this.createChanges, c => c.files?.length ?? 0);
	}

	get draftVisibility() {
		return this.state?.create?.visibility ?? 'public';
	}

	constructor() {
		super();

		defineGkElement(Avatar, Button, Menu, MenuItem, Popover);
	}

	renderUserSelection(userSelection: DraftUserSelection) {
		const role = userSelection.pendingRole!;
		const options = new Map<string, string>([
			['admin', 'admin'],
			['editor', 'can edit'],
			['viewer', 'can view'],
			['remove', 'un-invite'],
		]);
		const roleLabel = options.get(role);
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
					<gk-popover>
						<gk-button slot="trigger">${roleLabel} <code-icon icon="chevron-down"></code-icon></gk-button>
						<gk-menu>
							${map(
								options,
								([value, label]) =>
									html`<gk-menu-item
										@click=${(e: MouseEvent) =>
											this.onChangeSelectionRole(
												e,
												userSelection,
												value as CreatePatchUpdateSelectionEventDetail['role'],
											)}
									>
										<code-icon
											icon="check"
											class="user-selection__check ${role === value ? 'is-active' : ''}"
										></code-icon>
										${label}
									</gk-menu-item>`,
							)}
						</gk-menu>
					</gk-popover>
				</div>
			</div>
		`;
	}

	renderUserSelectionList() {
		if (this.state?.create?.userSelections == null || this.state?.create?.userSelections.length === 0) {
			return undefined;
		}

		return html`
			<div class="message-input">
				<div class="user-selection-container scrollable">
					${repeat(
						this.state.create.userSelections,
						userSelection => userSelection.member.id,
						userSelection => this.renderUserSelection(userSelection),
					)}
				</div>
			</div>
		`;
	}

	renderForm() {
		let visibilityIcon: string | undefined;
		switch (this.draftVisibility) {
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
			<div class="section section--action">
				${when(
					this.state?.create?.creationError != null,
					() =>
						html` <div class="alert alert--error">
							<code-icon icon="error"></code-icon>
							<p class="alert__content">${this.state!.create!.creationError}</p>
						</div>`,
				)}
				<div class="message-input message-input--group">
					<div class="message-input__select">
						<span class="message-input__select-icon"><code-icon icon=${visibilityIcon}></code-icon></span>
						<select id="visibility" class="message-input__control" @change=${this.onVisibilityChange}>
							<option value="public" ?selected=${this.draftVisibility === 'public'}>Anyone with the link</option>
							<option value="private" ?selected=${this.draftVisibility === 'private'}>Members of my Org with the link</option>
							<option value="invite_only" ?selected=${this.draftVisibility === 'invite_only'}>Collaborators only</option>
						</select>
						<span class="message-input__select-caret"><code-icon icon="chevron-down"></code-icon></span>
					</div>
					<gl-button appearance="secondary" @click=${
						this.onInviteUsers
					}><code-icon icon="person-add"></code-icon> Invite</gl-button>
				</div>
				${this.renderUserSelectionList()}
				<div class="message-input">
					<input id="title" type="text" class="message-input__control" placeholder="Title (required)" maxlength="100" .value=${
						this.create.title ?? ''
					} @input=${this.onTitleInput}></textarea>
				</div>
				<div class="message-input">
					<textarea id="desc" class="message-input__control" placeholder="Description (optional)" maxlength="10000" .value=${
						this.create.description ?? ''
					}  @input=${this.onDescriptionInput}></textarea>
				</div>
				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full @click=${this.onCreateAll}>Create Cloud Patch</gl-button>
					</span>
				</p>
				<!-- <p class="h-deemphasize"><code-icon icon="account"></code-icon> Requires a GitKraken account <a href="#">sign-in</a></p> -->
				${when(
					this.state?.orgSettings.byob === true,
					() =>
						html`<p class="h-deemphasize">
							<code-icon icon="lock"></code-icon>
							<a
								href="https://www.gitkraken.com/solutions/cloud-patches"
								title="Learn more about Cloud Patches"
								aria-label="Learn more about GitKraken security"
								>Cloud Patches</a
							>
							are
							<a
								href="https://help.gitkraken.com/gitlens/security"
								title="Learn more about Cloud Patches"
								aria-label="Learn more about GitKraken security"
								>securely stored</a
							>
							by GitKraken.
						</p>`,
					() =>
						html`<p class="h-deemphasize">
							<code-icon icon="info"></code-icon>
							Your
							<a
								href="https://www.gitkraken.com/solutions/cloud-patches"
								title="Learn more about Cloud Patches"
								aria-label="Learn more about GitKraken security"
								>Cloud Patch</a
							>
							will be securely stored in your organization's self-hosted storage
						</p>`,
				)}
			</div>
			`;
	}

	// <gl-create-details
	// 	.repoChanges=${this.repoChanges}
	// 	.preferences=${this.state?.preferences}
	// 	.isUncommitted=${true}
	// 	@changeset-repo-checked=${this.onRepoChecked}
	// 	@changeset-unstaged-checked=${this.onUnstagedChecked}
	// >
	// </gl-create-details>
	override render() {
		return html`
			<div class="pane-groups">
				<div class="pane-groups__group">${this.renderChangedFiles()}</div>
				<div class="pane-groups__group-fixed pane-groups__group--bottom">${this.renderForm()}</div>
			</div>
		`;
	}

	private renderChangedFiles() {
		return html`
			<webview-pane class="h-no-border" expanded>
				<span slot="title">Changes to Include</span>
				<action-nav slot="actions">${this.renderLayoutAction(this.fileLayout)}</action-nav>

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
						this.create.changes == null,
						() => this.renderLoading(),
						() => this.renderTreeViewWithModel(),
					)}
				</div>
			</webview-pane>
		`;
	}

	// private renderChangeStats() {
	// 	if (this.filesModified == null) return undefined;

	// 	return html`<commit-stats
	// 		.added=${undefined}
	// 		modified="${this.filesModified}"
	// 		.removed=${undefined}
	// 	></commit-stats>`;
	// }

	override onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>) {
		console.log(e);
		// this.onRepoChecked()
		if (e.detail.context == null || e.detail.context.length < 1) return;

		const [repoUri, type] = e.detail.context;
		let checked: boolean | 'staged' = e.detail.checked;
		if (type === 'unstaged') {
			checked = e.detail.checked ? true : 'staged';
		}
		const change = this.getChangeForRepo(repoUri);
		if (change == null) {
			debugger;
			return;
		}

		if (change.checked === checked) return;

		change.checked = checked;
		this.requestUpdate('state');

		this.fireEvent('gl-patch-create-repo-checked', {
			repoUri: repoUri,
			checked: checked,
		});
	}

	override onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		this.fireEvent('gl-patch-file-compare-previous', { ...file });
	}

	private renderTreeViewWithModel() {
		if (this.createChanges == null || this.createChanges.length === 0) {
			return this.renderTreeView([
				{
					label: 'No changes',
					path: '',
					level: 1,
					branch: false,
					checkable: false,
					expanded: true,
					checked: false,
				},
			]);
		}

		const treeModel: TreeModel[] = [];
		// for knowing if we need to show repos
		const isCheckable = this.createChanges.length > 1;
		const isTree = this.isTree(this.filesModified ?? 0);
		const compact = this.isCompact;

		if (isCheckable) {
			for (const changeset of this.createChanges) {
				const tree = this.getTreeForChange(changeset, true, isTree, compact);
				if (tree != null) {
					treeModel.push(...tree);
				}
			}
		} else {
			const changeset = this.createChanges[0];
			const tree = this.getTreeForChange(changeset, false, isTree, compact);
			if (tree != null) {
				treeModel.push(...tree);
			}
		}
		return this.renderTreeView(treeModel, this.state?.preferences?.indentGuides);
	}

	private getTreeForChange(change: Change, isMulti = false, isTree = false, compact = true): TreeModel[] | undefined {
		if (change.files == null || change.files.length === 0) return undefined;

		const children = [];
		if (change.type === 'wip') {
			const staged: Change['files'] = [];
			const unstaged: Change['files'] = [];

			for (const f of change.files) {
				if (f.staged) {
					staged.push(f);
				} else {
					unstaged.push(f);
				}
			}

			if (staged.length === 0 || unstaged.length === 0) {
				children.push(...this.renderFiles(change.files, isTree, compact, isMulti ? 2 : 1));
			} else {
				if (unstaged.length) {
					children.push({
						label: 'Unstaged Changes',
						path: '',
						level: isMulti ? 2 : 1,
						branch: true,
						checkable: true,
						expanded: true,
						checked: change.checked === true,
						context: [change.repository.uri, 'unstaged'],
						children: this.renderFiles(unstaged, isTree, compact, isMulti ? 3 : 2),
					});
				}

				if (staged.length) {
					children.push({
						label: 'Staged Changes',
						path: '',
						level: isMulti ? 2 : 1,
						branch: true,
						checkable: true,
						expanded: true,
						checked: change.checked !== false,
						disableCheck: true,
						children: this.renderFiles(staged, isTree, compact, isMulti ? 3 : 2),
					});
				}
			}
		} else {
			children.push(...this.renderFiles(change.files, isTree, compact));
		}

		if (!isMulti) {
			return children;
		}

		const repoModel = this.repoToTreeModel(change.repository.name, change.repository.uri, {
			branch: true,
			checkable: true,
			checked: change.checked !== false,
		});
		repoModel.children = children;

		return [repoModel];
	}

	private isTree(count: number) {
		if (this.fileLayout === 'auto') {
			return count > (this.state?.preferences?.files?.threshold ?? 5);
		}
		return this.fileLayout === 'tree';
	}

	private createPatch() {
		if (!this.canSubmit) {
			// TODO: show error
			if (this.titleInput.value.length === 0) {
				this.titleInput.setCustomValidity('Title is required');
				this.titleInput.reportValidity();
				this.titleInput.focus();
			} else {
				this.titleInput.setCustomValidity('');
			}

			if (this.selectedChanges == null || this.selectedChanges.length === 0) {
				this.validityMessage = 'Check at least one change';
			} else {
				this.validityMessage = undefined;
			}
			return;
		}
		this.validityMessage = undefined;
		this.titleInput.setCustomValidity('');

		const changes = this.selectedChanges.reduce<Record<string, Change>>((a, [id, change]) => {
			a[id] = change;
			return a;
		}, {});

		const patch: CreatePatchEventDetail = {
			title: this.create.title ?? '',
			description: this.create.description,
			changesets: changes,
			visibility: this.create.visibility,
			userSelections: this.create.userSelections,
		};
		this.fireEvent('gl-patch-create-patch', patch);
	}

	private onCreateAll(_e: Event) {
		// const change = this.create.[0];
		// if (change == null) {
		// 	return;
		// }
		// this.createPatch([change]);
		this.createPatch();
	}

	private onSelectCreateOption(_e: CustomEvent<{ target: MenuItem }>) {
		// const target = e.detail?.target;
		// const value = target?.dataset?.value as 'staged' | 'unstaged' | undefined;
		// const currentChange = this.create.[0];
		// if (value == null || currentChange == null) {
		// 	return;
		// }
		// const change = {
		// 	...currentChange,
		// 	files: currentChange.files.filter(file => {
		// 		const staged = file.staged ?? false;
		// 		return (staged && value === 'staged') || (!staged && value === 'unstaged');
		// 	}),
		// };
		// this.createPatch([change]);
	}

	private getChangeForRepo(repoUri: string): Change | undefined {
		return this.create.changes[repoUri];

		// for (const [id, change] of this.createEntries) {
		// 	if (change.repository.uri === repoUri) return change;
		// }

		// return undefined;
	}

	// private onRepoChecked(e: CustomEvent<{ repoUri: string; checked: boolean }>) {
	// 	const [_, changeset] = this.getRepoChangeSet(e.detail.repoUri);

	// 	if ((changeset as RepoWipChangeSet).checked === e.detail.checked) {
	// 		return;
	// 	}

	// 	(changeset as RepoWipChangeSet).checked = e.detail.checked;
	// 	this.requestUpdate('state');
	// }

	// private onUnstagedChecked(e: CustomEvent<{ repoUri: string; checked: boolean | 'staged' }>) {
	// 	const [_, changeset] = this.getRepoChangeSet(e.detail.repoUri);

	// 	if ((changeset as RepoWipChangeSet).checked === e.detail.checked) {
	// 		return;
	// 	}

	// 	(changeset as RepoWipChangeSet).checked = e.detail.checked;
	// 	this.requestUpdate('state');
	// }

	private onTitleInput(e: InputEvent) {
		this.create.title = (e.target as HTMLInputElement).value;
		this.fireEvent('gl-patch-create-update-metadata', {
			title: this.create.title,
			description: this.create.description,
			visibility: this.create.visibility,
		});
	}

	private onDescriptionInput(e: InputEvent) {
		this.create.description = (e.target as HTMLInputElement).value;
		this.fireEvent('gl-patch-create-update-metadata', {
			title: this.create.title!,
			description: this.create.description,
			visibility: this.create.visibility,
		});
	}

	private onInviteUsers(_e: Event) {
		this.fireEvent('gl-patch-create-invite-users');
	}

	private onChangeSelectionRole(
		e: MouseEvent,
		selection: DraftUserSelection,
		role: CreatePatchUpdateSelectionEventDetail['role'],
	) {
		this.fireEvent('gl-patch-create-update-selection', { selection: selection, role: role });

		const popoverEl: Popover | null = (e.target as HTMLElement)?.closest('gk-popover');
		popoverEl?.hidePopover();
	}

	private onVisibilityChange(e: Event) {
		this.create.visibility = (e.target as HTMLInputElement).value as DraftVisibility;
		this.fireEvent('gl-patch-create-update-metadata', {
			title: this.create.title!,
			description: this.create.description,
			visibility: this.create.visibility,
		});
	}

	protected override createRenderRoot() {
		return this;
	}

	override onTreeItemActionClicked(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context || !e.detail.action) return;

		const action = e.detail.action;
		switch (action.action) {
			case 'show-patch-in-graph':
				this.onShowInGraph(e);
				break;

			case 'file-open':
				this.onOpenFile(e);
				break;
		}
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

	onShowInGraph(_e: CustomEvent<TreeItemActionDetail>) {
		// this.fireEvent('gl-patch-details-graph-show-patch', { draft: this.state!.create! });
	}

	override getFileActions(_file: GitFileChangeShape, _options?: Partial<TreeItemBase>) {
		return [
			{
				icon: 'go-to-file',
				label: 'Open file',
				action: 'file-open',
			},
		];
	}

	override getRepoActions(_name: string, _path: string, _options?: Partial<TreeItemBase>) {
		return [
			{
				icon: 'gl-graph',
				label: 'Open in Commit Graph',
				action: 'show-patch-in-graph',
			},
		];
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-patch-create': GlPatchCreate;
	}

	interface WindowEventMap {
		'gl-patch-create-repo-checked': CustomEvent<CreatePatchCheckRepositoryEventDetail>;
		'gl-patch-create-patch': CustomEvent<CreatePatchEventDetail>;
		'gl-patch-create-update-metadata': CustomEvent<CreatePatchMetadataEventDetail>;
		'gl-patch-file-compare-previous': CustomEvent<FileActionParams>;
		'gl-patch-file-compare-working': CustomEvent<FileActionParams>;
		'gl-patch-file-open': CustomEvent<FileActionParams>;
		'gl-patch-create-invite-users': CustomEvent<undefined>;
		'gl-patch-create-update-selection': CustomEvent<CreatePatchUpdateSelectionEventDetail>;
		// 'gl-patch-details-graph-show-patch': CustomEvent<{ draft: State['create'] }>;
	}
}
