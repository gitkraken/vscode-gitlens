import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { FileShowOptions } from '../../../../commitDetails/protocol';
import '../codicon';

export interface FileChangeItemEventDetail {
	path: string;
	repoPath: string;
	showOptions?: FileShowOptions;
}

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

// TODO: use the model version
const statusCodiconsMap: Record<string, string | undefined> = {
	'.': undefined,
	'!': 'diff-ignored',
	'?': 'diff-added',
	A: 'diff-added',
	D: 'diff-removed',
	M: 'diff-modified',
	R: 'diff-renamed',
	C: 'diff-added',
	AA: 'warning',
	AU: 'warning',
	UA: 'warning',
	DD: 'warning',
	DU: 'warning',
	UD: 'warning',
	UU: 'warning',
	T: 'diff-modified',
	U: 'diff-modified',
};

@customElement('file-change-item')
export class FileChangeItem extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			font-size: var(--vscode-font-size);
			line-height: 2rem;
			color: var(--vscode-sideBar-foreground);
		}
		:host(:hover) {
			color: var(--vscode-list-hoverForeground);
			background-color: var(--vscode-list-hoverBackground);
		}

		:host(:focus-within) {
			outline: 1px solid var(--vscode-list-focusOutline);
			outline-offset: -1px;
			color: var(--vscode-list-activeSelectionForeground);
			background-color: var(--vscode-list-activeSelectionBackground);
		}

		* {
			box-sizing: border-box;
		}

		.change-list__link {
			width: 100%;
			color: inherit;
			white-space: nowrap;
			text-overflow: ellipsis;
			overflow: hidden;
			text-decoration: none;
			outline: none;
		}

		.change-list__status {
			margin-right: 0.6rem;
		}

		.change-list__status-icon {
			width: 16px;
			aspect-ratio: 1;
			vertical-align: text-bottom;
		}

		.change-list__path {
			opacity: 0.7;
			margin-left: 0.3rem;
		}

		.change-list__actions {
			flex: none;
			user-select: none;
			display: flex;
			align-items: center;
			color: var(--vscode-icon-foreground);
		}

		:host(:focus-within) .change-list__actions {
			color: var(--vscode-list-activeSelectionIconForeground);
		}

		:host(:not(:hover):not(:focus-within)) .change-list__actions {
			display: none;
		}

		.change-list__action {
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

	@property()
	status = '';

	@property()
	path = '';

	@property({ attribute: 'repo-path' })
	repoPath = '';

	@property()
	icon = '';

	@property({ type: Boolean, reflect: true })
	stash = false;

	@property({ type: Boolean, reflect: true })
	uncommitted = false;

	private renderIcon() {
		if (this.icon !== '') {
			return html`<img class="change-list__status-icon" src="${this.icon}" />`;
		}

		const statusIcon = (this.status !== '' && statusCodiconsMap[this.status]) ?? 'file';
		return html` <code-icon icon="${statusIcon}"></code-icon> `;
	}

	override focus(options?: FocusOptions | undefined): void {
		this.shadowRoot?.getElementById('item')?.focus(options);
	}

	open(showOptions?: FileShowOptions): void {
		this.onComparePrevious(undefined, showOptions);
	}

	override render() {
		const statusName = this.status !== '' ? statusTextMap[this.status] : '';
		const pathIndex = this.path.lastIndexOf('/');
		const fileName = pathIndex > -1 ? this.path.substring(pathIndex + 1) : this.path;
		const filePath = pathIndex > -1 ? this.path.substring(0, pathIndex) : '';

		return html`
			<a id="item" class="change-list__link" @click=${this.onComparePrevious} href="#">
				<span class="change-list__status" title="${statusName}" aria-label="${statusName}"
					>${this.renderIcon()}</span
				><span class="change-list__filename">${fileName}</span>
				<small class="change-list__path">${filePath}</small>
			</a>
			<nav class="change-list__actions">
				<a
					class="change-list__action"
					@click=${this.onOpenFile}
					href="#"
					title="Open file"
					aria-label="Open file"
					><code-icon icon="go-to-file"></code-icon></a
				>${!this.uncommitted ? html`<a
					class="change-list__action"
					@click=${this.onCompareWorking}
					href="#"
					title="Open Changes with Working File"
					aria-label="Open Changes with Working File"
					><code-icon icon="git-compare"></code-icon></a
				>` : nothing}${!this.stash && !this.uncommitted
					? html`<a
								class="change-list__action"
								@click=${this.onOpenFileOnRemote}
								href="#"
								title="Open on remote"
								aria-label="Open on remote"
								><code-icon icon="globe"></code-icon></a
							><a
								class="change-list__action"
								@click=${this.onMoreActions}
								href="#"
								title="Show more actions"
								aria-label="Show more actions"
								><code-icon icon="ellipsis"></code-icon
							></a>`
					: nothing}
			</nav>
		`;
	}

	private onOpenFile(e: Event) {
		e.preventDefault();
		this.fireEvent('file-open');
	}

	private onOpenFileOnRemote(e: Event) {
		e.preventDefault();
		this.fireEvent('file-open-on-remote');
	}

	private onCompareWorking(e: Event) {
		e.preventDefault();
		this.fireEvent('file-compare-working');
	}

	private onComparePrevious(e?: Event, showOptions?: FileShowOptions) {
		e?.preventDefault();
		this.fireEvent('file-compare-previous', showOptions);
	}

	private onMoreActions(e: Event) {
		e.preventDefault();
		this.fireEvent('file-more-actions');
	}

	private fireEvent(eventName: string, showOptions?: FileShowOptions) {
		const event = new CustomEvent<FileChangeItemEventDetail>(eventName, {
			detail: {
				path: this.path,
				repoPath: this.repoPath,
				showOptions: showOptions,
			},
			bubbles: true,
			composed: true,
		});
		this.dispatchEvent(event);
	}
}
