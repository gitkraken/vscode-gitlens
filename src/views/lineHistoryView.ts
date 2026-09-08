import { l10n } from 'vscode';
import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import type { LineHistoryViewConfig } from '../config.js';
import type { Container } from '../container.js';
import { executeCommand } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { setContext } from '../system/-webview/context.js';
import { LineHistoryTrackerNode } from './nodes/lineHistoryTrackerNode.js';
import { ViewBase } from './viewBase.js';
import type { CopyNodeCommandArgs } from './viewCommands.js';
import { registerViewCommand } from './viewCommands.js';

export class LineHistoryView extends ViewBase<'lineHistory', LineHistoryTrackerNode, LineHistoryViewConfig> {
	protected readonly configKey = 'lineHistory';
	private _unpinnedDescription: string | undefined;

	constructor(container: Container) {
		super(container, 'lineHistory', l10n.t('Line History'), 'lineHistoryView');

		void setContext('gitlens:views:lineHistory:editorFollowing', true);
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	protected getRoot(): LineHistoryTrackerNode {
		return new LineHistoryTrackerNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand<CopyNodeCommandArgs>('gitlens.views.copy', this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(this.getQualifiedCommand('changeBase'), () => this.changeBase(), this),
			registerViewCommand(
				this.getQualifiedCommand('setEditorFollowingOn'),
				() => this.setEditorFollowing(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setEditorFollowingOff'),
				() => this.setEditorFollowing(false),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent): boolean {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultCurrentUserNameStyle') &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateLocale') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat')
		) {
			return false;
		}

		return true;
	}

	private changeBase() {
		void this.root?.changeBase();
	}

	private setEditorFollowing(enabled: boolean) {
		const root = this.ensureRoot();
		if (!root.hasUri) return;

		void setContext('gitlens:views:lineHistory:editorFollowing', enabled);

		this.root?.setEditorFollowing(enabled);

		if (enabled) {
			if (this._unpinnedDescription != null) {
				if (this.description === l10n.t('{0} (pinned)', this._unpinnedDescription)) {
					this.description = this._unpinnedDescription;
				}

				this._unpinnedDescription = undefined;
			}
		} else if (this.description != null && this._unpinnedDescription == null) {
			this._unpinnedDescription = this.description;
			this.description = l10n.t('{0} (pinned)', this.description);
		}

		if (enabled) {
			void root.ensureSubscription();
			void this.refresh(true);
		}
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}
}
