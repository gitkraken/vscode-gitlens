'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, LineHistoryViewConfig } from '../configuration';
import { ContextKeys, setContext } from '../constants';
import { Container } from '../container';
import { LineHistoryTrackerNode } from './nodes';
import { ViewBase } from './viewBase';

const pinnedSuffix = ' (pinned)';

export class LineHistoryView extends ViewBase<LineHistoryTrackerNode, LineHistoryViewConfig> {
	protected readonly configKey = 'lineHistory';

	constructor() {
		super('gitlens.views.lineHistory', 'Line History');

		void setContext(ContextKeys.ViewsLineHistoryEditorFollowing, true);
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	getRoot() {
		return new LineHistoryTrackerNode(this);
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(this.getQualifiedCommand('changeBase'), () => this.changeBase(), this);
		commands.registerCommand(
			this.getQualifiedCommand('setEditorFollowingOn'),
			() => this.setEditorFollowing(true),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setEditorFollowingOff'),
			() => this.setEditorFollowing(false),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this);
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
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
