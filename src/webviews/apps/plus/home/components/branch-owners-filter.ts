// unused now
import { consume } from '@lit/context';
import { Task } from '@lit/task';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import { IterUtils } from '../../../../../system/iterable';
import { pluralize } from '../../../../../system/string';
import type { RepoOwner } from '../../../../home/protocol';
import { GetRepoOwners } from '../../../../home/protocol';
import '../../../shared/components/checkbox/checkbox';
import '../../../shared/components/code-icon';
import { GlElement } from '../../../shared/components/element';
import '../../../shared/components/menu/index';
import '../../../shared/components/menu/menu-item';
import '../../../shared/components/menu/menu-list';
import '../../../shared/components/overlays/popover';
import { ipcContext } from '../../../shared/context';
import type { HostIpc } from '../../../shared/ipc';

@customElement('gl-branch-owner-filter')
export class GlBranchOwnerFilter extends GlElement {
	static override readonly styles = [
		// should be shared with other filters
		css`
			.owner-filter:focus {
				outline: 1px solid;
			}
			.owner-filter {
				background: none;
				outline: none;
				border: none;
				cursor: pointer;
				color: var(--vscode-disabledForeground);
				text-decoration: none !important;
				font-weight: 500;
			}
			.owner-filter:hover {
				color: var(--vscode-foreground);
				text-decoration: underline !important;
			}
			.owner-item {
				display: flex;
				flex-direction: column;
				gap: 2px;
			}
			.owner-label {
				display: flex;
				gap: 4px;
				align-items: center;
			}
			.owner-email {
				color: var(--vscode-disabledForeground);
			}
			.current {
				display: inline-block;
				padding: 0px 2px;
				background: var(--vscode-disabledForeground);
				border-radius: 2px;
			}
		`,
	];

	@property({ type: Array }) filter: RepoOwner[] | undefined;
	@consume({ context: ipcContext })
	private readonly _ipc!: HostIpc;

	private renderOwnerFilterLabel() {
		console.log('test', this.filter);
		if (!this.filter?.length) {
			return 'By all users';
		}

		const additionalLabel = this.filter.length > 1 ? ` and ${pluralize('other', this.filter.length - 1)}` : '';
		if (this.filter.some(x => x.current)) {
			return `By me${additionalLabel}`;
		}
		return `By ${this.filter[0].label}${additionalLabel}`;
	}
	private readonly _getOwners = new Task(this, {
		task: async () => {
			return this._ipc.sendRequest(GetRepoOwners, undefined);
		},
	});

	private renderOwnerItem(owner: RepoOwner) {
		return html`<div class="owner-item">
      <div class="owner-label">
      ${when(owner.avatarSrc, src => html`<gl-avatar src=${src}></gl-avatar>`)}</gl-avatar>
      <span>${owner.label}</span>
      ${when(owner.current, () => html`<span class="current">current</span>`)}
    </div>
    ${when(owner.email, email => html`<span class="owner-email">${email}</span>`)}</gl-avatar>
    </div>`;
	}

	@state()
	ownerQuery: string = '';

	private filterState: Record<string, boolean> = {};
	private renderOwnerList(ownerList: undefined | RepoOwner[]) {
		if (!ownerList) {
			return html`<p>No available owners</p>`;
		}

		return html` <input
				value=${this.ownerQuery}
				@input=${(e: Event) => {
					this.ownerQuery = (e.target as HTMLInputElement | null)?.value ?? '';
				}}
			/>
			${repeat(
				ownerList.filter(
					x => !this.ownerQuery || x.label.includes(this.ownerQuery) || x.email?.includes(this.ownerQuery),
				),
				item =>
					html`<menu-item role="none"
						><gl-checkbox
							@gl-change-value=${() => {
								if (!item.email) {
									return;
								}
								this.filterState[item.email] = !this.filterState[item.email];
							}}
							?disabled=${!item.email}
							?checked=${this.filter?.some(x => x.email === item.email)}
							>${this.renderOwnerItem(item)}</gl-checkbox
						></menu-item
					>`,
			)}
			<menu-item
				@click=${() => {
					this.setOwnersFilter(
						Object.keys(this.filterState)
							.filter(x => this.filterState[x])
							.map(email => this._getOwners.value?.find(x => x.email === email))
							.filter(IterUtils.notNull),
					);
				}}
				>Apply</menu-item
			>
			<menu-item
				@click=${() => {
					this.setOwnersFilter([]);
				}}
				>Clear</menu-item
			>`;
	}

	private setOwnersFilter(ownersList: RepoOwner[]) {
		const event = new CustomEvent('owners-filter-change', {
			detail: { ownersList: ownersList },
		});
		this.dispatchEvent(event);
	}

	override render() {
		return html`
			<gl-popover
				placement="bottom-start"
				trigger="focus"
				@gl-popover-show=${() => {
					this.ownerQuery = '';
					this.filterState = {};
					this.filter?.forEach(x => x.email && (this.filterState[x.email] = true));
					void this._getOwners.run();
				}}
				?arrow=${false}
			>
				<button type="button" slot="anchor" class="owner-filter">
					${this.renderOwnerFilterLabel()}<code-icon icon="chevron-down"></code-icon>
				</button>

				<div slot="content">
					${this._getOwners.render({
						initial: () => html`<menu-item>Waiting to get owners</menu-item>`,
						pending: () => html`<p>Getting repo owners</p>`,
						complete: this.renderOwnerList.bind(this),
						error: error => html`<p>Oops, something went wrong: ${error}</p>`,
					})}
				</div>
			</gl-popover>
		`;
	}
}
