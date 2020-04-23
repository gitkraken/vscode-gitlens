'use strict';
import { QuickInput, QuickInputButton, ThemeIcon, Uri } from 'vscode';
import { Container } from '../container';
import { configuration } from '../configuration';

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

	export const KeepOpenToggle = class extends ToggleQuickInputButton {
		constructor() {
			super(
				() => ({
					on: { tooltip: 'Keep Open', icon: new ThemeIcon('pinned') },
					off: { tooltip: 'Keep Open', icon: new ThemeIcon('pin') },
				}),
				!configuration.get('gitCommands', 'closeOnFocusOut'),
			);

			this.onDidClick = async input => {
				const closeOnFocusOut = !configuration.get('gitCommands', 'closeOnFocusOut');
				this.on = !closeOnFocusOut;

				input.ignoreFocusOut = !closeOnFocusOut;
				void (await configuration.updateEffective('gitCommands', 'closeOnFocusOut', closeOnFocusOut));
			};
		}
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

	export const RevealInView: QuickInputButton = {
		iconPath: new ThemeIcon('eye'),
		tooltip: 'Reveal in Repositories View',
	};

	export const ShowInView: QuickInputButton = {
		iconPath: new ThemeIcon('search'),
		tooltip: 'Show in Search Commits View',
	};

	export const ShowResultsInView: QuickInputButton = {
		iconPath: new ThemeIcon('search'),
		tooltip: 'Show Results in Search Commits View',
	};

	export const ShowResultsInViewToggle = class extends ToggleQuickInputButton {
		constructor(on = false, onDidClick?: (quickInput: QuickInput) => void) {
			super(
				() => ({
					on: {
						tooltip: 'Show Results in Search Commits View',
						icon: {
							dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-window.svg')),
							light: Uri.file(Container.context.asAbsolutePath('images/light/icon-window.svg')),
						},
					},
					off: {
						tooltip: 'Show Results Here',
						icon: {
							dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-window-disabled.svg')),
							light: Uri.file(Container.context.asAbsolutePath('images/light/icon-window-disabled.svg')),
						},
					},
				}),
				on,
			);

			this.onDidClick = onDidClick;
		}
	};

	export const ShowTagsToggle = class extends SelectableQuickInputButton {
		constructor(on = false) {
			super('Show Tags', 'tag', on);
		}
	};

	export const WillConfirmForced: QuickInputButton = {
		iconPath: new ThemeIcon('check'),
		// iconPath: {
		// 	dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-check.svg')),
		// 	light: Uri.file(Container.context.asAbsolutePath('images/light/icon-check.svg')),
		// },
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
