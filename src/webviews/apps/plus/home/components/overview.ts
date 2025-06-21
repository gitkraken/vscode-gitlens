import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GetInactiveOverviewResponse, OverviewRecentThreshold, State } from '../../../../home/protocol';
import { SetOverviewFilter } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { ipcContext } from '../../../shared/contexts/ipc';
import type { HostIpc } from '../../../shared/ipc';
import { linkStyles } from '../../shared/components/vscode.css';
import type { InactiveOverviewState } from './overviewState';
import { inactiveOverviewStateContext } from './overviewState';
import '../../../shared/components/skeleton-loader';
import './branch-threshold-filter';

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
		super.connectedCallback?.();

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

	private readonly onChangeRecentThresholdFilter = (e: CustomEvent<{ threshold: OverviewRecentThreshold }>) => {
		if (!this._inactiveOverviewState.filter.stale || !this._inactiveOverviewState.filter.recent) {
			return;
		}
		this._ipc.sendCommand(SetOverviewFilter, {
			stale: this._inactiveOverviewState.filter.stale,
			recent: { ...this._inactiveOverviewState.filter.recent, threshold: e.detail.threshold },
		});
	};

	private renderComplete(overview: GetInactiveOverviewResponse, isFetching = false) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<gl-branch-section
				label="recent"
				.isFetching=${isFetching}
				.repo=${repository.path}
				.branches=${overview.recent}
			>
				<gl-branch-threshold-filter
					slot="heading-actions"
					@gl-change=${this.onChangeRecentThresholdFilter}
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
