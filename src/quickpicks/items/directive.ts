import type { QuickPickItem } from 'vscode';
import * as nls from 'vscode-nls';
import type { Subscription } from '../../subscription';

const localize = nls.loadMessageBundle();
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
					label = localize('directive.back.label', 'Back');
					break;
				case Directive.Cancel:
					label = localize('directive.cancel.label', 'Cancel');
					break;
				case Directive.LoadMore:
					label = localize('directive.loadMore.label', 'Load more');
					break;
				case Directive.Noop:
					label = localize('directive.noop.label', 'Try again');
					break;
				case Directive.StartPreviewTrial:
					label = localize('directive.startPreviewTrial.label', 'Start a GitLens Pro Trial');
					detail = localize(
						'directive.startPreviewTrial.detail',
						'Try GitLens+ features on private repos, free for 3 days, without an account',
					);
					break;
				case Directive.ExtendTrial:
					label = localize('directive.extendTrial.label', 'Extend Your GitLens Pro Trial');
					detail = localize(
						'directive.extendTrial.detail',
						'To continue to use GitLens+ features on private repos, free for an additional 7-days',
					);
					break;
				case Directive.RequiresVerification:
					label = localize('directive.requiresVerification.label', 'Resend Verification Email');
					detail = localize(
						'directive.requiresVerification.detail',
						'You must verify your email address before you can continue',
					);
					break;
				case Directive.RequiresPaidSubscription:
					label = localize('directive.requiresPaidSubscription.label', 'Upgrade to Pro');
					detail = localize(
						'directive.requiresPaidSubscription.detail',
						'To use GitLens+ features on private repos',
					);
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
