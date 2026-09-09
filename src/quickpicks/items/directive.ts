import type { QuickPick, QuickPickItem, Uri } from 'vscode';
import { l10n, ThemeIcon } from 'vscode';
import { formatPlural } from '@gitlens/utils/plural.js';
import { proTrialLengthInDays } from '../../constants.subscription.js';

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

function getProTrialDetail(days: number): string {
	return formatPlural(
		l10n.t(
			'{0, plural, one{Get {0} day of GitLens Pro for free — no credit card required.} other{Get {0} days of GitLens Pro for free — no credit card required.}}',
		),
		[days],
	);
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
				label = l10n.t('Back');
				break;
			case Directive.Cancel:
				label = l10n.t('Cancel');
				break;
			case Directive.LoadMore:
				label = l10n.t('Load more');
				break;
			case Directive.Noop:
				label = l10n.t('Try again');
				break;
			case Directive.Reset:
				label = l10n.t('Reset');
				break;

			case Directive.SignIn:
				label = l10n.t('Sign In');
				break;
			case Directive.StartProTrial:
				label = l10n.t('Try GitLens Pro');
				detail = getProTrialDetail(proTrialLengthInDays);
				break;

			case Directive.RequiresVerification:
				label = l10n.t('Resend Email');
				detail = l10n.t('You must verify your email before you can continue');
				break;
			case Directive.RequiresPaidSubscription:
				label = l10n.t('Upgrade to Pro');
				if (detail != null) {
					description ??= l10n.t(' —\u00a0\u00a0 GitLens Pro is required to use this feature');
				} else {
					detail = l10n.t('Upgrading to GitLens Pro is required to use this feature');
				}
				break;

			case Directive.RefsAllBranches:
				label = l10n.t('All Branches');
				break;

			case Directive.ReposAll:
				label = l10n.t('All Repositories');
				break;

			case Directive.ReposAllExceptWorktrees:
				label = l10n.t('All Repositories');
				description = l10n.t(' excluding worktrees / submodules');
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

export type ConfirmToggleQuickPickItem = DirectiveQuickPickItem & { checked: boolean };

/**
 * Builds a confirm-step "checkbox" row: a modifier that folds into every mode row above it, shown as a
 * row rather than a title-bar button because a title-bar button is icon-only (`iconPath` is the only
 * visual the API exposes, with the rest on a hover tooltip) and a modifier that rewrites what every mode
 * does should say so in words. `Directive.Noop` keeps the quickpick open on select, and the returned item
 * is mutated in place — never recreated — so it keeps its identity, and therefore its active/selected
 * state, across a `refreshConfirmStepItems` rebuild.
 */
export function createConfirmToggleQuickPickItem(options: {
	label: string;
	description?: string;
	detail?: string;
	checked: boolean;
	onDidChange: (item: ConfirmToggleQuickPickItem, quickpick: QuickPick<QuickPickItem>) => void;
}): ConfirmToggleQuickPickItem {
	const item = createDirectiveQuickPickItem(Directive.Noop, false, {
		label: options.label,
		description: options.description,
		detail: options.detail,
		iconPath: new ThemeIcon(`gitlens-checkbox-${options.checked ? 'checked' : 'unchecked'}`),
	}) as ConfirmToggleQuickPickItem;
	item.checked = options.checked;
	item.onDidSelect = quickpick => {
		item.checked = !item.checked;
		item.iconPath = new ThemeIcon(`gitlens-checkbox-${item.checked ? 'checked' : 'unchecked'}`);
		options.onDidChange(item, quickpick);
	};

	return item;
}
