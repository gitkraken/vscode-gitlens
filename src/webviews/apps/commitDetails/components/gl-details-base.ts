import type { TemplateResult } from 'lit';
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import type { HierarchicalItem } from '../../../../system/array';
import { makeHierarchical } from '../../../../system/array';
import type { Preferences, State } from '../../../commitDetails/protocol';

type Files = Mutable<NonNullable<NonNullable<State['commit']>['files']>>;
type File = Files[0];
type Mode = 'commit' | 'stash' | 'wip';

export class GlDetailsBase extends LitElement {
	@property({ type: Array })
	files?: Files;

	@property({ type: Boolean })
	isUncommitted = false;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ attribute: 'empty-text' })
	emptyText? = 'No Files';

	private renderFileList(mode: Mode, files: Files) {
		let items;
		let classes;

		if (this.isUncommitted) {
			items = [];
			classes = `indentGuides-${this.preferences?.indentGuides}`;

			const staged = files.filter(f => f.staged);
			if (staged.length) {
				items.push(html`<list-item tree branch hide-icon>Staged Changes</list-item>`);

				for (const f of staged) {
					items.push(this.renderFile(mode, f, 2, true));
				}
			}

			const unstaged = files.filter(f => !f.staged);
			if (unstaged.length) {
				items.push(html`<list-item tree branch hide-icon>Unstaged Changes</list-item>`);

				for (const f of unstaged) {
					items.push(this.renderFile(mode, f, 2, true));
				}
			}
		} else {
			items = files.map(f => this.renderFile(mode, f));
		}

		return html`<list-container class=${ifDefined(classes)}>${items}</list-container>`;
	}

	private renderFileTree(mode: Mode, files: Files) {
		const compact = this.preferences?.files?.compact ?? true;

		let items;

		if (this.isUncommitted) {
			items = [];

			const staged = files.filter(f => f.staged);
			if (staged.length) {
				items.push(html`<list-item tree branch hide-icon>Staged Changes</list-item>`);
				items.push(...this.renderFileSubtree(mode, staged, 1, compact));
			}

			const unstaged = files.filter(f => !f.staged);
			if (unstaged.length) {
				items.push(html`<list-item tree branch hide-icon>Unstaged Changes</list-item>`);
				items.push(...this.renderFileSubtree(mode, unstaged, 1, compact));
			}
		} else {
			items = this.renderFileSubtree(mode, files, 0, compact);
		}

		return html`<list-container class="indentGuides-${this.preferences?.indentGuides}">${items}</list-container>`;
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
