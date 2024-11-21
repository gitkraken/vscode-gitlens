import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GetOverviewResponse, OverviewRecentThreshold, State } from '../../../../home/protocol';
import { SetOverviewFilter } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { ipcContext } from '../../../shared/context';
import type { HostIpc } from '../../../shared/ipc';
import { linkStyles } from '../../shared/components/vscode.css';
import type { OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/skeleton-loader';
import './branch-threshold-filter';

type Overview = GetOverviewResponse;

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

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		if (this._homeState.repositories.openCount > 0) {
			this._overviewState.run();
		}
	}

	override render() {
		if (this._homeState.discovering) {
			return this.renderLoader();
		}

		if (this._homeState.repositories.openCount === 0) {
			return nothing;
		}

		return this._overviewState.render({
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
		if (this._overviewState.state == null) {
			return this.renderLoader();
		}
		return this.renderComplete(this._overviewState.state, true);
	}

	@consume({ context: ipcContext })
	private readonly _ipc!: HostIpc;

	private onChangeRecentThresholdFilter(e: CustomEvent<{ threshold: OverviewRecentThreshold }>) {
		if (!this._overviewState.filter.stale || !this._overviewState.filter.recent) {
			return;
		}
		this._ipc.sendCommand(SetOverviewFilter, {
			stale: this._overviewState.filter.stale,
			recent: { ...this._overviewState.filter.recent, threshold: e.detail.threshold },
		});
	}

	private renderComplete(overview: Overview, isFetching = false) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<gl-branch-section
				label="recent"
				.isFetching=${isFetching}
				.repo=${repository.path}
				.branches=${repository.branches.recent}
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
					.value=${this._overviewState.filter.recent?.threshold}
				></gl-branch-threshold-filter>
			</gl-branch-section>
			${when(
				this._overviewState.filter.stale?.show === true,
				() => html`
					<gl-branch-section
						label="stale"
						.repo=${repository.path}
						.branches=${repository.branches.stale}
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
