import type { QuickPickItem } from 'vscode';
import type { Subscription } from '../../subscription';

export enum Directive {
	Back,
	Cancel,
	LoadMore,
	Noop,
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
}

export function createDirectiveQuickPickItem(
	directive: Directive,
	picked?: boolean,
	options?: { label?: string; description?: string; detail?: string; subscription?: Subscription },
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
			case Directive.StartPreviewTrial:
				label = 'Start a GitLens Pro Trial';
				detail = 'Try GitLens+ features on private repos, free for 3 days, without an account';
				break;
			case Directive.ExtendTrial:
				label = 'Extend Your GitLens Pro Trial';
				detail = 'To continue to use GitLens+ features on private repos, free for an additional 7-days';
				break;
			case Directive.RequiresVerification:
				label = 'Resend Verification Email';
				detail = 'You must verify your email address before you can continue';
				break;
			case Directive.RequiresPaidSubscription:
				label = 'Upgrade to Pro';
				detail = 'To use GitLens+ features on private repos';
				break;
		}
	}

	const item: DirectiveQuickPickItem = {
		label: label,
		description: options?.description,
		detail: detail,
		alwaysShow: true,
		picked: picked,
		directive: directive,
	};

	return item;
}

export function isDirectiveQuickPickItem(item: QuickPickItem): item is DirectiveQuickPickItem {
	return item != null && 'directive' in item;
}
