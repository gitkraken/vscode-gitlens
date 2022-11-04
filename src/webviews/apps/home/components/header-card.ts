import { attr, css, customElement, FASTElement, html, ref, volatile, when } from '@microsoft/fast-element';
import { SubscriptionState } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import { numberConverter } from '../../shared/components/converters/number-converter';
import '../../shared/components/code-icon';
import '../../shared/components/overlays/pop-over';

const template = html<HeaderCard>`
	<div class="header-card__media"><img class="header-card__image" src="${x => x.image}" alt="GitLens Logo" /></div>
	<h1 class="header-card__title${x => (x.name === '' ? ' logo' : '')}">
		${when(x => x.name === '', html<HeaderCard>`Git<span class="brand">Lens</span> 13`)}
		${when(x => x.name !== '', html<HeaderCard>`${x => x.name}`)}
	</h1>
	<p class="header-card__account">
		<span class="status">
			<span class="repo-access${x => (x.isPro ? ' is-pro' : '')}">✨</span>${x => x.planName}
			<pop-over>
				You have access to GitLens+ features on ${x => (x.isPro ? 'any repo' : 'local & public repos')}, and all
				other GitLens features on any repo.
			</pop-over>
		</span>
		<span class="account-actions">
			${when(
				x => !x.hasAccount,
				html<HeaderCard>`<a class="action" href="command:gitlens.plus.loginOrSignUp">Sign In</a>`,
			)}
			${when(
				x => x.hasAccount,
				html<HeaderCard>`
					<a
						class="action is-icon"
						href="command:gitlens.plus.manage"
						aria-label="Manage Account"
						title="Manage Account"
						><code-icon icon="account"></code-icon></a
					>&nbsp;<a
						class="action is-icon"
						href="command:gitlens.plus.logout"
						aria-label="Sign Out"
						title="Sign Out"
						><code-icon icon="sign-out"></code-icon
					></a>
				`,
			)}
		</span>
	</p>
	<div
		class="progress header-card__progress"
		role="progressbar"
		aria-valuemax="${x => x.progressMax}"
		aria-valuenow="${x => x.progressNow}"
		aria-label="${x => x.progressNow} of ${x => x.progressMax} steps completed"
	>
		<div ${ref('progressNode')} class="progress__indicator"></div>
	</div>
	<span class="actions">
		${when(
			x => x.state === SubscriptionState.FreePreviewTrialExpired,
			html<HeaderCard>`<a class="action is-primary" href="command:gitlens.plus.loginOrSignUp"
				>Extend Pro Trial</a
			>`,
		)}
		${when(
			x =>
				x.state === SubscriptionState.FreeInPreviewTrial ||
				x.state === SubscriptionState.FreePlusInTrial ||
				x.state === SubscriptionState.FreePlusTrialExpired,
			html<HeaderCard>`<a class="action is-primary" href="command:gitlens.plus.purchase">Upgrade to Pro</a>`,
		)}
		${when(
			x => x.state === SubscriptionState.VerificationRequired,
			html<HeaderCard>`
				<a
					class="action is-primary"
					href="command:gitlens.plus.resendVerification"
					title="Resend Verification Email"
					aria-label="Resend Verification Email"
					>Verify</a
				>&nbsp;<a
					class="action"
					href="command:gitlens.plus.validate"
					title="Refresh Verification Status"
					aria-label="Refresh Verification Status"
					>Refresh</a
				>
			`,
		)}
	</span>
`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
		position: relative;
		display: grid;
		/*
		padding: 1rem 1rem 1.2rem;
		background-color: var(--card-background);
		border-radius: 0.4rem;
		*/
		padding: 1rem 0 1.2rem;
		gap: 0 0.8rem;
		grid-template-columns: 3.4rem auto;
		grid-auto-flow: column;
	}

	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
	}
	a:focus {
		outline-color: var(--focus-border);
	}
	a:hover {
		text-decoration: underline;
	}

	.header-card__media {
		grid-column: 1;
		grid-row: 1 / span 2;
		display: flex;
		align-items: center;
	}

	.header-card__image {
		width: 100%;
		aspect-ratio: 1 / 1;
		border-radius: 50%;
	}

	.header-card__title {
		font-size: var(--vscode-font-size);
		font-weight: 600;
		margin: 0;
	}

	.header-card__title.logo {
		font-family: 'Segoe UI Semibold', var(--font-family);
		font-size: 1.5rem;
	}

	.header-card__account {
		position: relative;
		margin: 0;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0 0.4rem;
	}

	.progress {
		width: 100%;
		overflow: hidden;
	}

	:host-context(.vscode-high-contrast) .progress,
	:host-context(.vscode-dark) .progress {
		background-color: var(--color-background--lighten-15);
	}

	:host-context(.vscode-high-contrast-light) .progress,
	:host-context(.vscode-light) .progress {
		background-color: var(--color-background--darken-15);
	}

	.progress__indicator {
		height: 4px;
		background-color: var(--vscode-progressBar-background);
	}

	.header-card__progress {
		position: absolute;
		bottom: 0;
		left: 0;
		/*
		border-bottom-left-radius: 0.4rem;
		border-bottom-right-radius: 0.4rem;
		*/
	}

	.brand {
		color: var(--gitlens-brand-color-2);
	}
	.status {
		color: var(--color-foreground--65);
		cursor: help;
	}

	.status pop-over {
		top: 1.6em;
		left: 0;
	}
	.status:not(:hover) pop-over {
		display: none;
	}

	.repo-access {
		font-size: 1.1em;
		margin-right: 0.2rem;
	}
	.repo-access:not(.is-pro) {
		filter: grayscale(1) brightness(0.7);
	}

	.actions {
		position: absolute;
		right: 0.1rem;
		top: 0.1rem;
	}

	.action {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: 0.3rem;
		color: var(--color-foreground--75);
	}
	:host-context(.vscode-high-contrast) .action.is-primary,
	:host-context(.vscode-dark) .action.is-primary {
		border: 1px solid var(--color-background--lighten-15);
	}

	:host-context(.vscode-high-contrast-light) .action.is-primary,
	:host-context(.vscode-light) .action.is-primary {
		border: 1px solid var(--color-background--darken-15);
	}

	.action.is-icon {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 2.2rem;
		height: 2.2rem;
		padding: 0;
	}
	.action:hover {
		text-decoration: none;
		color: var(--color-foreground);
	}

	:host-context(.vscode-high-contrast) .action:hover,
	:host-context(.vscode-dark) .action:hover {
		background-color: var(--color-background--lighten-10);
	}

	:host-context(.vscode-high-contrast-light) .action:hover,
	:host-context(.vscode-light) .action:hover {
		background-color: var(--color-background--darken-10);
	}
