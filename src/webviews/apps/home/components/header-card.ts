import { attr, css, customElement, FASTElement, html, ref, volatile, when } from '@microsoft/fast-element';
import { SubscriptionState } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import { numberConverter } from '../../shared/components/converters/number-converter';
import '../../shared/components/codicon';

const template = html<HeaderCard>`
	<div class="header-card__media"><img class="header-card__image" src="${x => x.image}" alt="GitLens Logo" /></div>
	<h1 class="header-card__title">
		${when(
			x => x.name === '',
			html<HeaderCard>`<span class="foreground">Git</span>Lens 12 <em>Git supercharged</em>`,
		)}
		${when(x => x.name !== '', html<HeaderCard>`<span class="foreground">${x => x.name}</span>`)}
	</h1>
	<p class="header-card__account">
		<span class="status">${x => x.planName}</span>
		<span>
			${when(
				x => x.state === SubscriptionState.Free,
				html<HeaderCard>`
					<a title="Sign in to GitLens+" href="command:gitlens.plus.loginOrSignUp">Sign In</a>
				`,
			)}
			${when(
				x => x.state === SubscriptionState.Paid,
				html<HeaderCard>`
					<a href="command:gitlens.plus.manage" aria-label="Manage Account" title="Manage Account"
						><code-icon icon="account"></code-icon></a
					>&nbsp;&nbsp;<a href="command:gitlens.plus.logout" aria-label="Sign Out" title="Sign Out"
						><code-icon icon="sign-out"></code-icon
					></a>
				`,
			)}
			${when(
				x => [SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(x.state),
				html<HeaderCard>`${x => x.daysRemaining}`,
			)}
			${when(
				x => x.state === SubscriptionState.FreePreviewTrialExpired,
				html<HeaderCard>`<a href="command:gitlens.plus.loginOrSignUp">Extend Trial</a>`,
			)}
			${when(
				x => x.state === SubscriptionState.FreePlusTrialExpired,
				html<HeaderCard>`
					<a href="command:gitlens.plus.purchase">Upgrade to Pro</a>&nbsp;&nbsp;<a
						href="command:gitlens.plus.logout"
						aria-label="Sign Out"
						title="Sign Out"
						><code-icon icon="sign-out"></code-icon
					></a>
				`,
			)}
			${when(
				x => x.state === SubscriptionState.VerificationRequired,
				html<HeaderCard>`
					<a
						href="command:gitlens.plus.resendVerification"
						title="Resend Verification Email"
						aria-label="Resend Verification Email"
						>Verify</a
					>&nbsp;<a
						href="command:gitlens.plus.validate"
						title="Refresh Verification Status"
						aria-label="Refresh Verification Status"
						><code-icon icon="sync"></code-icon
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
		<div ${ref('progressNode')} class="progress__indicator poo"></div>
	</div>
`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
		position: relative;
		display: grid;
		padding: 1rem 1rem 1.2rem;
		background-color: var(--card-background);
		border-radius: 0.4rem;
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
	}

	.header-card__image {
		width: 100%;
		aspect-ratio: 1 / 1;
		border-radius: 50%;
	}

	.header-card__title {
		font-size: var(--vscode-font-size);
		color: var(--gitlens-brand-color-2);
		margin: 0;
	}
	.header-card__title em {
		font-weight: normal;
		color: var(--color-view-foreground);
		opacity: 0.4;
		margin-left: 0.4rem;
	}
	.header-card__account {
		margin: 0;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
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
		border-bottom-left-radius: 0.4rem;
		border-bottom-right-radius: 0.4rem;
	}

	.foreground {
		color: var(--color-foreground);
	}
	.status {
		color: var(--color-foreground--75);
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
				return 'GitLens+ (Local & Public Repos)';
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return 'GitLens+ Pro Trial';
			case SubscriptionState.FreePreviewTrialExpired:
				return 'GitLens+ (Local & Public Repos)';
			case SubscriptionState.FreePlusTrialExpired:
				return 'GitLens+ (Local & Public Repos)';
			case SubscriptionState.VerificationRequired:
				return 'GitLens+ (Unverified)';
			default:
				return this.plan;
		}
	}

	updateProgressWidth() {
		this.progressNode.style.width = this.progress;
	}
}
