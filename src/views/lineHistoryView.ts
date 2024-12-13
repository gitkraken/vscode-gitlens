import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import type { LineHistoryViewConfig } from '../config';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import { LineHistoryTrackerNode } from './nodes/lineHistoryTrackerNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

const pinnedSuffix = ' (pinned)';

export class LineHistoryView extends ViewBase<'lineHistory', LineHistoryTrackerNode, LineHistoryViewConfig> {
	protected readonly configKey = 'lineHistory';

	constructor(container: Container) {
		super(container, 'lineHistory', 'Line History', 'lineHistoryView');

		void setContext('gitlens:views:lineHistory:editorFollowing', true);
	}

	override get canSelectMany(): boolean {
		return this.container.prereleaseOrDebugging;
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	protected getRoot() {
		return new LineHistoryTrackerNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(GlCommand.ViewsCopy, this.activeSelection, this.selection),
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

		void setContext('gitlens:views:lineHistory:editorFollowing', enabled);

		this.root?.setEditorFollowing(enabled);

		if (this.description?.endsWith(pinnedSuffix)) {
			if (enabled) {
				this.description = this.description.substring(0, this.description.length - pinnedSuffix.length);
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