`;

@customElement({ name: 'header-card', template: template, styles: styles })
export class HeaderCard extends FASTElement {
	@attr
	image = '';

	@attr
	name = '';

	@attr({ converter: numberConverter })
	days = 0;

	@attr({ converter: numberConverter })
	steps = 4;

	@attr({ converter: numberConverter })
	completed = 0;

	@attr({ converter: numberConverter })
	state: SubscriptionState = SubscriptionState.Free;

	@attr
	plan = '';

	progressNode!: HTMLElement;

	override attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
		super.attributeChangedCallback(name, oldValue, newValue);

		if (oldValue === newValue || this.progressNode == null) {
			return;
		}
		this.updateProgressWidth();
	}

	get daysRemaining() {
		if (this.days < 1) {
			return '<1 day';
		}
		return pluralize('day', this.days);
	}

	get progressNow() {
		return this.completed + 1;
	}

	get progressMax() {
		return this.steps + 1;
	}

	@volatile
	get progress() {
		return `${(this.progressNow / this.progressMax) * 100}%`;
	}

	@volatile
	get planName() {
		switch (this.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
				return 'GitLens Free';
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return `GitLens Pro (Trial), ${this.daysRemaining} left`;
			case SubscriptionState.VerificationRequired:
				return `${this.plan} (Unverified)`;
			default:
				return this.plan;
		}
	}

	get hasAccount() {
		switch (this.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreeInPreviewTrial:
				return false;
		}
		return true;
	}

	get isPro() {
		switch (this.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
			case SubscriptionState.VerificationRequired:
				return false;
		}
		return true;
	}

	updateProgressWidth() {
		this.progressNode.style.width = this.progress;
	}
}
