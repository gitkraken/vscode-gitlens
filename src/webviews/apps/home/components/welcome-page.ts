import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GlCommands } from '../../../../constants.commands.js';
import { SubscriptionState } from '../../../../constants.subscription.js';
import { ExecuteCommand } from '../../../protocol.js';
import type { State } from '../../../welcome/protocol.js';
import { scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../shared/contexts/telemetry.js';
import { stateContext } from '../../welcome/context.js';
import { welcomeStyles } from './welcome-page.css.js';
import '../../shared/components/gitlens-logo-circle.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import './welcome-parts.js';
import type { WalkthroughStep } from './welcome-parts.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-welcome-page': GlWelcomePage;
	}
}

type TelemetryData = {
	viewedCarouselPages: number;
	proButtonClicked: boolean;
};

const walkthroughSteps: WalkthroughStep[] = [
	{
		id: 'get-started-community',
		title: 'Welcome to GitLens',
		body: html`
			<p>
				The GitLens Community edition lets you track code changes and see who made them with inline blame
				annotations, hovers, and more—completely free.
			</p>
			<p>
				With <strong>GitLens Pro</strong> (Free 14-Day Trial), you’ll get full access to advanced visualization,
				collaboration, and built-in AI:
			</p>
			<ul>
				<li><strong>Commit Graph:</strong> visualize every branch and commit relationship</li>
				<li>
					<strong>Visual File History:</strong> see how a file has evolved with a graph of what changed and
					when
				</li>
				<li><strong>Launchpad & Worktrees:</strong> manage PRs and branches in one hub</li>
				<li><strong>GitKraken AI:</strong> writes commits, PRs & changelogs for you.</li>
			</ul>
			<gl-button class="start-trial-button" href="command:gitlens.walkthrough.plus.signUp"
				>Get Started with GitLens Pro</gl-button
			>
			<p>or <a href="command:gitlens.walkthrough.plus.login">sign in</a></p>
		`,
		condition: plusState => !plusState || plusState < SubscriptionState.Trial,
	},

	{
		id: 'welcome-in-trial',
		title: 'Welcome to GitLens Pro',
		body: html`
			<p>Thanks for starting your <strong>GitLens Pro</strong> trial.</p>
			<p>
				Complete this walkthrough to experience enhanced PR review tools, deeper code history visualizations,
				and streamlined collaboration to help boost your productivity.
			</p>
			<a href="command:gitlens.walkthrough.openWalkthrough">Continue the Walkthrough</a>
			<p>
				Once your trial ends, you'll return to <strong>GitLens Community</strong> — where you can still leverage
				features like in-editor blame annotations, hovers, CodeLens, and more.
			</p>
			<gl-button class="start-trial-button" href="command:gitlens.walkthrough.plus.upgrade"
				>Upgrade to GitLens Pro</gl-button
			>
		`,
		condition: plusState => plusState === SubscriptionState.Trial,
	},

	{
		id: 'welcome-in-trial-expired',
		title: 'Get the most out of GitLens',
		body: html`
			<p>Thanks for installing GitLens and trying out GitLens Pro.</p>
			<p>
				You're now on the <strong>GitLens Community</strong> edition. Track code changes and see who made them
				with features like in-editor blame annotations, hovers, CodeLens, and more—completely free.
			</p>
			<p>
				Learn more about the
				<a href="command:gitlens.walkthrough.openCommunityVsPro">difference between GitLens Community vs. Pro</a
				>.
			</p>
			<p><strong>Unlock more powerful tools with GitLens Pro</strong></p>
			<gl-button class="start-trial-button" href="command:gitlens.walkthrough.plus.upgrade"
				>Upgrade to GitLens Pro</gl-button
			>
			<p>
				With GitLens Pro, you can accelerate PR reviews, visualize code history in-depth, and enhance
				collaboration across your team. It's the perfect upgrade to streamline your VS Code workflow.
			</p>
		`,
		condition: plusState => plusState === SubscriptionState.TrialExpired,
	},

	{
		id: 'welcome-in-trial-expired-eligible',
		title: 'Get the most out of GitLens',
		body: html`
			<p>Thanks for installing GitLens and trying out GitLens Pro.</p>
			<p>
				You're using <strong>GitLens Community</strong> edition. Track code changes and see who made them with
				features like in-editor blame annotations, hovers, CodeLens, and more—completely free.
			</p>
			<p><strong>Unlock more powerful tools — Try GitLens Pro again</strong> free for another 14 days.</p>
			<gl-button class="start-trial-button" href="command:gitlens.walkthrough.plus.reactivate"
				>Reactivate GitLens Pro Trial</gl-button
			>
			<p>
				With GitLens Pro, you can accelerate PR reviews, visualize code history in-depth, and enhance
				collaboration across your team. It's the perfect upgrade to streamline your VS Code workflow.
			</p>
		`,
		condition: plusState => plusState === SubscriptionState.TrialReactivationEligible,
	},

	{
		id: 'welcome-paid',
		title: 'Discover the Benefits of GitLens Pro',
		body: html`
			<p>
				As a GitLens Pro user, you have access to powerful tools that accelerate PR reviews, provide deeper code
				history visualizations, and streamline collaboration across your team.
			</p>
			<gl-button href="command:gitlens.walkthrough.openWalkthrough">Continue the Walkthrough</gl-button>
			<p class="card-part--tip">
				<em>Tip:</em> To get the most out of your GitLens Pro experience, complete the walkthrough and visit our
				Help Center for in-depth guides.
			</p>
			<a href="command:gitlens.walkthrough.openHelpCenter">Learn more in the Help Center</a>
		`,
		condition: plusState => plusState === SubscriptionState.Paid,
	},

	{
		id: 'visualize-code-history',
		title: "Commit Graph: See Your Code's Story",
		body: html`
			<p>
				Navigate complex repositories with a searchable, color-coded commit timeline. Instantly understand
				branch relationships, authorship patterns, and commit sequences.
			</p>
			<p>
				Select multiple commits to batch operations like cherry-picking or generate AI changelogs with a single
				command.
			</p>
			<gl-button href="command:gitlens.walkthrough.showGraph">Discover your Commit Graph</gl-button>
		`,
	},

	{
		id: 'ai-features',
		title: 'Commit smarter, not harder',
		body: html`
			<p>
				Let AI handle the heavy lifting - from turning your changes into clear, logical commits to getting
				context on others' work. GitLens’s AI features make reviews efficient and keep your history clean.
			</p>
			<ul>
				<li>
					<strong>Auto-Compose Commits:</strong> instantly generate a sequence of commits with descriptive
					summaries in an interactive editor
				</li>
				<li>
					<strong>Explain Commits and Branches:</strong> understand changes without wasting time diving into
					the diffs
				</li>
				<li><strong>Create PR Titles & Descriptions:</strong> save reviewers 10+ minutes per review</li>
			</ul>
			<p>
				Stay in control. Review and edit AI suggestions before finalizing, and
				<a href="command:gitlens.ai.switchProvider">configure your preferred AI provider</a>
				and model to fit your needs.
			</p>
			<gl-button href="command:gitlens.walkthrough.showComposer">Compose Commits with AI</gl-button>
		`,
	},

	{
		id: 'git-blame',
		title: 'Learn the why behind every code Line',
		body: html`
			<p>See who changed a line, when and why — without leaving your editor.</p>
			<p>Hover over blame annotations to:</p>
			<ul>
				<li>View previous file revisions</li>
				<li>Open related PRs</li>
				<li>Jump to commits in the Graph</li>
				<li>Compare with previous versions</li>
			</ul>
			<gl-button href="command:gitlens.showSettingsPage!current-line">Configure Inline Blame</gl-button>
		`,
	},

	{
		id: 'accelerate-pr-reviews',
		title: 'Manage all your work in one place',
		body: html`
			<p>Keep everything at your fingertips with Launchpad & Worktrees.</p>
			<ul>
				<li><strong>Launchpad:</strong> view and manage all your PRs and branches from one hub</li>
				<li><strong>Worktrees:</strong> code, test, and review on multiple branches in parallel</li>
				<li>
					<strong>Integrations:</strong> connect PRs and issues from GitHub, GitLab, Jira, Azure DevOps & more
				</li>
			</ul>
			<p>Stay in flow, ship faster, and never lose track of what matters.</p>
			<gl-button href="command:gitlens.walkthrough.showLaunchpad">Open Launchpad</gl-button>
		`,
	},
];

