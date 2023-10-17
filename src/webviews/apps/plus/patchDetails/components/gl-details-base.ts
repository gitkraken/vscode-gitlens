import type { TemplateResult } from 'lit';
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { Change, Preferences, RepoChangeSet } from '../../../../../plus/webviews/patchDetails/protocol';
import type { HierarchicalItem } from '../../../../../system/array';
import { makeHierarchical } from '../../../../../system/array';

type Files = Change['files'];
type File = Files[0];
type Mode = 'commit' | 'stash' | 'wip';

export class GlDetailsBase extends LitElement {
	@property({ type: Array })
	files?: Files;

	@property({ type: Array })
	repoChanges?: RepoChangeSet[];

	@property({ type: Boolean })
	isUncommitted = false;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ attribute: 'empty-text' })
	emptyText? = 'No Repositories';

	get hasChangedFiles() {
		return this.repoChanges?.some(c => c.change?.files != null) ?? false;
	}

	private renderFileList(mode: Mode, files: Files, repoState?: { repoUri: string; checked: boolean | 'staged' }) {
		let items;

		if (this.isUncommitted) {
			items = [];

			const staged = files.filter(f => f.staged);
			if (staged.length) {
				const isChecked = repoState!.checked !== false;
				items.push(
					html`<list-item level="2" tree branch hide-icon checkable .checked=${isChecked} disable-check
						>Staged Changes</list-item
					>`,
				);

				for (const f of staged) {
					items.push(this.renderFile(mode, f, 3, true));
				}
			}

			const unstaged = files.filter(f => !f.staged);
			if (unstaged.length) {
				const isChecked = repoState!.checked === true;
				items.push(
					html`<list-item
						level="2"
						tree
						branch
						hide-icon
						checkable
						.checked=${isChecked}
						@list-item-checked=${(e: CustomEvent<{ checked: boolean }>) =>
							this.onUnstagedChecked(e, repoState!.repoUri)}
						>Unstaged Changes</list-item
					>`,
				);

				for (const f of unstaged) {
					items.push(this.renderFile(mode, f, 3, true));
				}
			}
		} else {
			items = files.map(f => this.renderFile(mode, f));
		}

		return items;
	}

	private renderFileTree(mode: Mode, files: Files, repoState?: { repoUri: string; checked: boolean | 'staged' }) {
		const compact = this.preferences?.files?.compact ?? true;

		let items;

		if (this.isUncommitted) {
			items = [];

			const staged = files.filter(f => f.staged);
			if (staged.length) {
				const isChecked = repoState!.checked !== false;
				items.push(
					html`<list-item level="2" tree branch hide-icon checkable .checked=${isChecked} disable-check
						>Staged Changes</list-item
					>`,
				);
				items.push(...this.renderFileSubtree(mode, staged, 3, compact));
			}

			const unstaged = files.filter(f => !f.staged);
			if (unstaged.length) {
				const isChecked = repoState!.checked === true;
				items.push(
					html`<list-item
						level="2"
						tree
						branch
						hide-icon
						checkable
						.checked=${isChecked}
						@list-item-checked=${(e: CustomEvent<{ checked: boolean }>) =>
							this.onUnstagedChecked(e, repoState!.repoUri)}
						>Unstaged Changes</list-item
					>`,
				);
				items.push(...this.renderFileSubtree(mode, unstaged, 3, compact));
			}
		} else {
			items = this.renderFileSubtree(mode, files, 2, compact);
		}

		return items;
	}

	private renderFileSubtree(mode: Mode, files: Files, rootLevel: number, compact: boolean) {
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

			return this.renderFile(mode, item.value, rootLevel + level, true);
		});
	}

	private renderFile(mode: Mode, file: File, level: number = 1, tree: boolean = false): TemplateResult<1> {
		return html`
			<file-change-list-item
				?tree=${tree}
				level="${level}"
				?stash=${mode === 'stash'}
				?uncommitted=${this.isUncommitted}
				?readonly=${this.isUncommitted && mode !== 'wip'}
				path="${file.path}"
				repo="${file.repoPath}"
				?staged=${file.staged}
				status="${file.status}"
			></file-change-list-item>
		`;
	}

	protected renderRepoChangedFiles(repoChanges: RepoChangeSet[]) {
		const layout = this.preferences?.files?.layout ?? 'auto';
		const items: (TemplateResult<1> | undefined)[] = [];

		for (const repoChange of repoChanges) {
			const { repoName, repoUri, change, checked } = repoChange;
			const checkedWithDefault = checked ?? false;
			const isChecked = checkedWithDefault !== false;
			items.push(
				html`<list-item
					tree
					branch
					hide-icon
					checkable
					.checked=${isChecked}
					@list-item-checked=${(e: CustomEvent<{ checked: boolean }>) => this.onRepositoryChecked(e, repoUri)}
					>${repoName}</list-item
				>`,
			);

			if (change == null) {
				items.push(html`<list-item level="2" hide-icon>Loading...</list-item>`);
				continue;
			}

			const files = change.files;
			if (files == null || files.length === 0) {
				items.push(html`<list-item level="2" hide-icon>No Files</list-item>`);
				continue;
			}

			let isTree = false;
			if (this.preferences != null && files != null) {
				if (layout === 'auto') {
					isTree = files.length > (this.preferences.files?.threshold ?? 5);
				} else {
					isTree = layout === 'tree';
				}
			}
			if (isTree) {
				items.push(
					...this.renderFileTree(repoChange.type, files, { repoUri: repoUri, checked: checkedWithDefault }),
				);
			} else {
				items.push(
					...this.renderFileList(repoChange.type, files, { repoUri: repoUri, checked: checkedWithDefault }),
				);
			}
		}

		return items;
	}

	protected renderRepoChangedPane(subtitle?: TemplateResult<1>) {
		const layout = this.preferences?.files?.layout ?? 'auto';

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		if (this.preferences != null && this.files != null) {
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

		const changedFileTemplates = this.repoChanges != null ? this.renderRepoChangedFiles(this.repoChanges) : [];
		return html`
			<webview-pane collapsable expanded>
				<span slot="title">Files changed</span>
				<span slot="subtitle" data-region="stats">${subtitle}</span>
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
						changedFileTemplates.length > 0,
						() =>
							html`<list-container class="indentGuides-${this.preferences?.indentGuides}"
								>${changedFileTemplates}</list-container
							>`,
						() => html`<div class="section"><p>${this.emptyText}</p></div>`,
					)}
				</div>
			</webview-pane>
		`;
	}

	protected renderChangedFiles(mode: Mode, subtitle?: TemplateResult<1>) {
		const layout = this.preferences?.files?.layout ?? 'auto';

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		let isTree = false;
		if (this.preferences != null && this.files != null) {
			if (layout === 'auto') {
				isTree = this.files.length > (this.preferences.files?.threshold ?? 5);
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
				<span slot="subtitle" data-region="stats">${subtitle}</span>
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
						this.files == null,
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
						() =>
							when(
								this.files!.length > 0,
								() =>
									isTree
										? this.renderFileTree(mode, this.files!)
										: this.renderFileList(mode, this.files!),
								() => html`<div class="section"><p>${this.emptyText}</p></div>`,
							),
					)}
				</div>
			</webview-pane>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}

	onRepositoryChecked(e: CustomEvent<{ checked: boolean }>, repoUri: string) {
		console.log('onRepositoryChecked', repoUri, e.detail.checked);

		this.dispatchEvent(
			new CustomEvent<{ repoUri: string; checked: boolean }>('changeset-repo-checked', {
				detail: { repoUri: repoUri, checked: e.detail.checked },
			}),
		);
	}

	onUnstagedChecked(e: CustomEvent<{ checked: boolean }>, repoUri: string) {
		const checked = e.detail.checked === true ? true : 'staged';
		console.log('onUnstagedChecked', repoUri, checked);

		this.dispatchEvent(
			new CustomEvent<{ repoUri: string; checked: boolean | 'staged' }>('changeset-unstaged-checked', {
				detail: { repoUri: repoUri, checked: checked },
			}),
		);
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
