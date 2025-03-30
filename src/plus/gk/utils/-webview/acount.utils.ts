import type { Uri } from 'vscode';
import { window } from 'vscode';
import { proTrialLengthInDays, SubscriptionPlanId } from '../../../../constants.subscription';
import type { Source } from '../../../../constants.telemetry';
import type { Container } from '../../../../container';
import type { PlusFeatures } from '../../../../features';
import { createQuickPickSeparator } from '../../../../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../../../../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../../../../quickpicks/items/directive';

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

		const signUp = { title: 'Try GitLens Pro' };
		const signIn = { title: 'Sign In' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`${title}\n\nStart your free ${proTrialLengthInDays}-day Pro trial for full access to all GitLens Pro features, or sign in.`,
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

		let placeholder = 'Requires an account to continue';
		if (account?.verified === false) {
			directives.push(
				createDirectiveQuickPickItem(Directive.RequiresVerification, true),
				createQuickPickSeparator(),
				createDirectiveQuickPickItem(Directive.Cancel),
			);
			placeholder = 'You must verify your email before you can continue';
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

		const upgrade = { title: 'Upgrade to Pro' };
		const cancel = { title: 'Cancel', isCloseAffordance: true };
		const result = await window.showWarningMessage(
			`${title}\n\nPlease upgrade to GitLens Pro to continue.`,
			{ modal: true },
			upgrade,
			cancel,
		);

		if (result === upgrade) {
			if (await container.subscription.upgrade(SubscriptionPlanId.Pro, source)) {
				continue;
			}
		}

		return false;
	}

	return true;
}
