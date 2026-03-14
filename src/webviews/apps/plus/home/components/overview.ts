import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GetInactiveOverviewResponse, OverviewRecentThreshold } from '../../../../home/protocol.js';
import type { HomeState } from '../../../home/state.js';
import { homeStateContext } from '../../../home/state.js';
import { linkStyles } from '../../shared/components/vscode.css.js';
import type { InactiveOverviewState } from './overviewState.js';
import { inactiveOverviewStateContext } from './overviewState.js';
import '../../../shared/components/skeleton-loader.js';
import './branch-threshold-filter.js';

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

	@consume({ context: homeStateContext })
	private _homeCtx!: HomeState;

	@consume({ context: inactiveOverviewStateContext })
	private _inactiveOverviewState!: InactiveOverviewState;

	override connectedCallback(): void {
		super.connectedCallback?.();

		if (this._homeCtx.repositories.get().openCount > 0) {
			this._inactiveOverviewState.fetch();
		}
	}

	override render(): unknown {
		if (this._homeCtx.discovering.get()) {
			return this.renderLoader();
		}

		if (this._homeCtx.repositories.get().openCount === 0) {
			return nothing;
		}

		if (this._inactiveOverviewState.error.get() != null) {
			return html`
				<gl-section>
					<span slot="heading">Recent</span>
					<span
						>Unable to load branch data.
						<a
							href="#"
							@click=${(e: Event) => {
								e.preventDefault();
								this._inactiveOverviewState.fetch();
							}}
							>Retry</a
						>
					</span>
				</gl-section>
			`;
		}

		const overview = this._inactiveOverviewState.value.get();
		if (overview == null) {
			return this.renderLoader();
		}

		return this.renderComplete(overview, this._inactiveOverviewState.loading.get());
	}

	private renderLoader() {
		return html`
			<gl-section>
				<skeleton-loader slot="heading" lines="1"></skeleton-loader>
				<skeleton-loader lines="3"></skeleton-loader>
			</gl-section>
		`;
	}

	private readonly onChangeRecentThresholdFilter = (e: CustomEvent<{ threshold: OverviewRecentThreshold }>) => {
		if (!this._inactiveOverviewState.filter.stale || !this._inactiveOverviewState.filter.recent) {
			return;
		}
		void this._homeCtx.homeService?.setOverviewFilter({
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
