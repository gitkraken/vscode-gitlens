import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { srOnly } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { GroupableTreeViewTypes } from '../../../../constants.views.js';
import { groupableViewTypeLabels, groupableViewTypes, localOnlyGroupedViews } from '../../../../constants.views.js';
import type { SettingsActions } from '../actions.js';
import type { CheckDescriptor } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/checkbox/checkbox.js';
import '@gitlens/components/components/codeIcon.js';
import '../../shared/components/radio/radio.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-scm-views']: GlSettingsScmViews;
	}
}

/** Glicon per groupable view, keyed the same as {@link groupableViewTypes}. */
const viewIcons: Readonly<Record<GroupableTreeViewTypes, string>> = {
	commits: 'gl-commits-view',
	branches: 'gl-branches-view',
	remotes: 'gl-remotes-view',
	stashes: 'gl-stashes-view',
	tags: 'gl-tags-view',
	worktrees: 'gl-worktrees-view',
	contributors: 'gl-contributors-view',
	repositories: 'gl-repositories-view',
	searchAndCompare: 'gl-search-view',
	launchpad: 'gl-launchpad-view',
	fileHistory: 'gl-history-view',
};

/** Builds the ad hoc `type:'object'` descriptor `applyCheck` needs for one row's Group/Hide toggle. */
function objectCheckDescriptor(
	key: 'views.scm.grouped.views' | 'views.scm.grouped.hiddenViews',
	path: string,
	label: string,
): CheckDescriptor {
	return { kind: 'check', key: key, type: 'object', path: path, label: label };
}

/**
 * The "GitLens SCM" grouped-views editor — one row per groupable view with a
 * Group toggle, a Hide toggle, and a Default-view picker.
 *
 * Reuses the generic `applyCheck({type:'object'})` write for the two
 * `viewId → boolean` maps and `applyValue` for the scalar default — no new
 * apply family. Rows are derived from `groupableViewTypes`
 * (`constants.views.ts`), so the list can't hand-drift from the actual union.
 */
@customElement('gl-settings-scm-views')
export class GlSettingsScmViews extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		srOnly,
		css`
			:host {
				display: block;
			}

			.rows {
				display: grid;
				grid-template-columns: 1fr auto auto auto;
				gap: var(--gl-space-4) var(--gl-space-16);
				align-items: center;
			}

			.header {
				display: contents;
			}

			.header span {
				padding-block-end: var(--gl-space-4);
				font-size: 1.1rem;
				font-weight: 600;
				color: var(--color-foreground--65);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				border-block-end: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.row {
				display: contents;
			}

			.row__view {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding-block: var(--gl-space-6);
			}

			.row__view code-icon {
				flex: none;
				color: var(--color-foreground--65);
			}

			.row__note {
				display: block;
				font-size: 1.1rem;
				line-height: 1.4;
				color: var(--color-foreground--65);
			}

			.footnote {
				margin-block-start: var(--gl-space-12);
				font-size: 1.15rem;
				line-height: 1.5;
				color: var(--color-foreground--65);
			}

			gl-checkbox {
				margin-block: 0;
			}

			gl-radio {
				justify-self: center;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	private get grouped(): Partial<Record<GroupableTreeViewTypes, boolean>> {
		return this._state.getSettingValue<Record<GroupableTreeViewTypes, boolean>>('views.scm.grouped.views') ?? {};
	}

	private get hiddenMap(): Partial<Record<GroupableTreeViewTypes, boolean>> {
		return (
			this._state.getSettingValue<Record<GroupableTreeViewTypes, boolean>>('views.scm.grouped.hiddenViews') ?? {}
		);
	}

	private get defaultView(): GroupableTreeViewTypes | undefined {
		return this._state.getSettingValue<GroupableTreeViewTypes>('views.scm.grouped.default');
	}

	private setDefault(id: GroupableTreeViewTypes, disabled: boolean): void {
		if (disabled) return;

		void this.actions?.applyValue('views.scm.grouped.default', id);
	}

	private renderRow(id: GroupableTreeViewTypes) {
		const isGrouped = this.grouped[id] ?? false;
		const isHidden = this.hiddenMap[id] ?? false;
		const isDefault = this.defaultView === id;
		// Picking a default that isn't grouped (or is hidden within the group) is
		// harmless — the host falls back to the first grouped view — but offering
		// it as a choice here would be confusing, so it's disabled rather than hidden
		const defaultDisabled = !isGrouped || isHidden;
		const label = groupableViewTypeLabels[id];
		const localOnly = localOnlyGroupedViews.has(id);

		return html`<div class="row">
			<span class="row__view">
				<code-icon icon=${viewIcons[id]} aria-hidden="true"></code-icon>
				<span>
					${label}
					${
						localOnly
							? html`<span class="row__note"
									>${l10n.t('Unavailable for virtual or remote repositories')}</span
								>`
							: nothing
					}
				</span>
			</span>
			<gl-checkbox
				.checked=${isGrouped}
				@gl-change-value=${(e: Event) => {
					void this.actions?.applyCheck(
						objectCheckDescriptor('views.scm.grouped.views', id, l10n.t('Group {view}', { view: label })),
						(e.target as HTMLElement & { checked: boolean }).checked,
					);
				}}
				><span class="sr-only">${l10n.t('Group {view} into GitLens SCM', { view: label })}</span></gl-checkbox
			>
			<gl-checkbox
				.checked=${isHidden}
				?disabled=${!isGrouped}
				@gl-change-value=${(e: Event) => {
					void this.actions?.applyCheck(
						objectCheckDescriptor(
							'views.scm.grouped.hiddenViews',
							id,
							l10n.t('Hide {view}', { view: label }),
						),
						(e.target as HTMLElement & { checked: boolean }).checked,
					);
				}}
				><span class="sr-only">${l10n.t('Hide {view} in GitLens SCM', { view: label })}</span></gl-checkbox
			>
			<gl-radio
				.checked=${isDefault}
				?disabled=${defaultDisabled}
				@click=${() => this.setDefault(id, defaultDisabled)}
				><span class="sr-only"
					>${l10n.t('Set {view} as the default GitLens SCM view', { view: label })}</span
				></gl-radio
			>
		</div>`;
	}

	override render(): unknown {
		return html`<div class="rows">
				<div class="header">
					<span>${l10n.t('View')}</span>
					<span>${l10n.t('Group')}</span>
					<span>${l10n.t('Hide')}</span>
					<span>${l10n.t('Default')}</span>
				</div>
				${groupableViewTypes.map(id => this.renderRow(id))}
			</div>
			<p class="footnote">
				${l10n.t(
					"Views left out of the group still appear on their own in the side bar. Setting a default here applies the next time GitLens SCM picks a starting view — it doesn't switch the view that's currently open.",
				)}
			</p>`;
	}
}
