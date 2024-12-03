import type { QuickInput, QuickInputButton } from 'vscode';
import { ThemeIcon, Uri } from 'vscode';
import { Container } from '../container';

export class ToggleQuickInputButton implements QuickInputButton {
	constructor(
		private readonly state:
			| {
					on: { icon: string | { light: Uri; dark: Uri } | ThemeIcon; tooltip: string };
					off: { icon: string | { light: Uri; dark: Uri } | ThemeIcon; tooltip: string };
			  }
			| (() => {
					on: { icon: string | { light: Uri; dark: Uri } | ThemeIcon; tooltip: string };
					off: { icon: string | { light: Uri; dark: Uri } | ThemeIcon; tooltip: string };
			  }),
		private _on = false,
	) {}

	get iconPath(): { light: Uri; dark: Uri } | ThemeIcon {
		const icon = this.getToggledState().icon;
		return typeof icon === 'string'
			? {
					dark: Uri.file(Container.instance.context.asAbsolutePath(`images/dark/${icon}.svg`)),
					light: Uri.file(Container.instance.context.asAbsolutePath(`images/light/${icon}.svg`)),
			  }
			: icon;
	}

	get tooltip(): string {
		return this.getToggledState().tooltip;
	}

	get on() {
		return this._on;
	}
	set on(value: boolean) {
		this._on = value;
	}

	/**
	 * @returns `true` if the step should be retried (refreshed)
	 */
	onDidClick?(quickInput: QuickInput): boolean | void | Promise<boolean | void>;

	private getState() {
		return typeof this.state === 'function' ? this.state() : this.state;
	}

	private getToggledState() {
		return this.on ? this.getState().on : this.getState().off;
	}
}

export class SelectableQuickInputButton extends ToggleQuickInputButton {
	constructor(tooltip: string, icon: { off: string | ThemeIcon; on: string | ThemeIcon }, selected: boolean = false) {
		super({ off: { tooltip: tooltip, icon: icon.off }, on: { tooltip: tooltip, icon: icon.on } }, selected);
	}
}

export const ClearQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('clear-all'),
	tooltip: 'Clear',
};

export const ConnectIntegrationButton: QuickInputButton = {
	iconPath: new ThemeIcon('plug'),
	tooltip: 'Connect Additional Integrations',
};

export const FeedbackQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('feedback'),
	tooltip: 'Give Us Feedback',
};

export const FetchQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('repo-fetch'),
	tooltip: 'Fetch',
};

export const LoadMoreQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('refresh'),
	tooltip: 'Load More',
};

export const MatchCaseToggleQuickInputButton = class extends SelectableQuickInputButton {
	constructor(on = false) {
		super('Match Case', { off: 'icon-match-case', on: 'icon-match-case-selected' }, on);
	}
};

export const MatchAllToggleQuickInputButton = class extends SelectableQuickInputButton {
	constructor(on = false) {
		super('Match All', { off: 'icon-match-all', on: 'icon-match-all-selected' }, on);
	}
};

export const MatchRegexToggleQuickInputButton = class extends SelectableQuickInputButton {
	constructor(on = false) {
		super('Match using Regular Expressions', { off: 'icon-match-regex', on: 'icon-match-regex-selected' }, on);
	}
};

export const PickCommitQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('git-commit'),
	tooltip: 'Choose a Specific Commit',
};

export const PickCommitToggleQuickInputButton = class extends ToggleQuickInputButton {
	constructor(on = false, context: { showTags: boolean }, onDidClick?: (quickInput: QuickInput) => void) {
		super(
			() => ({
				on: { tooltip: 'Choose a Specific Commit', icon: new ThemeIcon('git-commit') },
				off: {
					tooltip: `Choose a Branch${context.showTags ? ' or Tag' : ''}`,
					icon: new ThemeIcon('git-branch'),
				},
			}),
			on,
		);

		this.onDidClick = onDidClick;
	}
};

export const LearnAboutProQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('info'),
	tooltip: 'Learn about GitLens Pro',
};

export const MergeQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('merge'),
	tooltip: 'Merge...',
};

export const OpenOnJiraQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('globe'),
	tooltip: 'Open on Jira',
};

export const OpenOnGitHubQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('globe'),
	tooltip: 'Open on GitHub',
};

export const OpenOnGitLabQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('globe'),
	tooltip: 'Open on GitLab',
};

export const OpenOnWebQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('globe'),
	tooltip: 'Open on gitkraken.dev',
};

export const LaunchpadSettingsQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('gear'),
	tooltip: 'Launchpad Settings',
};

export const PinQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('pinned'),
	tooltip: 'Pin',
};

export const UnpinQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('pin'),
	tooltip: 'Unpin',
};

export const SnoozeQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('bell-slash'),
	tooltip: 'Snooze',
};

export const RefreshQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('refresh'),
	tooltip: 'Refresh',
};

export const UnsnoozeQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('bell'),
	tooltip: 'Unsnooze',
};
export const OpenInNewWindowQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('empty-window'),
	tooltip: 'Open in New Window',
};

export const RevealInSideBarQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('search'),
	tooltip: 'Reveal in Side Bar',
};

export const SetRemoteAsDefaultQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('settings-gear'),
	tooltip: 'Set as Default Remote',
};

export const ShowDetailsViewQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('eye'),
	tooltip: 'Inspect Details',
};

export const OpenChangesViewQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('compare-changes'),
	tooltip: 'Open Changes',
};

export const ShowResultsInSideBarQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('link-external'),
	tooltip: 'Show Results in Side Bar',
};

export const OpenWorktreeInNewWindowQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('empty-window'),
	tooltip: 'Open in Worktree',
};

export const ShowTagsToggleQuickInputButton = class extends SelectableQuickInputButton {
	constructor(on = false) {
		super('Show Tags', { off: new ThemeIcon('tag'), on: 'icon-tag-selected' }, on);
	}
};

export const WillConfirmForcedQuickInputButton: QuickInputButton = {
	iconPath: new ThemeIcon('gitlens-confirm-checked'),
	tooltip: 'You will be presented with a required confirmation step before the action is performed',
};

export const WillConfirmToggleQuickInputButton = class extends ToggleQuickInputButton {
	constructor(on = false, isConfirmationStep: boolean, onDidClick?: (quickInput: QuickInput) => void) {
		super(
			() => ({
				on: {
					tooltip: isConfirmationStep
						? 'For future actions, you will be presented with confirmation step before the action is performed\nClick to toggle'
						: 'You will be presented with confirmation step before the action is performed\nClick to toggle',
					icon: new ThemeIcon('gitlens-confirm-checked'),
				},
				off: {
					tooltip: isConfirmationStep
						? "For future actions, you won't be presented with confirmation step before the action is performed\nClick to toggle"
						: "You won't be presented with confirmation step before the action is performed\nClick to toggle",
					icon: new ThemeIcon('gitlens-confirm-unchecked'),
				},
			}),
			on,
		);

		this.onDidClick = onDidClick;
	}
};
