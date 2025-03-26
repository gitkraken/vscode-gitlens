import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { Source } from '../../../../constants.telemetry';
import type { Container } from '../../../../container';
import type { PlusFeatures } from '../../../../features';

export async function ensureAccount(container: Container, title: string, source: Source): Promise<boolean> {
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

		if (subscription.account != null) break;

		const signUp = { title: 'Sign Up' };
		const signIn = { title: 'Sign In' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`${title}\n\nSign up for access to Pro features and the GitKraken DevEx platform, or sign in`,
			{ modal: true },
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

		const upgrade = { title: 'Upgrade to Pro' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`${title}\n\nPlease upgrade to GitLens Pro to continue.`,
			{ modal: true },
			upgrade,
			cancel,
		);

		if (result === upgrade) {
			if (await container.subscription.upgrade(source)) {
				continue;
			}
		}

		return false;
	}

	return true;
}
