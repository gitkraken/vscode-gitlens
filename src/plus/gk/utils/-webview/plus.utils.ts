import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { proTrialLengthInDays, SubscriptionPlanId } from '../../../../constants.subscription';
import type { Source } from '../../../../constants.telemetry';
import type { Container } from '../../../../container';
import { configuration } from '../../../../system/-webview/configuration';
import { getContext } from '../../../../system/-webview/context';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../subscription.utils';

export function arePlusFeaturesEnabled(): boolean {
	return getContext('gitlens:plus:enabled', configuration.get('plusFeatures.enabled', undefined, true));
}

export async function ensurePlusFeaturesEnabled(): Promise<boolean> {
	if (arePlusFeaturesEnabled()) return true;

	const confirm: MessageItem = { title: 'Enable' };
	const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		'Pro features are currently disabled. Would you like to enable them?',
		{ modal: true },
		confirm,
		cancel,
	);

	if (result !== confirm) return false;

	await configuration.updateEffective('plusFeatures.enabled', true);
	return true;
}

export async function ensurePaidPlan(
	container: Container,
	title: string,
	source: Source,
	options?: { allowPreview?: boolean },
): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Email' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
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

		if (options?.allowPreview && subscription.account == null && !isSubscriptionPreviewTrialExpired(subscription)) {
			const startTrial = { title: 'Continue' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to continue to get immediate access to preview local Pro features for 3 days?`,
				{ modal: true },
				startTrial,
				cancel,
			);

			if (result !== startTrial) return false;

			void container.subscription.startPreviewTrial(source);
			break;
		} else if (subscription.account == null) {
			const signUp = { title: 'Try GitLens Pro' };
			const signIn = { title: 'Sign In' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to start your free ${proTrialLengthInDays}-day Pro trial for full access to all GitLens Pro features?`,
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
			const upgrade = { title: 'Upgrade to Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to upgrade for full access to all GitLens Pro features?`,
				{ modal: true },
				upgrade,
				cancel,
			);

			if (result === upgrade) {
				void container.subscription.upgrade(SubscriptionPlanId.Pro, source);
			}
		}

		return false;
	}

	return true;
}
