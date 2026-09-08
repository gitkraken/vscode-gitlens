import type { MessageItem, Uri } from 'vscode';
import { l10n, window } from 'vscode';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { proTrialLengthInDays } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import type { PlusFeatures } from '../../../../features.js';
import { isAdvancedFeature } from '../../../../features.js';
import { createQuickPickSeparator } from '../../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../../../../quickpicks/items/directive.js';

export async function ensureAccount(container: Container, title: string, source: Source): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: l10n.t('Resend Email') };
			const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
			const result = await window.showWarningMessage(
				title,
				{ modal: true, detail: l10n.t('You must verify your email before you can continue.') },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification(source)) {
					continue;
				}
			}

			return false;
		}

		if (subscription.account != null) break;

		const signUp = { title: l10n.t('Try GitLens Pro') };
		const signIn = { title: l10n.t('Sign In') };
		const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
		const result = await window.showWarningMessage(
			title,
			{
				modal: true,
				detail: l10n.t(
					'Start your free {0}-day Pro trial for full access to all GitLens Pro features, or sign in.',
					getNumericFormat()(proTrialLengthInDays),
				),
			},
			signUp,
			signIn,
			cancel,
		);

		if (result === signIn) {
			if (await container.subscription.loginOrSignUp(false, source)) {
				continue;
			}
		} else if (result === signUp) {
			if (await container.subscription.loginOrSignUp(true, source)) {
				continue;
			}
		}

		return false;
	}

	return true;
}

export async function ensureAccountQuickPick(
	container: Container,
	descriptionItem: DirectiveQuickPickItem,
	source: Source,
	silent?: boolean,
): Promise<boolean> {
	while (true) {
		const account = (await container.subscription.getSubscription()).account;
		if (account?.verified === true) break;

		if (silent) return false;

		const directives: DirectiveQuickPickItem[] = [descriptionItem];

		let placeholder = l10n.t('Requires an account to continue');
		if (account?.verified === false) {
			directives.push(
				createDirectiveQuickPickItem(Directive.RequiresVerification, true),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			);
			placeholder = l10n.t('You must verify your email before you can continue');
		} else {
			directives.push(
				createDirectiveQuickPickItem(Directive.StartProTrial, true),
				createDirectiveQuickPickItem(Directive.SignIn),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			);
		}

		const result = await window.showQuickPick(directives, {
			placeHolder: placeholder,
			ignoreFocusOut: true,
		});

		if (result == null) return false;
		if (result.directive === Directive.Noop) continue;

		if (result.directive === Directive.RequiresVerification) {
			if (await container.subscription.resendVerification(source)) {
				continue;
			}
		}
		if (result.directive === Directive.StartProTrial) {
			if (await container.subscription.loginOrSignUp(true, source)) {
				continue;
			}
		}
		if (result.directive === Directive.SignIn) {
			if (await container.subscription.loginOrSignUp(false, source)) {
				continue;
			}
		}

		return false;
	}

	return true;
}

export async function ensureFeatureAccess(
	container: Container,
	title: string,
	feature: PlusFeatures,
	source: Source,
	repoPath?: string | Uri,
): Promise<boolean> {
	if (!(await ensureAccount(container, title, source))) return false;

	while (true) {
		const access = await container.git.access(feature, repoPath);
		if (access.allowed) break;

		const isAdvanced = isAdvancedFeature(feature);
		const plan = isAdvanced ? 'advanced' : 'pro';

		const promo = await container.productConfig.getApplicablePromo(access.subscription.current.state, plan, 'gate');
		const promoDetail = promo?.content?.modal?.detail;

		const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
		let upgrade: MessageItem;
		let result: MessageItem | undefined;

		if (isAdvanced) {
			upgrade = { title: l10n.t('Upgrade to Advanced') };
			result = await window.showWarningMessage(
				title,
				{
					modal: true,
					detail: promoDetail
						? l10n.t('Please upgrade to GitLens Advanced to continue.\n{0}', promoDetail)
						: l10n.t('Please upgrade to GitLens Advanced to continue.'),
				},
				upgrade,
				cancel,
			);
		} else {
			upgrade = { title: l10n.t('Upgrade to Pro') };
			result = await window.showWarningMessage(
				title,
				{
					modal: true,
					detail: promoDetail
						? l10n.t('Please upgrade to GitLens Pro to continue.\n{0}', promoDetail)
						: l10n.t('Please upgrade to GitLens Pro to continue.'),
				},
				upgrade,
				cancel,
			);
		}

		if (result === upgrade) {
			if (await container.subscription.upgrade(plan, source)) {
				continue;
			}
		}

		return false;
	}

	return true;
}
