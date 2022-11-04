import { attr, css, customElement, FASTElement, html, volatile, when } from '@microsoft/fast-element';
import { SubscriptionState } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import { numberConverter } from '../../shared/components/converters/number-converter';
import '../../shared/components/code-icon';

const template = html<PlusContent>`
	<div class="icon"><code-icon icon="info"></code-icon></div>
	<div class="content">
		${when(
			x => x.state === SubscriptionState.Free,
			html<PlusContent>`
				<p class="mb-1">
					<a title="Learn more about GitLens+ features" href="command:gitlens.plus.learn"
						>GitLens+ features</a
					>
					are free for local and public repos, no account required, while upgrading to GitLens Pro gives you
					access on private repos.
				</p>
				<p class="mb-0">All other GitLens features can always be used on any repo.</p>
			`,
		)}
		${when(
			x => x.state !== SubscriptionState.Free,
			html<PlusContent>` <p class="mb-0">All other GitLens features can always be used on any repo</p> `,
		)}
	</div>
`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
		display: flex;
		flex-direction: row;
		padding: 0.8rem 1.2rem;
		background-color: var(--color-alert-neutralBackground);
		border-left: 0.3rem solid var(--color-foreground--50);
		color: var(--color-alert-foreground);
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

	p {
		margin-top: 0;
	}

	.icon {
		display: none;
		flex: none;
		margin-right: 0.4rem;
	}

	.icon code-icon {
		font-size: 2.4rem;
		margin-top: 0.2rem;
	}

	.content {
		font-size: 1.2rem;
		line-height: 1.2;
		text-align: left;
	}

	.mb-1 {
		margin-bottom: 0.8rem;
	}
	.mb-0 {
		margin-bottom: 0;
	}
`;

@customElement({ name: 'plus-content', template: template, styles: styles })
export class PlusContent extends FASTElement {
	@attr({ converter: numberConverter })
	days = 0;

	@attr({ converter: numberConverter })
	state: SubscriptionState = SubscriptionState.Free;

	@attr
	plan = '';

	@attr
	visibility: 'local' | 'public' | 'mixed' | 'private' = 'public';

	get daysRemaining() {
		if (this.days < 1) {
			return 'less than one day';
		}
		return pluralize('day', this.days);
	}

	get isFree() {
		return ['local', 'public'].includes(this.visibility);
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
				return 'GitLens Pro (Trial)';
			case SubscriptionState.VerificationRequired:
				return `${this.plan} (Unverified)`;
			default:
				return this.plan;
		}
	}

	fireAction(command: string) {
		this.$emit('action', command);
	}
}
