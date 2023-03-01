import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import type { LineHistoryViewConfig } from '../config';
import { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { LineHistoryTrackerNode } from './nodes/lineHistoryTrackerNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

const pinnedSuffix = ' (pinned)';

export class LineHistoryView extends ViewBase<LineHistoryTrackerNode, LineHistoryViewConfig> {
	protected readonly configKey = 'lineHistory';

	constructor(container: Container) {
		super(container, 'gitlens.views.lineHistory', 'Line History', 'lineHistoryView');

		void setContext(ContextKeys.ViewsLineHistoryEditorFollowing, true);
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	protected getRoot() {
		return new LineHistoryTrackerNode(this);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.activeSelection, this.selection),
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

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
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

		void setContext(ContextKeys.ViewsLineHistoryEditorFollowing, enabled);

		this.root?.setEditorFollowing(enabled);

		if (this.description?.endsWith(pinnedSuffix)) {
			if (enabled) {
				this.description = this.description.substr(0, this.description.length - pinnedSuffix.length);
			}
		} else if (!enabled && this.description != null) {
			this.description += pinnedSuffix;
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
