import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { GetOverviewResponse, OverviewRecentThreshold } from '../../../../home/protocol';
import { SetOverviewFilter } from '../../../../home/protocol';
import { ipcContext } from '../../../shared/context';
import type { HostIpc } from '../../../shared/ipc';
import { sectionHeadingStyles } from './branch-section';
import type { OverviewState } from './overviewState';
import { overviewStateContext } from './overviewState';
import '../../../shared/components/skeleton-loader';
import './branch-threshold-filter';

type Overview = GetOverviewResponse;

export const overviewTagName = 'gl-overview';

@customElement(overviewTagName)
export class GlOverview extends SignalWatcher(LitElement) {
	static override styles = [
		sectionHeadingStyles,
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}
			.repository {
				color: var(--vscode-foreground);
			}
		`,
	];

	@consume({ context: overviewStateContext })
	private _overviewState!: OverviewState;

	override connectedCallback() {
		super.connectedCallback();

		this._overviewState.run();
	}

	override render() {
		return this._overviewState.render({
			pending: () => this.renderPending(),
			complete: summary => this.renderComplete(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderPending() {
		if (this._overviewState.state == null) {
			return html`
				<h3 class="section-heading">Recent</h3>
				<skeleton-loader lines="3"></skeleton-loader>
			`;
		}
		return this.renderComplete(this._overviewState.state);
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

	private renderComplete(overview: Overview) {
		if (overview == null) return nothing;
		const { repository } = overview;
		return html`
			<div class="repository">
				<gl-branch-section
					label="Recent (${repository.branches.recent.length})"
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
						.value=${this._overviewState.filter.recent?.threshold}
					></gl-branch-threshold-filter>
				</gl-branch-section>
				<gl-branch-section
					hidden
					label="Stale (${repository.branches.stale.length})"
					.branches=${repository.branches.stale}
				></gl-branch-section>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[overviewTagName]: GlOverview;
	}
}
