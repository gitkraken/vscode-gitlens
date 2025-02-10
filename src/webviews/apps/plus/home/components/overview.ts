import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GetInactiveOverviewResponse, OverviewRecentThreshold, State } from '../../../../home/protocol';
import { SetOverviewFilter } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import '../../../shared/components/skeleton-loader';
import { ipcContext } from '../../../shared/context';
import type { HostIpc } from '../../../shared/ipc';
import { linkStyles } from '../../shared/components/vscode.css';
import type { GlBranchSection } from './branch-section';
import './branch-threshold-filter';
import type { InactiveOverviewState } from './overviewState';
import { inactiveOverviewStateContext } from './overviewState';

export const overviewTagName = 'gl-overview';

@customElement(overviewTagName)
export class GlOverview extends SignalWatcher(LitElement) {
	static override styles = [
		linkStyles,
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
				color: var(--vscode-foreground);
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _homeState!: State;

	@consume({ context: inactiveOverviewStateContext })
	private _inactiveOverviewState!: InactiveOverviewState;

	override connectedCallback(): void {
		super.connectedCallback();

		if (this._homeState.repositories.openCount > 0) {
			this._inactiveOverviewState.run();
		}
	}

	override render(): unknown {
		if (this._homeState.discovering) {
			return this.renderLoader();
		}

		if (this._homeState.repositories.openCount === 0) {
			return nothing;
		}

		return this._inactiveOverviewState.render({
			pending: () => this.renderPending(),
			complete: summary => this.renderComplete(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderLoader() {
		return html`
			<gl-section>
				<skeleton-loader slot="heading" lines="1"></skeleton-loader>
				<skeleton-loader lines="3"></skeleton-loader>
			</gl-section>
		`;
	}

	private renderPending() {
		if (this._inactiveOverviewState.state == null) {
			return this.renderLoader();
		}
		return this.renderComplete(this._inactiveOverviewState.state, true);
	}

	@consume({ context: ipcContext })
	private readonly _ipc!: HostIpc;

	private onChangeRecentThresholdFilter(e: CustomEvent<{ threshold: OverviewRecentThreshold }>) {
		if (!this._inactiveOverviewState.filter.stale || !this._inactiveOverviewState.filter.recent) {
			return;
		}
		this._ipc.sendCommand(SetOverviewFilter, {
			stale: this._inactiveOverviewState.filter.stale,
			recent: { ...this._inactiveOverviewState.filter.recent, threshold: e.detail.threshold },
		});
	}

	// TODO: can be moved to a separate function (maybe for home scope only)
	private applyContext(context: object) {
		const prevContext = JSON.parse(document.body.getAttribute('data-vscode-context') ?? '{}');
		document.body.setAttribute(
			'data-vscode-context',
			JSON.stringify({
				...prevContext,
				...context,
			}),
		);
		// clear context immediatelly after the contextmenu is opened to avoid randomly clicked contextmenu being filled
		setTimeout(() => {
			document.body.setAttribute('data-vscode-context', JSON.stringify(prevContext));
		});
	}

	private handleBranchContext(e: typeof GlBranchSection.OpenContextMenuEvent) {
		let context = 'gitlens:home';
		e.detail.items.forEach(x => {
			if (x.href) {
				context += `+${x.href}`;
			}
		});
		this.applyContext({ webviewItem: context, ...e.detail.branchRefs, type: 'branch' });
	}

	private renderComplete(overview: GetInactiveOverviewResponse, isFetching = false) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<gl-branch-section
				label="recent"
				.isFetching=${isFetching}
				.repo=${repository.path}
				.branches=${overview.recent}
				@branch-context-opened=${this.handleBranchContext}
			>
				<gl-branch-threshold-filter
					slot="heading-actions"
					@gl-change=${this.onChangeRecentThresholdFilter.bind(this)}
					.options=${[
						{ value: 'OneDay', label: '1 day' },
						{ value: 'OneWeek', label: '1 week' },
						{ value: 'OneMonth', label: '1 month' },
					] satisfies {
						value: OverviewRecentThreshold;
						label: string;
					}[]}
					.disabled=${isFetching}
					.value=${this._inactiveOverviewState.filter.recent?.threshold}
				></gl-branch-threshold-filter>
			</gl-branch-section>
			${when(
				this._inactiveOverviewState.filter.stale?.show === true && overview.stale,
				() => html`
					<gl-branch-section
						label="stale"
						.repo=${repository.path}
						.branches=${overview.stale!}
					></gl-branch-section>
				`,
			)}
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[overviewTagName]: GlOverview;
	}
}
