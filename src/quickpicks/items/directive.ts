import type { QuickPickItem, ThemeIcon, Uri } from 'vscode';
import type { Subscription } from '../../plus/gk/account/subscription';

export enum Directive {
	Back,
	Cancel,
	LoadMore,
	Noop,
	Reload,
	RequiresVerification,

	ExtendTrial,
	RequiresPaidSubscription,
	StartPreviewTrial,
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
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
		subscription?: Subscription;
		onDidSelect?: () => void | Promise<void>;
	},
) {
	let label = options?.label;
	let detail = options?.detail;
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
			case Directive.StartPreviewTrial:
				label = 'Preview Pro';
				detail = 'Preview Pro for 3-days to use this on privately hosted repos';
				break;
			case Directive.ExtendTrial:
				label = 'Start Pro Trial';
				detail = 'Continue to use this on privately hosted repos, free for an additional 7 days';
				break;
			case Directive.RequiresVerification:
				label = 'Resend Verification Email';
				detail = 'You must verify your email before you can continue';
				break;
			case Directive.RequiresPaidSubscription:
				label = 'Upgrade to Pro';
				detail = 'A paid plan is required to use this on privately hosted repos';
				break;
		}
	}

	const item: DirectiveQuickPickItem = {
		label: label,
		description: options?.description,
		detail: detail,
		iconPath: options?.iconPath,
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