@customElement('gl-welcome-page')
export class GlWelcomePage extends LitElement {
	static override styles = [scrollableBase, welcomeStyles];

	private telemetryData: TelemetryData = {
		viewedCarouselPages: 0,
		proButtonClicked: false,
	};

	@property({ type: Boolean })
	closeable = false;

	@property({ type: String })
	webroot?: string;

	@property({ type: Boolean })
	private isLightTheme = false;

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume({ context: ipcContext })
	_ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	_telemetry!: TelemetryContext;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				name: 'shown',
			},
			source: { source: 'welcome' },
		});
	}

	private onStartTrial() {
		this.telemetryData.proButtonClicked = true;
		const command: GlCommands = 'gitlens.plus.signUp';
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				name: 'plus/sign-up',
				viewedCarouselPages: this.telemetryData.viewedCarouselPages,
			},
			source: { source: 'welcome' },
		});
		this._ipc.sendCommand(ExecuteCommand, { command: command, args: [{ source: 'welcome' }] });
	}

	private onClose() {
		this._telemetry.sendEvent({
			name: 'welcome/action',
			data: {
				name: 'dismiss',
				viewedCarouselPages: this.telemetryData.viewedCarouselPages,
				proButtonClicked: this.telemetryData.proButtonClicked,
			},
			source: { source: 'welcome', detail: 'dismiss-in-body' },
		});
		this.dispatchEvent(new CustomEvent('close'));
	}

	private onFeatureAppeared() {
		this.telemetryData.viewedCarouselPages++;
	}

	getTelemetryData(): TelemetryData {
		return { ...this.telemetryData };
	}

	override render(): unknown {
		if (!this._state) return nothing;

		return html`
			<div part="page" class="welcome scrollable">
				<div class="section plain header">
					<h1><gitlens-logo-circle></gitlens-logo-circle><span>Get Started with GitLens</span></h1>
					<p>
						Supercharge Git and unlock untapped knowledge within your repo to better understand, write, and
						review code.
					</p>
				</div>
				<div class="section">
					<hr />
					<p>3/5 steps complete</p>
				</div>
				<div class="section plain">
					${walkthroughSteps
						.filter(step => !step.condition || step.condition(this._state.plusState))
						.map(
							step => html`
								<gl-walkthrough-step class="card">
									<h1 slot="title">${step.title}</h1>
									${step.body}
								</gl-walkthrough-step>
							`,
						)}
				</div>
			</div>
		`;
	}
}
