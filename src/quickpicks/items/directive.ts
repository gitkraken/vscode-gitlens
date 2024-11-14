import type { QuickPickItem, ThemeIcon, Uri } from 'vscode';
import { proPreviewLengthInDays, proTrialLengthInDays } from '../../constants.subscription';
import { pluralize } from '../../system/string';

export enum Directive {
	Back,
	Cancel,
	LoadMore,
	Noop,
	Reload,
	RequiresVerification,

	SignIn,
	StartPreview,
	StartProTrial,
	RequiresPaidSubscription,
}

export function isDirective<T>(value: Directive | T): value is Directive {
	return typeof value === 'number' && Directive[value] != null;
}

export interface DirectiveQuickPickItem extends QuickPickItem {
	directive: Directive;
	onDidSelect?: () => void | Promise<void>;
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
		onDidSelect?: () => void | Promise<void>;
	},
) {
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
			case Directive.Reload:
				label = 'Refresh';
				break;
			case Directive.SignIn:
				label = 'Sign In';
				break;
			case Directive.StartPreview:
				label = 'Continue';
				detail = `Continuing gives you ${proPreviewLengthInDays} days to preview this and other local Pro features`;
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
