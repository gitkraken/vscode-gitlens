import { consume } from '@lit/context';
import { Task } from '@lit/task';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { State } from '../../../../plus/graph/protocol';
import { DidChangeNotification, GetCountsRequest } from '../../../../plus/graph/protocol';
import { ipcContext } from '../../../shared/contexts/ipc';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';
import { emitTelemetrySentEvent } from '../../../shared/telemetry';
import { stateContext } from '../context';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/tooltip';

interface Icon {
	type: IconTypes;
	icon: string;
	command: string;
	tooltip: string;
}
type IconTypes = 'branches' | 'remotes' | 'stashes' | 'tags' | 'worktrees';
const icons: Icon[] = [
	{ type: 'branches', icon: 'gl-branches-view', command: 'gitlens.showBranchesView', tooltip: 'Branches' },
	{ type: 'remotes', icon: 'gl-remotes-view', command: 'gitlens.showRemotesView', tooltip: 'Remotes' },
	{ type: 'stashes', icon: 'gl-stashes-view', command: 'gitlens.showStashesView', tooltip: 'Stashes' },
	{ type: 'tags', icon: 'gl-tags-view', command: 'gitlens.showTagsView', tooltip: 'Tags' },
	{ type: 'worktrees', icon: 'gl-worktrees-view', command: 'gitlens.showWorktreesView', tooltip: 'Worktrees' },
];

type Counts = Record<IconTypes, number | undefined>;

@customElement('gl-graph-sidebar')
export class GlGraphSideBar extends LitElement {
	static override styles = css`
		.sidebar {
			box-sizing: border-box;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 1.4rem;
			background-color: var(--color-graph-background);
			color: var(--titlebar-fg);
			width: 2.6rem;
			font-size: 9px;
			font-weight: 600;
			height: 100%;
			padding: 3rem 0;
			z-index: 1040;
		}

		.item {
			color: inherit;
			text-decoration: none;
			display: flex;
			flex-direction: column;
			align-items: center;
			cursor: pointer;
		}

		.item:hover {
			color: var(--color-foreground);
			text-decoration: none;
		}

		.count {
			color: var(--color-foreground--50);
			/* color: var(--color-highlight); */
			margin-top: 0.4rem;
		}

		.count.error {
			color: var(--vscode-errorForeground);
			opacity: 0.6;
		}
	`;

	get include(): undefined | IconTypes[] {
		const repo = this._state.repositories?.find(item => item.path === this._state.selectedRepository);
		return repo?.isVirtual
			? (['branches', 'remotes', 'tags'] as const)
			: (['branches', 'remotes', 'tags', 'stashes', 'worktrees'] as const);
	}

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;

	@consume({ context: stateContext, subscribe: true })
	private readonly _state!: State;

	private _disposable: Disposable | undefined;
	private _countsTask = new Task(this, {
		args: () => [this.fetchCounts()],
		task: ([counts]) => counts,
		autoRun: false,
	});

	override connectedCallback(): void {
		super.connectedCallback();

		this._disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeNotification.is(msg):
					this._counts = undefined;
					this.requestUpdate();
					break;

				case GetCountsRequest.response.is(msg):
					this._counts = Promise.resolve(msg.params as Counts);
					this.requestUpdate();
					break;
			}
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this._disposable?.dispose();
	}

	private _counts: Promise<Counts | undefined> | undefined;
	private async fetchCounts() {
		if (this._counts == null) {
			const ipc = this._ipc;
			if (ipc != null) {
				async function fetch() {
					const rsp = await ipc.sendRequest(GetCountsRequest, undefined);
					return rsp as Counts;
				}
				this._counts = fetch();
			} else {
				this._counts = Promise.resolve(undefined);
			}
		}
		return this._counts;
	}

	override render(): unknown {
		if (this._counts == null) {
			void this._countsTask.run();
		}

		return html`<section class="sidebar">
			${repeat(
				icons,
				i => i,
				i => this.renderIcon(i),
			)}
		</section>`;
	}

	private renderIcon(icon: Icon) {
		if (this.include != null && !this.include.includes(icon.type)) return;

		return html`<gl-tooltip placement="right" content="${icon.tooltip}">
			<a class="item" href="command:${icon.command}" @click=${() => this.sendTelemetry(icon.command)}>
				<code-icon icon="${icon.icon}"></code-icon>
				${this._countsTask.render({
					pending: () =>
						html`<span class="count"
							><code-icon icon="loading" modifier="spin" size="9"></code-icon
						></span>`,
					complete: c => renderCount(c?.[icon.type]),
					error: () => html`<span class="count error"><code-icon icon="warning" size="9"></code-icon></span>`,
				})}
			</a>
		</gl-tooltip>`;
	}

	private sendTelemetry(command: string) {
		emitTelemetrySentEvent<'graph/action/sidebar'>(this, {
			name: 'graph/action/sidebar',
			data: { action: command },
		});
	}
}

function renderCount(count: number | undefined) {
	if (count == null) return nothing;

	return html`<span class="count">${count > 999 ? '1K+' : String(count)}</span>`;
}
