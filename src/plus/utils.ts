import type { MessageItem } from 'vscode';
import { env, Uri, window } from 'vscode';
import type { Container } from '../container';
import { isSubscriptionPaidPlan } from './gk/account/subscription';

export async function ensurePaidPlan(title: string, container: Container): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Verification' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
				{ modal: true },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification()) {
					continue;
				}
			}

			return false;
		}

		const plan = subscription.plan.effective.id;
		if (isSubscriptionPaidPlan(plan)) break;

		if (subscription.account == null) {
			const signIn = { title: 'Start Free GitKraken Trial' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nTry our developer productivity and collaboration services free for 7 days.`,
				{ modal: true },
				signIn,
				cancel,
			);

			if (result === signIn) {
				if (await container.subscription.loginOrSignUp()) {
					continue;
				}
			}
		} else {
			const upgrade = { title: 'Upgrade to Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nContinue to use our developer productivity and collaboration services.`,
				{ modal: true },
				upgrade,
				cancel,
			);

			if (result === upgrade) {
				void container.subscription.purchase();
			}
		}

		return false;
	}

	return true;
}

export async function ensureAccount(title: string, container: Container): Promise<boolean> {
	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Verification' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
				{ modal: true },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification()) {
					continue;
				}
			}

			return false;
		}

		if (subscription.account != null) break;

		const signIn = { title: 'Sign In / Sign Up' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`${title}\n\nGain access to our developer productivity and collaboration services.`,
			{ modal: true },
			signIn,
			cancel,
		);

		if (result === signIn) {
			if (await container.subscription.loginOrSignUp()) {
				continue;
			}
		}

		return false;
	}

	return true;
}

export async function confirmDraftStorage(container: Container): Promise<boolean> {
	if (container.storage.get('confirm:draft:storage', false)) return true;

	const accept: MessageItem = { title: 'Yes' };
	const decline: MessageItem = { title: 'No', isCloseAffordance: true };
	const moreInfo: MessageItem = { title: 'More Info' };
	const result = await window.showInformationMessage(
		`Creating a Cloud Patch will store code on GitKraken's servers.\n\nDo you want to continue?`,
		{ modal: true },
		accept,
		decline,
		moreInfo,
	);

	if (result === accept) {
		void container.storage.store('confirm:draft:storage', true);
		return true;
	}

	if (result === moreInfo) {
		void env.openExternal(Uri.parse('https://help.gitkraken.com/gitlens/security'));
	}

	return false;
}
