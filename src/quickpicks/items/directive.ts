import type { QuickPick, QuickPickItem, ThemeIcon, Uri } from 'vscode';
import { proTrialLengthInDays } from '../../constants.subscription.js';
import { pluralize } from '../../system/string.js';

export enum Directive {
	Back,
	Cancel,
	Reset,
	LoadMore,
	Noop,

	SignIn,
	StartProTrial,

	RequiresVerification,
	RequiresPaidSubscription,

	RefsAllBranches,
	ReposAll,
	ReposAllExceptWorktrees,
}

export function isDirective<T>(value: Directive | T): value is Directive {
	return typeof value === 'number' && Directive[value] != null;
}

export interface DirectiveQuickPickItem extends QuickPickItem {
	directive: Directive;
	onDidSelect?: (quickpick: QuickPick<QuickPickItem>) => void | Promise<void>;
}

export function createDirectiveQuickPickItem(
	directive: Directive,
	picked?: boolean,
	options?: {
		label?: string;
		description?: string;
		detail?: string;
		buttons?: QuickPickItem['buttons'];
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
		onDidSelect?: (quickpick: QuickPick<QuickPickItem>) => void | Promise<void>;
	},
): DirectiveQuickPickItem {
	let label = options?.label;
	let detail = options?.detail;
	let description = options?.description;
	if (label == null) {
		switch (directive) {
			case Directive.Back:
				label = 'Back';
				break;
			case Directive.Cancel:
				label = 'Cancel';
				break;
			case Directive.LoadMore:
				label = 'Load more';
				break;
			case Directive.Noop:
				label = 'Try again';
				break;
			case Directive.Reset:
				label = 'Reset';
				break;

			case Directive.SignIn:
				label = 'Sign In';
				break;
			case Directive.StartProTrial:
				label = 'Try GitLens Pro';
				detail = `Get ${pluralize(
					'day',
					proTrialLengthInDays,
				)} of GitLens Pro for free — no credit card required.`;
				break;

			case Directive.RequiresVerification:
				label = 'Resend Email';
				detail = 'You must verify your email before you can continue';
				break;
			case Directive.RequiresPaidSubscription:
				label = 'Upgrade to Pro';
				if (detail != null) {
					description ??= ' \u2014\u00a0\u00a0 GitLens Pro is required to use this feature';
				} else {
					detail = 'Upgrading to GitLens Pro is required to use this feature';
				}
				break;

			case Directive.RefsAllBranches:
				label = 'All Branches';
				break;

			case Directive.ReposAll:
				label = 'All Repositories';
				break;

			case Directive.ReposAllExceptWorktrees:
				label = 'All Repositories';
				description = ' excluding worktrees / submodules';
				break;
		}
	}

	const item: DirectiveQuickPickItem = {
		label: label,
		description: description,
		detail: detail,
		iconPath: options?.iconPath,
		buttons: options?.buttons,
		alwaysShow: true,
		picked: picked,
		directive: directive,
		onDidSelect: options?.onDidSelect,
	};

	return item;
}

export function isDirectiveQuickPickItem(item: QuickPickItem): item is DirectiveQuickPickItem {
	return item != null && 'directive' in item;
}
