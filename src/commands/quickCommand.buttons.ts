'use strict';
import { QuickInput, QuickInputButton, ThemeIcon, Uri } from 'vscode';
import { Container } from '../container';

export class ToggleQuickInputButton implements QuickInputButton {
	constructor(
		private readonly state:
			| {
					on: { icon: string | { light: string | Uri; dark: string | Uri } | ThemeIcon; tooltip: string };
					off: { icon: string | { light: string | Uri; dark: string | Uri } | ThemeIcon; tooltip: string };
			  }
			| (() => {
					on: { icon: string | { light: string | Uri; dark: string | Uri } | ThemeIcon; tooltip: string };
					off: { icon: string | { light: string | Uri; dark: string | Uri } | ThemeIcon; tooltip: string };
			  }),
		private _on = false,
	) {}

	get iconPath(): { light: Uri; dark: Uri } | ThemeIcon {
		const icon = this.getToggledState().icon;
		return typeof icon === 'string'
			? {
					dark: Uri.file(Container.context.asAbsolutePath(`images/dark/icon-${icon}.svg`)),
					light: Uri.file(Container.context.asAbsolutePath(`images/light/icon-${icon}.svg`)),
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

	onDidClick?(quickInput: QuickInput): boolean | void | Promise<boolean | void>;

	private getState() {
		return typeof this.state === 'function' ? this.state() : this.state;
	}

	private getToggledState() {
		return this.on ? this.getState().on : this.getState().off;
	}
}

export class SelectableQuickInputButton extends ToggleQuickInputButton {
	constructor(tooltip: string, icon: string, selected: boolean = false) {
		super({ off: { tooltip: tooltip, icon: icon }, on: { tooltip: tooltip, icon: `${icon}-selected` } }, selected);
	}
}

export namespace QuickCommandButtons {
	export const Fetch: QuickInputButton = {
		iconPath: new ThemeIcon('sync'),
		tooltip: 'Fetch',
	};

	export const LoadMore: QuickInputButton = {
		iconPath: new ThemeIcon('refresh'),
		tooltip: 'Load More',
	};

	export const MatchCaseToggle = class extends SelectableQuickInputButton {
		constructor(on = false) {
			super('Match Case', 'match-case', on);
		}
	};

	export const MatchAllToggle = class extends SelectableQuickInputButton {
		constructor(on = false) {
			super('Match All', 'match-all', on);
		}
	};

	export const MatchRegexToggle = class extends SelectableQuickInputButton {
		constructor(on = false) {
			super('Match using Regular Expressions', 'match-regex', on);
		}
	};

	export const PickCommitToggle = class extends ToggleQuickInputButton {
		constructor(on = false, context: { showTags: boolean }, onDidClick?: (quickInput: QuickInput) => void) {
			super(
				() => ({
					on: { tooltip: 'Choose a Specific Commit', icon: new ThemeIcon('git-commit') },
					off: { tooltip: `Choose a Branch${context.showTags ? ' or Tag' : ''}`, icon: 'branch' },
				}),
				on,
			);

			this.onDidClick = onDidClick;
		}
	};

	export const RevealInSideBar: QuickInputButton = {
		iconPath: new ThemeIcon('eye'),
		tooltip: 'Reveal in Side Bar',
	};

	export const SearchInSideBar: QuickInputButton = {
		iconPath: new ThemeIcon('search'),
		tooltip: 'Search in Side Bar',
	};

	export const ShowResultsInSideBar: QuickInputButton = {
		iconPath: new ThemeIcon('link-external'),
		tooltip: 'Show Results in Side Bar',
	};

	export const ShowTagsToggle = class extends SelectableQuickInputButton {
		constructor(on = false) {
			super('Show Tags', 'tag', on);
		}
	};

	export const WillConfirmForced: QuickInputButton = {
		iconPath: new ThemeIcon('check'),
		tooltip: 'Will always confirm',
	};

	export const WillConfirmToggle = class extends ToggleQuickInputButton {
		constructor(on = false, onDidClick?: (quickInput: QuickInput) => void) {
			super(
				() => ({
					on: {
						tooltip: 'Will confirm',
						icon: {
							dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-check.svg')),
							light: Uri.file(Container.context.asAbsolutePath('images/light/icon-check.svg')),
						},
					},
					off: {
						tooltip: 'Skips confirm',
						icon: {
							dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-no-check.svg')),
							light: Uri.file(Container.context.asAbsolutePath('images/light/icon-no-check.svg')),
						},
					},
				}),
				on,
			);

			this.onDidClick = onDidClick;
		}
	};
}
