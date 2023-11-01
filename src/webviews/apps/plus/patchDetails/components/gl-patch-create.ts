import { defineGkElement, Menu, MenuItem, Popover } from '@gitkraken/shared-web-components';
import { html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { RepoChangeSet, RepoWipChangeSet, State } from '../../../../../plus/webviews/patchDetails/protocol';
import type { Serialized } from '../../../../../system/serialize';
import type { TreeItemCheckedDetail, TreeModel } from '../../../shared/components/tree/base';
import { GlTreeBase } from './gl-tree-base';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';

export interface CreatePatchEventDetail {
	title: string;
	description?: string;
	changeSets: Record<string, RepoChangeSet>;
}

@customElement('gl-patch-create')
export class GlPatchCreate extends GlTreeBase {
	@property({ type: Object }) state?: Serialized<State>;

	@state()
	patchTitle = '';

	@state()
	description = '';

	@query('#title')
	titleInput!: HTMLInputElement;

	@query('#desc')
	descInput!: HTMLInputElement;

	@state()
	validityMessage?: string;

	get createEntries() {
		if (this.state?.create == null) {
			return undefined;
		}

		return Object.entries(this.state.create);
	}

	get hasWipChanges() {
		if (this.createEntries == null) {
			return false;
		}

		return this.createEntries.some(([_id, changeSet]) => changeSet.change?.type === 'wip');
	}

	get selectedChanges(): [string, RepoChangeSet][] | undefined {
		return this.createEntries?.filter(([_id, changeSet]) => changeSet.checked !== false);
	}

	get canSubmit() {
		return this.patchTitle.length > 0 && this.selectedChanges != null && this.selectedChanges.length > 0;
	}

	get repoChanges() {
		if (this.state?.create == null) {
			return undefined;
		}
		return Object.values(this.state.create);
	}

	get fileLayout() {
		return this.state?.preferences?.files?.layout ?? 'auto';
	}

	get isCompact() {
		return this.state?.preferences?.files?.compact ?? true;
	}

	get filesModified() {
		if (this.repoChanges == null) return undefined;

		let modified = 0;
		for (const change of this.repoChanges) {
			if (change.change?.files != null) {
				modified += change.change.files.length;
			}
		}

		return modified;
	}

	constructor() {
		super();

		defineGkElement(Menu, MenuItem, Popover);
	}

	renderForm() {
		return html`
			<div class="section">
				<div class="message-input">
					<input id="title" type="text" class="message-input__control" placeholder="Title (required)" .value=${
						this.patchTitle
					} @input=${this.onTitleInput}></textarea>
				</div>
				<div class="message-input">
					<textarea id="desc" class="message-input__control" placeholder="Description (optional)" .value=${
						this.description
					}  @input=${this.onDescriptionInput}></textarea>
				</div>
				<p class="button-container">
					<span class="button-group button-group--single">
						<gl-button full @click=${this.onCreateAll}>Create Patch</gl-button>
						${when(
							this.hasWipChanges,
							() => html`
								<gk-popover placement="bottom">
									<gl-button
										slot="trigger"
										?disabled=${!this.canSubmit}
										density="compact"
										aria-label="Create Patch Options..."
										title="Create Patch Options..."
										><code-icon icon="chevron-down"></code-icon
									></gl-button>
									<gk-menu class="mine-menu" @select=${this.onSelectCreateOption}>
										<gk-menu-item data-value="local">Create Local Patch</gk-menu-item>
									</gk-menu>
								</gk-popover>
							`,
						)}
					</span>
				</p>
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
		return html`${this.renderForm()}${this.renderChangedFiles()}`;
	}

	private renderChangedFiles() {
		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		if (this.state?.create?.files != null) {
			switch (this.fileLayout) {
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
				<span slot="title">Files changed</span>
				<span slot="subtitle" data-region="stats">${this.renderChangeStats()}</span>
				<action-nav slot="actions">
					<action-item data-switch-value="${value}" label="${label}" icon="${icon}"></action-item>
				</action-nav>

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
						this.state?.draft?.files == null,
						() => this.renderLoading(),
						() => this.renderTreeViewWithModel(),
					)}
				</div>
			</webview-pane>
		`;
	}

	private renderChangeStats() {
		if (this.filesModified == null) return undefined;

		return html`<commit-stats
			.added=${undefined}
			modified="${this.filesModified}"
			.removed=${undefined}
		></commit-stats>`;
	}

	override onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>) {
		console.log(e);
		// this.onRepoChecked()
		if (e.detail.context == null || e.detail.context.length < 1) return;

		const [repoUri, type] = e.detail.context;
		let checked: boolean | 'staged' = e.detail.checked;
		if (type === 'unstaged') {
			checked = e.detail.checked ? true : 'staged';
		}
		const [_, changeSet] = this.getRepoChangeSet(repoUri as string);

		if ((changeSet as RepoWipChangeSet).checked === checked) {
			return;
		}

		(changeSet as RepoWipChangeSet).checked = checked;
		this.requestUpdate('state');
	}

	private renderTreeViewWithModel() {
		if (this.repoChanges == null) {
			return this.renderTreeView([]);
		}

		const treeModel: TreeModel[] = [];
		// for knowing if we need to show repos
		const isCheckable = this.repoChanges.length > 1;
		const isTree = this.isTree(this.filesModified ?? 0);
		const compact = this.isCompact;

		if (isCheckable) {
			for (const changeSet of this.repoChanges) {
				const tree = this.getTreeForChangeSet(changeSet, true, isTree, compact);
				if (tree != null) {
					treeModel.push(...tree);
				}
			}
		} else {
			const changeSet = this.repoChanges[0];
			const tree = this.getTreeForChangeSet(changeSet, false, isTree, compact);
			if (tree != null) {
				treeModel.push(...tree);
			}
		}
		return this.renderTreeView(treeModel);
	}

	private getTreeForChangeSet(
		changeSet: RepoChangeSet,
		isMulti = false,
		isTree = false,
		compact = true,
	): TreeModel[] | undefined {
		if (changeSet.change?.files == null || changeSet.change.files.length === 0) {
			if (!isMulti) {
				return undefined;
			}
			const repoModel = this.repoToTreeModel(changeSet.repoName, changeSet.repoUri, {
				branch: true,
				checkable: true,
				checked: false,
				disableCheck: true,
			});
			repoModel.children = [this.emptyTreeModel('No files', { level: 2, checkable: false, checked: false })];
			return [repoModel];
		}

		const children = [];

		if (changeSet.type === 'wip') {
			// remove parent if there's only staged or unstaged
			const staged = changeSet.change.files.filter(f => f.staged);
			if (staged.length) {
				children.push({
					label: 'Staged Changes',
					path: '',
					level: isMulti ? 2 : 1,
					branch: true,
					checkable: true,
					expanded: true,
					checked: changeSet.checked !== false,
					disableCheck: true,
					children: this.renderFiles(staged, isTree, compact, isMulti ? 3 : 2),
				});
			}

			const unstaged = changeSet.change.files.filter(f => !f.staged);
			if (unstaged.length) {
				children.push({
					label: 'Unstaged Changes',
					path: '',
					level: isMulti ? 2 : 1,
					branch: true,
					checkable: true,
					expanded: true,
					checked: changeSet.checked === true,
					context: [changeSet.repoUri, 'unstaged'],
					children: this.renderFiles(unstaged, isTree, compact, isMulti ? 3 : 2),
				});
			}
		} else {
			children.push(...this.renderFiles(changeSet.change.files, isTree, compact));
		}

		if (!isMulti) {
			return children;
		}

		const repoModel = this.repoToTreeModel(changeSet.repoName, changeSet.repoUri, {
			branch: true,
			checkable: true,
			checked: changeSet.checked !== false,
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

		const changes = this.selectedChanges!.reduce<Record<string, RepoChangeSet>>((a, [id, changeSet]) => {
			a[id] = changeSet;
			return a;
		}, {});

		const patch = {
			title: this.patchTitle,
			description: this.description,
			changeSets: changes,
		};

		this.dispatchEvent(new CustomEvent<CreatePatchEventDetail>('create-patch', { detail: patch }));
	}

	private onCreateAll(_e: Event) {
		// const change = this.state?.create?.[0];
		// if (change == null) {
		// 	return;
		// }
		// this.createPatch([change]);
		this.createPatch();
	}

	private onSelectCreateOption(_e: CustomEvent<{ target: MenuItem }>) {
		// const target = e.detail?.target;
		// const value = target?.dataset?.value as 'staged' | 'unstaged' | undefined;
		// const currentChange = this.state?.create?.[0];
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

	private getRepoChangeSet(repoUri: string) {
		if (this.state?.create == null) {
			return [];
		}

		for (const [id, changeSet] of Object.entries(this.state.create)) {
			if (changeSet.repoUri !== repoUri) {
				continue;
			}

			return [id, changeSet];
		}

		return [];
	}

	// private onRepoChecked(e: CustomEvent<{ repoUri: string; checked: boolean }>) {
	// 	const [_, changeSet] = this.getRepoChangeSet(e.detail.repoUri);

	// 	if ((changeSet as RepoWipChangeSet).checked === e.detail.checked) {
	// 		return;
	// 	}

	// 	(changeSet as RepoWipChangeSet).checked = e.detail.checked;
	// 	this.requestUpdate('state');
	// }

	// private onUnstagedChecked(e: CustomEvent<{ repoUri: string; checked: boolean | 'staged' }>) {
	// 	const [_, changeSet] = this.getRepoChangeSet(e.detail.repoUri);

	// 	if ((changeSet as RepoWipChangeSet).checked === e.detail.checked) {
	// 		return;
	// 	}

	// 	(changeSet as RepoWipChangeSet).checked = e.detail.checked;
	// 	this.requestUpdate('state');
	// }

	private onTitleInput(e: InputEvent) {
		this.patchTitle = (e.target as HTMLInputElement).value;
	}

	private onDescriptionInput(e: InputEvent) {
		this.description = (e.target as HTMLInputElement).value;
	}

	protected override createRenderRoot() {
		return this;
	}
}
