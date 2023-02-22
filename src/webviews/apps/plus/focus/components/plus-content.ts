import { css, customElement, FASTElement, html, observable, volatile, when } from '@microsoft/fast-element';
import type { Subscription } from '../../../../../subscription';
import { SubscriptionState } from '../../../../../subscription';
import { focusOutline } from '../../../shared/components/styles/a11y';
import { elementBase } from '../../../shared/components/styles/base';
import '../../../shared/components/code-icon';

const template = html<PlusContent>`
	${when(x => x.state !== SubscriptionState.Free, html<PlusContent>` <hr class="divider" /> `)}
	<div class="main">
		${when(
			x => x.state === SubscriptionState.Free,
			html<PlusContent>`
				<!-- <h3>
					GitLens+ features are
					<a title="Learn more about GitLens+ features" href="command:gitlens.plus.learn"
						>powerful, additional features</a
					>
					that enhance your GitLens experience.
				</h3> -->

				<p class="mb-1">
					<vscode-button @click="${x => x.fireAction('command:gitlens.plus.startPreviewTrial')}"
						>Try the Focus View</vscode-button
					>
				</p>
			`,
		)}
		${when(
			x => x.state === SubscriptionState.FreePreviewTrialExpired,
			html<PlusContent>`
				<h3>Extend Your GitLens Pro Trial</h3>
				<p>
					Your free 3-day GitLens Pro trial has ended, extend your trial to get an additional free 7-days of
					the Focus View and other GitLens+ features on private repos.
				</p>
				<p class="mb-1">
					<vscode-button @click="${x => x.fireAction('command:gitlens.plus.loginOrSignUp')}"
						>Extend Pro Trial</vscode-button
					>
				</p>
			`,
		)}
		${when(
			x => x.state === SubscriptionState.FreePlusTrialExpired,
			html<PlusContent>`
				<h3>GitLens Pro Trial Expired</h3>
				<p>
					Your GitLens Pro trial has ended, please upgrade to GitLens Pro to continue to use the Focus View
					and other GitLens+ features on private repos.
				</p>
				<p class="mb-1">
					<vscode-button @click="${x => x.fireAction('command:gitlens.plus.purchase')}"
						>Upgrade to Pro</vscode-button
					>
				</p>
			`,
		)}
		${when(
			x => x.state === SubscriptionState.VerificationRequired,
			html<PlusContent>`
				<h3>Please verify your email</h3>
				<p class="alert__message">
					Before you can also use the Focus View and other GitLens+ features on private repos, please verify
					your email address.
				</p>
				<p class="mb-1">
					<vscode-button @click="${x => x.fireAction('command:gitlens.plus.resendVerification')}"
						>Resend Verification Email</vscode-button
					>
				</p>
				<p class="mb-1">
					<vscode-button @click="${x => x.fireAction('command:gitlens.plus.validate')}"
						>Refresh Verification Status</vscode-button
					>
				</p>
			`,
		)}
	</div>

	<div class="secondary">
		<p class="mb-1">
			All other
			<a title="Learn more about GitLens+ features" href="command:gitlens.plus.learn">GitLens+ features</a>
			are free for local and public repos, no account required, while upgrading to GitLens Pro gives you access on
			private repos.
		</p>
		<p class="mb-0">All other GitLens features can always be used on any repo.</p>
	</div>
`;

const styles = css`
	${elementBase}

	:host {
		display: block;
		/* text-align: center; */
	}

	:host(:focus) {
		outline: none;
	}

	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
	}

	a:hover {
		color: var(--vscode-textLink-activeForeground);
		text-decoration: underline;
	}

	a:focus {
		${focusOutline}
	}

	h3,
	p {
		margin-top: 0;
	}

	h3 a {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: var(--color-foreground--50);
	}

	h3 a:hover {
		text-decoration-color: inherit;
	}

	.mb-1 {
		margin-bottom: 0.6rem;
	}
	.mb-0 {
		margin-bottom: 0;
	}

	.main {
		text-align: center;
		margin: 3rem 0;
	}

	.secondary {
		font-size: 1.4rem;
	}

	.divider {
		display: block;
		height: 0;
		margin: 0.6rem;
		border: none;
		border-top: 0.1rem solid var(--vscode-menu-separatorBackground);
	}
`;

@customElement({ name: 'plus-content', template: template, styles: styles })
export class PlusContent extends FASTElement {
	@observable
	subscription?: Subscription;

	@volatile
	get state(): SubscriptionState {
		return this.subscription?.state ?? SubscriptionState.Free;
	}

	@volatile
	get isPro() {
		return ![
			SubscriptionState.Free,
			SubscriptionState.FreePreviewTrialExpired,
			SubscriptionState.FreePlusTrialExpired,
			SubscriptionState.VerificationRequired,
		].includes(this.state);
	}

	@volatile
	get planName() {
		const label = this.subscription?.plan.effective.name;
		switch (this.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
				return 'GitLens Free';
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return 'GitLens Pro (Trial)';
			case SubscriptionState.VerificationRequired:
				return `${label} (Unverified)`;
			default:
				return label;
		}
	}

	fireAction(command: string) {
		this.$emit('action', command);
	}
}
