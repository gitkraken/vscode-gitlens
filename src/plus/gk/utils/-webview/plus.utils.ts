import type { MessageItem } from 'vscode';
import { l10n, window } from 'vscode';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { proTrialLengthInDays } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { getContext } from '../../../../system/-webview/context.js';
import { isSubscriptionPaidPlan } from '../subscription.utils.js';

export function arePlusFeaturesEnabled(): boolean {
	const enabled = configuration.get('plusFeatures.enabled', undefined, true);
	return enabled ? true : !getContext('gitlens:plus:disabled');
}

export async function ensurePlusFeaturesEnabled(): Promise<boolean> {
	if (arePlusFeaturesEnabled()) return true;

	const confirm: MessageItem = { title: l10n.t('Enable') };
	const cancel: MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
	const result = await window.showInformationMessage(
		l10n.t('Pro features are currently disabled. Would you like to enable them?'),
		{ modal: true },
		confirm,
		cancel,
	);

	if (result !== confirm) return false;

	await configuration.updateEffective('plusFeatures.enabled', true);
	return true;
}

export async function ensurePaidPlan(container: Container, title: string, source: Source): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: l10n.t('Resend Email') };
			const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
			const result = await window.showWarningMessage(
				l10n.t('{0}\n\nYou must verify your email before you can continue.', title),
				{ modal: true },
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

		const plan = subscription.plan.effective.id;
		if (isSubscriptionPaidPlan(plan)) break;

		if (subscription.account == null) {
			const signUp = { title: l10n.t('Try GitLens Pro') };
			const signIn = { title: l10n.t('Sign In') };
			const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
			const result = await window.showWarningMessage(
				l10n.t(
					'{0}\n\nDo you want to start your free {1}-day Pro trial for full access to all GitLens Pro features?',
					title,
					getNumericFormat()(proTrialLengthInDays),
				),
				{ modal: true },
				signUp,
				signIn,
				cancel,
			);

			if (result === signUp || result === signIn) {
				if (await container.subscription.loginOrSignUp(result === signUp, source)) {
					continue;
				}
			}
		} else {
			const upgrade = { title: l10n.t('Upgrade to Pro') };
			const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
			const result = await window.showWarningMessage(
				l10n.t('{0}\n\nDo you want to upgrade for full access to all GitLens Pro features?', title),
				{ modal: true },
				upgrade,
				cancel,
			);

			if (result === upgrade) {
				void container.subscription.upgrade('pro', source);
			}
		}

		return false;
	}

	return true;
}
