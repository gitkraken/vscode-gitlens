import { attr, css, customElement, FASTElement, html, ref, volatile, when } from '@microsoft/fast-element';
import type { TextDocumentShowOptions } from 'vscode';
import { numberConverter } from '../converters/number-converter';
import type { ListItem } from './list-item';
import './list-item';
import '../codicon';

export interface FileChangeListItemDetail {
	path: string;
	repoPath: string;
	showOptions?: TextDocumentShowOptions;
}

// TODO: "change-list__action" should be a separate component
const template = html<FileChangeListItem>`
	<list-item
		${ref('base')}
		tree="${x => x.tree}"
		level="${x => x.level}"
		active="${x => x.active}"
		expanded="${x => x.expanded}"
		parentexpanded="${x => x.parentexpanded}"
		@selected="${(x, c) => x.onComparePrevious(c.event)}"
	>
		<img slot="icon" src="${x => x.icon}" title="${x => x.statusName}" alt="${x => x.statusName}" />
		${x => x.fileName}
		${when(x => !x.tree, html<FileChangeListItem>`<span slot="description">${x => x.filePath}</span>`)}
		<span slot="actions">
			<a
				class="change-list__action"
				@click="${(x, c) => x.onOpenFile(c.event)}"
				href="#"
				title="Open file"
				aria-label="Open file"
				><code-icon icon="go-to-file"></code-icon
			></a>
			${when(
				x => !x.uncommitted,
				html<FileChangeListItem>`
					<a
						class="change-list__action"
						@click="${(x, c) => x.onCompareWorking(c.event)}"
						href="#"
						title="Open Changes with Working File"
						aria-label="Open Changes with Working File"
						><code-icon icon="git-compare"></code-icon
					></a>
					${when(
						x => !x.stash,
						html<FileChangeListItem>`<a
								class="change-list__action"
								@click="${(x, c) => x.onOpenFileOnRemote(c.event)}"
								href="#"
								title="Open on remote"
								aria-label="Open on remote"
								><code-icon icon="globe"></code-icon></a
							><a
								class="change-list__action"
								@click="${(x, c) => x.onMoreActions(c.event)}"
								href="#"
								title="Show more actions"
								aria-label="Show more actions"
								><code-icon icon="ellipsis"></code-icon
							></a>`,
					)}
				`,
			)}
		</span>
	</list-item>
`;

const styles = css`
	.change-list__action {
		box-sizing: border-box;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.25em;
		color: inherit;
		padding: 2px;
		vertical-align: text-bottom;
		text-decoration: none;
	}
	.change-list__action:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.change-list__action:hover {
		background-color: var(--vscode-toolbar-hoverBackground);
	}
	.change-list__action:active {
		background-color: var(--vscode-toolbar-activeBackground);
	}
`;

// TODO: use the model version
const statusTextMap: Record<string, string> = {
	'.': 'Unchanged',
	'!': 'Ignored',
	'?': 'Untracked',
	A: 'Added',
	D: 'Deleted',
	M: 'Modified',
	R: 'Renamed',
	C: 'Copied',
	AA: 'Conflict',
	AU: 'Conflict',
	UA: 'Conflict',
	DD: 'Conflict',
	DU: 'Conflict',
	UD: 'Conflict',
	UU: 'Conflict',
	T: 'Modified',
	U: 'Updated but Unmerged',
};

@customElement({ name: 'file-change-list-item', template: template, styles: styles })
export class FileChangeListItem extends FASTElement {
	base?: ListItem;

	@attr({ mode: 'boolean' })
	tree = false;

	@attr({ mode: 'boolean' })
	expanded = true;

	@attr({ mode: 'boolean' })
	parentexpanded = true;

	@attr({ converter: numberConverter })
	level = 1;

	@attr({ mode: 'boolean' })
	active = false;

	@attr({ mode: 'boolean' })
	stash = false;

	@attr({ mode: 'boolean' })
	uncommitted = false;

	@attr
	icon = '';

	@attr
	path = '';

	@attr
	repo = '';

	@attr
	status = '';

	select(showOptions?: TextDocumentShowOptions) {
		this.base?.select(showOptions);
	}

	override focus(options?: FocusOptions | undefined): void {
		this.base?.focus(options);
	}

	get isHidden() {
		return this.base?.isHidden ?? 'false';
	}

	get pathIndex() {
		return this.path.lastIndexOf('/');
	}

	@volatile
	get fileName() {
		return this.pathIndex > -1 ? this.path.substring(this.pathIndex + 1) : this.path;
	}

	@volatile
	get filePath() {
		return !this.tree && this.pathIndex > -1 ? this.path.substring(0, this.pathIndex) : '';
	}

	get statusName() {
		return this.status !== '' ? statusTextMap[this.status] : '';
	}

	private getEventDetail(showOptions?: TextDocumentShowOptions): FileChangeListItemDetail {
		return {
			path: this.path,
			repoPath: this.repo,
			showOptions: showOptions,
		};
	}

	onOpenFile(e: Event) {
		e.preventDefault();
		this.$emit('file-open', this.getEventDetail());
	}

	onOpenFileOnRemote(e: Event) {
		e.preventDefault();
		this.$emit('file-open-on-remote', this.getEventDetail());
	}

	onCompareWorking(e: Event) {
		e.preventDefault();
		this.$emit('file-compare-working', this.getEventDetail());
	}

	onComparePrevious(e?: Event, showOptions?: TextDocumentShowOptions) {
		e?.preventDefault();
		this.$emit('file-compare-previous', this.getEventDetail(showOptions));
	}

	onMoreActions(e: Event) {
		e.preventDefault();
		this.$emit('file-more-actions', this.getEventDetail());
	}
}
