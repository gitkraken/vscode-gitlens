import type { QuickPickItem } from 'vscode';
import type { Subscription } from '../../subscription';

export enum Directive {
	Back,
	Cancel,
	LoadMore,
	Noop,
	RequiresVerification,

	RequiresFreeSubscription,
	RequiresPaidSubscription,
	StartPreviewTrial,
}

export namespace Directive {
	export function is<T>(value: Directive | T): value is Directive {
		return typeof value === 'number' && Directive[value] != null;
	}
}

export interface DirectiveQuickPickItem extends QuickPickItem {
	directive: Directive;
}

export namespace DirectiveQuickPickItem {
	export function create(
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
					label = 'Try GitLens+ Features Now';
					detail = 'Try GitLens+ features now, without an account, for 3 days';
					break;
				case Directive.RequiresVerification:
					label = 'Resend Verification Email';
					detail = 'You must verify your GitLens+ account email address before you can continue';
					break;
				case Directive.RequiresFreeSubscription:
					label = 'Sign in to GitLens+';
					detail =
						'To use GitLens+ features on public repos and get a free 7-day trial for both public and private repos';
					break;
				case Directive.RequiresPaidSubscription:
					label = 'Upgrade your account';
					detail = 'To use GitLens+ features on both public and private repos';
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

	export function is(item: QuickPickItem): item is DirectiveQuickPickItem {
		return item != null && 'directive' in item;
	}
}
