import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { TextDocumentShowOptions } from 'vscode';
import type { ListItem, ListItemSelectedEvent } from './list-item';
import '../code-icon';

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

export interface FileChangeListItemDetail {
	path: string;
	repoPath: string;
	staged: boolean | undefined;

	showOptions?: TextDocumentShowOptions;
}

// TODO: "change-list__action" should be a separate component

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

@customElement('file-change-list-item')
export class FileChangeListItem extends LitElement {
	static override styles = css`
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

	@query('list-item')
	baseRef!: ListItem;

	@property({ type: Boolean })
	tree = false;

	@property({ type: Boolean, reflect: true })
	expanded = true;

	@property({ type: Boolean, reflect: true })
	parentexpanded = true;

	@property({ type: Number })
	level = 1;

	@property({ type: Boolean })
	active = false;

	@property({ type: Boolean })
	stash = false;

	@property({ type: Boolean })
	uncommitted = false;

	@property({ type: String })
	icon = '';

	@property({ type: String })
	path = '';

	@property({ type: String })
	repo = '';

	@property({ type: Boolean })
	staged = false;

	@property({ type: String })
	status = '';

	select(showOptions?: TextDocumentShowOptions) {
		this.baseRef.select(showOptions);
	}

	deselect() {
		this.baseRef.deselect();
	}

	override focus(options?: FocusOptions | undefined): void {
		this.baseRef.focus(options);
	}

	@state()
	get isHidden() {
		return this.baseRef.isHidden ?? 'false';
	}

	@state()
	get pathIndex() {
		return this.path.lastIndexOf('/');
	}

	@state()
	get fileName() {
		return this.pathIndex > -1 ? this.path.substring(this.pathIndex + 1) : this.path;
	}

	@state()
	get filePath() {
		return !this.tree && this.pathIndex > -1 ? this.path.substring(0, this.pathIndex) : '';
	}

	@state()
	get statusName() {
		return this.status !== '' ? statusTextMap[this.status] : '';
	}

	override render() {
		return html`
			<list-item
				?tree=${this.tree}
				level=${this.level}
				?active=${this.active}
				?expanded=${this.expanded}
				?parentexpanded=${this.parentexpanded}
				@selected=${this.onComparePrevious}
			>
				<img slot="icon" .src=${this.icon} .title=${this.statusName} .alt=${this.statusName} />
				${this.fileName} ${this.tree ? nothing : html`<span slot="description">${this.filePath}</span>`}
				<span slot="actions">
					<a
						class="change-list__action"
						@click=${this.onOpenFile}
						href="#"
						title="Open file"
						aria-label="Open file"
					>
						<code-icon icon="go-to-file"></code-icon>
					</a>
					${this.uncommitted
						? nothing
						: html`
								<a
									class="change-list__action"
									@click=${this.onCompareWorking}
									href="#"
									title="Open Changes with Working File"
									aria-label="Open Changes with Working File"
								>
									<code-icon icon="git-compare"></code-icon>
								</a>
								${this.stash
									? nothing
									: html`
											<a
												class="change-list__action"
												@click=${this.onOpenFileOnRemote}
												href="#"
												title="Open on remote"
												aria-label="Open on remote"
											>
												<code-icon icon="globe"></code-icon>
											</a>
											<a
												class="change-list__action"
												@click=${this.onMoreActions}
												href="#"
												title="Show more actions"
												aria-label="Show more actions"
											>
												<code-icon icon="ellipsis"></code-icon>
											</a>
									  `}
						  `}
				</span>
			</list-item>
		`;
	}

	onOpenFile(e: MouseEvent) {
		const event = new CustomEvent('file-open', {
			detail: this.getEventDetail({ preview: false, viewColumn: e.altKey ? BesideViewColumn : undefined }),
		});
		this.dispatchEvent(event);
	}

	onOpenFileOnRemote(e: MouseEvent) {
		const event = new CustomEvent('file-open-on-remote', {
			detail: this.getEventDetail({ preview: false, viewColumn: e.altKey ? BesideViewColumn : undefined }),
		});
		this.dispatchEvent(event);
	}

	onCompareWorking(e: MouseEvent) {
		const event = new CustomEvent('file-compare-working', {
			detail: this.getEventDetail({ preview: false, viewColumn: e.altKey ? BesideViewColumn : undefined }),
		});
		this.dispatchEvent(event);
	}

	onComparePrevious(e: ListItemSelectedEvent) {
		const event = new CustomEvent('file-compare-previous', {
			detail: this.getEventDetail(e.detail.showOptions),
		});
		this.dispatchEvent(event);
	}

	onMoreActions(_e: MouseEvent) {
		const event = new CustomEvent('file-more-actions', {
			detail: this.getEventDetail(),
		});
		this.dispatchEvent(event);
	}

	private getEventDetail(showOptions?: TextDocumentShowOptions): FileChangeListItemDetail {
		return {
			path: this.path,
			repoPath: this.repo,
			staged: this.staged,
			showOptions: showOptions,
		};
	}
}
