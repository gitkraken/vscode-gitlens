import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import { urls } from '../../../../constants.js';
import { SubscriptionState } from '../../../../constants.subscription.js';
import type { GraphWalkthroughContextKeys } from '../../../../constants.walkthroughs.js';
import { createCommandLink } from '../../../../system/commands.js';
import { welcomeStateContext } from '../state.js';
import type { WelcomeState } from '../state.js';
import { welcomeStyles } from './welcome-page.css.js';
import '../../shared/components/gitlens-logo-circle.js';
import '../../shared/components/button.js';
import '@gitlens/components/components/codeIcon.js';
import '../../shared/components/icons/icon-cube.js';
import './welcome-parts.js';
import type { GlWalkthrough, WalkthroughStep, WalkthroughStepConditionState } from './welcome-parts.js';

type GraphWalkthroughStep = {
	id: string;
	graphWalkthroughKey: GraphWalkthroughContextKeys;
	title: string;
	body: ReturnType<typeof html>;
};

declare global {
	interface HTMLElementTagNameMap {
		'gl-welcome-page': GlWelcomePage;
	}
}

const walkthroughSteps: WalkthroughStep[] = [
	{
		id: 'get-started-community',
		walkthroughKey: 'gettingStarted',
		title: l10n.t('Welcome to GitLens'),
		body: html`
			<p>
				${l10n.t('The GitLens Community edition lets you track code changes and see who made them with inline blame annotations, hovers, and more—completely free.')}
			</p>
			<p>
				${localizedContent(l10n.t('With {emphasis} (Free 14-Day Trial), you’ll get full access to advanced visualization, collaboration, and built-in AI:'), { emphasis: html`<strong>GitLens Pro</strong>` })}
			</p>
			<ul>
				<li>
					${localizedContent(l10n.t('{emphasis} visualize every branch and commit relationship'), { emphasis: html`<strong>${l10n.t('Commit Graph:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} see how a file has evolved with a graph of what changed and when'), { emphasis: html`<strong>${l10n.t('Visual File History:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} manage PRs and branches in one hub'), { emphasis: html`<strong>${l10n.t('Launchpad & Worktrees:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} writes commits, PRs & changelogs for you.'), { emphasis: html`<strong>${l10n.t('GitKraken AI:')}</strong>` })}
				</li>
			</ul>
			<div class="card-part--centered">
				<gl-button class="start-trial-button" href="command:gitlens.welcome.plus.signUp"
					>${l10n.t('Get Started with GitLens Pro')}</gl-button
				>
			</div>
			<p>
				${localizedContent(l10n.t('or {link}'), { link: html`<a href="command:gitlens.welcome.plus.login">${l10n.t('sign in')}</a>` })}
			</p>
		`,
		condition: state => !state.plusState || state.plusState < SubscriptionState.Trial,
	},

	{
		id: 'welcome-in-trial',
		walkthroughKey: 'gettingStarted',
		title: l10n.t('Welcome to GitLens Pro'),
		body: html`
			<p>
				${localizedContent(l10n.t('Thanks for starting your {emphasis} trial.'), { emphasis: html`<strong>GitLens Pro</strong>` })}
			</p>
			<p>
				${l10n.t('Complete this walkthrough to experience enhanced PR review tools, deeper code history visualizations, and streamlined collaboration to help boost your productivity.')}
			</p>
			<a href="#continue-walkthrough">${l10n.t('Continue the Walkthrough')}</a>
			<p>
				${localizedContent(l10n.t("Once your trial ends, you'll return to {emphasis} — where you can still leverage features like in-editor blame annotations, hovers, CodeLens, and more."), { emphasis: html`<strong>GitLens Community</strong>` })}
			</p>
			<div class="card-part--centered">
				<gl-button class="start-trial-button" href="command:gitlens.welcome.plus.upgrade"
					>${l10n.t('Upgrade to GitLens Pro')}</gl-button
				>
			</div>
		`,
		condition: state => state.plusState === SubscriptionState.Trial,
	},

	{
		id: 'welcome-in-trial-expired',
		walkthroughKey: 'gettingStarted',
		title: l10n.t('Get the most out of GitLens'),
		body: html`
			<p>${l10n.t('Thanks for installing GitLens and trying out GitLens Pro.')}</p>
			<p>
				${localizedContent(l10n.t("You're now on the {emphasis} edition. Track code changes and see who made them with features like in-editor blame annotations, hovers, CodeLens, and more—completely free."), { emphasis: html`<strong>GitLens Community</strong>` })}
			</p>
			<p>
				${localizedContent(l10n.t('Learn more about the {link}.'), { link: html`<a href="command:gitlens.welcome.openCommunityVsPro">${l10n.t('difference between GitLens Community vs. Pro')}</a>` })}
			</p>
			<p>${html`<strong>${l10n.t('Unlock more powerful tools with GitLens Pro')}</strong>`}</p>
			<div class="card-part--centered">
				<gl-button class="start-trial-button" href="command:gitlens.welcome.plus.upgrade"
					>${l10n.t('Upgrade to GitLens Pro')}</gl-button
				>
			</div>
			<p>
				${l10n.t("With GitLens Pro, you can accelerate PR reviews, visualize code history in-depth, and enhance collaboration across your team. It's the perfect upgrade to streamline your VS Code workflow.")}
			</p>
		`,
		condition: state => state.plusState === SubscriptionState.TrialExpired,
	},

	{
		id: 'welcome-in-trial-expired-eligible',
		walkthroughKey: 'gettingStarted',
		title: l10n.t('Get the most out of GitLens'),
		body: html`
			<p>${l10n.t('Thanks for installing GitLens and trying out GitLens Pro.')}</p>
			<p>
				${localizedContent(l10n.t("You're using {emphasis} edition. Track code changes and see who made them with features like in-editor blame annotations, hovers, CodeLens, and more—completely free."), { emphasis: html`<strong>GitLens Community</strong>` })}
			</p>
			<p>
				${localizedContent(l10n.t('{emphasis} free for another 14 days.'), { emphasis: html`<strong>${l10n.t('Unlock more powerful tools — Try GitLens Pro again')}</strong>` })}
			</p>
			<div class="card-part--centered">
				<gl-button class="start-trial-button" href="command:gitlens.welcome.plus.reactivate"
					>${l10n.t('Reactivate GitLens Pro Trial')}</gl-button
				>
			</div>
			<p>
				${l10n.t("With GitLens Pro, you can accelerate PR reviews, visualize code history in-depth, and enhance collaboration across your team. It's the perfect upgrade to streamline your VS Code workflow.")}
			</p>
		`,
		condition: state => state.plusState === SubscriptionState.TrialReactivationEligible,
	},

	{
		id: 'welcome-paid',
		walkthroughKey: 'gettingStarted',
		title: l10n.t('Discover the Benefits of GitLens Pro'),
		body: html`
			<p>
				${l10n.t('As a GitLens Pro user, you have access to powerful tools that accelerate PR reviews, provide deeper code history visualizations, and streamline collaboration across your team.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="#continue-walkthrough">${l10n.t('Continue the Walkthrough')}</gl-button>
			</div>
			<p class="card-part--tip">
				${localizedContent(l10n.t('{tip} To get the most out of your GitLens Pro experience, complete the walkthrough and visit our Help Center for in-depth guides.'), { tip: html`<em>${l10n.t('Tip:')}</em>` })}
			</p>
			<a href="command:gitlens.welcome.openHelpCenter">${l10n.t('Learn more in the Help Center')}</a>
		`,
		condition: state => state.plusState === SubscriptionState.Paid,
	},

	{
		id: 'visualize-code-history',
		walkthroughKey: 'visualizeCodeHistory',
		title: l10n.t('Commit Graph: Your Command Center'),
		body: html`
			<p>
				${localizedContent(l10n.t('The {emphasis} brings your development and agentic workflows together. Parallelize your work — manage multiple active worktrees, orchestrate concurrent agents, and execute your entire Git lifecycle without context-switching.'), { emphasis: html`<strong>${l10n.t('Commit Graph')}</strong>` })}
			</p>
			<ul>
				<li>
					${localizedContent(l10n.t('{emphasis} Review changes, stage files, compose commits, and resolve conflicts — with guided next steps like pull, push, or draft a PR.'), { emphasis: html`<strong>${l10n.t('Complete Your Entire Workflow:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} Launch, monitor, and interact with agents directly from the graph to approve permissions and review execution plans inline.'), { emphasis: html`<strong>${l10n.t('Orchestrate Agents:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} Restructure changes into clean, review-ready commits and catch issues early with severity-tagged reviews you can delegate to an agent.'), { emphasis: html`<strong>${l10n.t('AI Compose & Review:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} Navigate complex repositories with a searchable, color-coded commit timeline. Instantly understand branch relationships, authorship patterns, and commit sequences.'), { emphasis: html`<strong>${l10n.t('Unmatched Git Context:')}</strong>` })}
				</li>
			</ul>
			<div class="card-part--centered">
				<gl-button href="command:gitlens.welcome.showGraph">${l10n.t('Discover your Commit Graph')}</gl-button>
			</div>
		`,
	},

	{
		id: 'ai-features',
		walkthroughKey: 'aiFeatures',
		title: l10n.t('Commit smarter, not harder'),
		body: html`
			<p>
				${l10n.t("Let AI handle the heavy lifting - from turning your changes into clear, logical commits to getting context on others' work. GitLens’s AI features make reviews efficient and keep your history clean.")}
			</p>
			<ul>
				<li>
					${localizedContent(l10n.t('{emphasis} instantly generate a sequence of commits with descriptive summaries in an interactive editor'), { emphasis: html`<strong>${l10n.t('Auto-Compose Commits:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} understand changes without wasting time diving into the diffs'), { emphasis: html`<strong>${l10n.t('Explain Commits and Branches:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} save reviewers 10+ minutes per review'), { emphasis: html`<strong>${l10n.t('Create PR Titles & Descriptions:')}</strong>` })}
				</li>
			</ul>
			<p>
				${localizedContent(l10n.t('Stay in control. Review and edit AI suggestions before finalizing, and {link} and model to fit your needs.'), { link: html`<a href="command:gitlens.ai.switchProvider">${l10n.t('configure your preferred AI provider')}</a>` })}
			</p>
			<div class="card-part--centered">
				<gl-button href="command:gitlens.welcome.showComposer">${l10n.t('Compose Commits')}</gl-button>
			</div>
		`,
	},

	{
		id: 'git-blame',
		walkthroughKey: 'gitBlame',
		title: l10n.t('Learn the why behind every code Line'),
		body: html`
			<p>${l10n.t('See who changed a line, when and why — without leaving your editor.')}</p>
			<p>${l10n.t('Hover over blame annotations to:')}</p>
			<ul>
				<li>${l10n.t('View previous file revisions')}</li>
				<li>${l10n.t('Open related PRs')}</li>
				<li>${l10n.t('Jump to commits in the Graph')}</li>
				<li>${l10n.t('Compare with previous versions')}</li>
			</ul>
			<div class="card-part--centered">
				<gl-button href="command:gitlens.showSettingsPage!current-line"
					>${l10n.t('Configure Inline Blame')}</gl-button
				>
			</div>
		`,
	},

	{
		id: 'accelerate-pr-reviews',
		walkthroughKey: 'prReviews',
		title: l10n.t('Manage all your work in one place'),
		body: html`
			<p>${l10n.t('Keep everything at your fingertips with Launchpad & Worktrees.')}</p>
			<ul>
				<li>
					${localizedContent(l10n.t('{emphasis} view and manage all your PRs and branches from one hub'), { emphasis: html`<strong>${l10n.t('Launchpad:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} code, test, and review on multiple branches in parallel'), { emphasis: html`<strong>${l10n.t('Worktrees:')}</strong>` })}
				</li>
				<li>
					${localizedContent(l10n.t('{emphasis} connect PRs and issues from GitHub, GitLab, Jira, Azure DevOps & more'), { emphasis: html`<strong>${l10n.t('Integrations:')}</strong>` })}
				</li>
			</ul>
			<p>${l10n.t('Stay in flow, ship faster, and never lose track of what matters.')}</p>
			<div class="card-part--centered">
				<gl-button href="command:gitlens.welcome.showLaunchpad">${l10n.t('Open Launchpad')}</gl-button>
			</div>
		`,
	},

	{
		id: 'kepler',
		walkthroughKey: 'kepler',
		title: l10n.t('Take your agent workflows further'),
		body: html`
			<p>
				${l10n.t("GitLens helps you understand and review agent-generated work inside your IDE. Kepler, GitKraken's Agentic Development Environment (ADE), gives you a dedicated workspace to coordinate AI agents, organize Tasks, and manage complex development workflows from one place.")}
			</p>
			<p>
				${l10n.t('Start from an issue or pull request, and Kepler creates the environment, launches the agent, and keeps related work organized in a single Task across repositories.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="command:gitlens.welcome.openKepler">${l10n.t('Get Kepler')}</gl-button>
			</div>
		`,
	},

	{
		id: 'mcp-bundled',
		walkthroughKey: 'mcpFeatures',
		title: l10n.t('GitKraken MCP'),
		body: html`
			<p>
				${l10n.t('GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. You can also connect MCP to other agents on your machine.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.ai.mcp.installForAllAgents', { source: 'welcome' })}"
					>${l10n.t('Connect More Agents')}</gl-button
				>
			</div>
			<p>${html`<a href="${urls.helpCenterMCP}">${l10n.t('Learn more in the Help Center')}</a>`}</p>
		`,
		condition: state => state.mcpNeedsInstall === false && !state.mcpShowCleanupNotice,
	},
	{
		id: 'mcp-bundled-cleanup',
		walkthroughKey: 'mcpFeatures',
		title: l10n.t('GitKraken MCP'),
		body: html`
			<p>
				${l10n.t('GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. You can also connect MCP to other agents on your machine.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.ai.mcp.installForAllAgents', { source: 'welcome' })}"
					>${l10n.t('Connect More Agents')}</gl-button
				>
			</div>
			<p>
				${localizedContent(l10n.t('{emphasis} You may have a duplicate entry in your Cursor {code} from a previous install. Remove {code2} to clean it up.'), { emphasis: html`<strong>${l10n.t('Note:')}</strong>`, code: html`<code>mcp.json</code>`, code2: html`<code>mcpServers.GitKraken</code>` })}
			</p>
			<p>${html`<a href="${urls.helpCenterMCP}">${l10n.t('Learn more in the Help Center')}</a>`}</p>
		`,
		condition: state => state.mcpNeedsInstall === false && state.mcpShowCleanupNotice,
	},

	{
		id: 'mcp-install',
		walkthroughKey: 'mcpFeatures',
		title: l10n.t('Install GitKraken MCP for GitLens'),
		body: html`
			<p>
				${l10n.t('Leverage Git and your integrations (issues, PRs, etc) to provide context and perform actions in AI chat.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.ai.mcp.install', { source: 'welcome' })}"
					>${l10n.t('Install GitKraken MCP')}</gl-button
				>
			</div>
			<p>${html`<a href="${urls.helpCenterMCP}">${l10n.t('Learn more')}</a>`}</p>
		`,
		condition: state => state.mcpNeedsInstall === true,
	},
];

const graphWalkthroughSteps: GraphWalkthroughStep[] = [
	{
		id: 'graph-agent-monitoring',
		graphWalkthroughKey: 'graphAgentMonitoring',
		title: l10n.t('Stay on top of every running agent'),
		body: html`
			<p>
				${l10n.t('Every active agent session shows up alongside your work. See a status pill for each session on the branch cards in the Graph sidebar, or see associated agents in the details panel when viewing working changes. See what needs attention. Hover for the full picture. Take action — resume, respond, switch — straight from the status. No more rotating through terminal tabs or chat panes to figure out which agent needs you.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.showGraph', { sidebarPanel: 'overview' })}"
					>${l10n.t('Open the Overview Sidebar')}</gl-button
				>
			</div>
		`,
	},
	{
		id: 'graph-parallel-work',
		graphWalkthroughKey: 'graphParallelWork',
		title: l10n.t('All your parallel work, in one Graph'),
		body: html`
			<p>
				${localizedContent(l10n.t("With agents running across multiple worktrees, working changes used to mean opening another window or directory just to remember what you (or your agent) left half-finished. Not anymore. {emphasis} every worktree's working changes are visible at the same time, in the same Graph. {emphasis2} when you're heads-down on one branch, scope the Graph to just the commits that matter — the bigger picture is always one click away."), { emphasis: html`<strong>${l10n.t('Multi-WIP visibility:')}</strong>`, emphasis2: html`<strong>${l10n.t('Focused Graph mode:')}</strong>` })}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.showGraph', { action: 'scope-to-branch' })}"
					>${l10n.t('Focus the Commit Graph')}</gl-button
				>
			</div>
		`,
	},
	{
		id: 'graph-ai-review',
		graphWalkthroughKey: 'graphAiReview',
		title: l10n.t('Review changes in the details panel'),
		body: html`
			<p>
				${l10n.t("The new Review mode in the details panel reads through any commits or WIP and surfaces severity-tagged insights and a summary of changes, so you can ensure nothing's missed before you ship.")}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.showGraph', { action: 'enter-review' })}"
					>${l10n.t('Try Review Mode')}</gl-button
				>
			</div>
		`,
	},
	{
		id: 'graph-compose',
		graphWalkthroughKey: 'graphCompose',
		title: l10n.t('Compose working changes into logical Commits'),
		body: html`
			<p>
				${l10n.t('Compose mode lives right in the details panel: select files, exclude noise, and let AI split a sprawling WIP into a series of focused commits — without ever opening a separate view. Your reviewers will thank you, and so will your future self.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.showGraph', { action: 'enter-compose' })}"
					>${l10n.t('Try Compose Mode')}</gl-button
				>
			</div>
		`,
	},
	{
		id: 'graph-compare',
		graphWalkthroughKey: 'graphCompare',
		title: l10n.t('Compare any refs from your Graph selection'),
		body: html`
			<p>
				${l10n.t("Select a commit or multi-select rows in the Graph and jump straight into Compare mode in the details panel. Branch vs. branch, commit vs. commit, working changes vs. anything — just select and compare. It's the fastest way to get eyes on the exact diff you care about.")}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.showGraph', { action: 'open-compare' })}"
					>${l10n.t('Open Compare Mode')}</gl-button
				>
			</div>
		`,
	},
	{
		id: 'graph-next-steps',
		graphWalkthroughKey: 'graphNextSteps',
		title: l10n.t('Always know what to do next'),
		body: html`
			<p>
				${l10n.t('The working changes view of the details panel is your workflow guide. Selecting on a working changes row surfaces the next action that keeps the loop moving: respond to an awaiting agent, push, open a PR, resolve a conflict, finish the rebase. Nothing in flight? The integrated Launchpad points you to the next PR or issue worth picking up.')}
			</p>
			<div class="card-part--centered">
				<gl-button href="${createCommandLink('gitlens.showGraph', { action: 'show-wip' })}"
					>${l10n.t('See My Working Changes')}</gl-button
				>
			</div>
		`,
	},
];

@customElement('gl-welcome-page')
export class GlWelcomePage extends SignalWatcher(LitElement) {
	static override styles = [scrollableBase, ...welcomeStyles];

	@property({ type: Boolean })
	closeable = false;

	@property({ type: String })
	webroot?: string;

	@property({ type: Boolean })
	private isLightTheme = false;

	@consume({ context: welcomeStateContext })
	private _state!: WelcomeState;

	@query('gl-walkthrough')
	private walkthrough?: GlWalkthrough;

	private readonly handleWalkthroughFocusCommand = () => {
		return this.walkthrough?.resetToDefaultAndFocus();
	};

	private readonly handleClick = (e: MouseEvent) => {
		const target = e.composedPath()[0] as HTMLElement;
		const anchor = target.closest?.('a[href="#continue-walkthrough"]');
		const button = (e.target as HTMLElement).closest?.('gl-button[href="#continue-walkthrough"]');
		if (anchor != null || button != null) {
			e.preventDefault();
			e.stopPropagation();
			void this.walkthrough?.resetToDefaultAndFocus();
		}
	};

	override connectedCallback(): void {
		super.connectedCallback?.();
		window.addEventListener('gl-walkthrough-focus-command', this.handleWalkthroughFocusCommand);
		this.addEventListener('click', this.handleClick);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		window.removeEventListener('gl-walkthrough-focus-command', this.handleWalkthroughFocusCommand);
		this.removeEventListener('click', this.handleClick);
	}

	/** Snapshot of the condition inputs the step definitions evaluate — see `WalkthroughStepConditionState`. */
	private getStepConditionState(): WalkthroughStepConditionState {
		return {
			plusState: this._state.plusState.get(),
			mcpNeedsInstall: this._state.mcpNeedsInstall.get(),
			mcpShowCleanupNotice: this._state.mcpShowCleanupNotice.get(),
		};
	}

	override render(): unknown {
		if (this._state.mode.get() === 'graph') {
			return this.renderGraphWalkthrough();
		}
		return this.renderMainWalkthrough();
	}

	private renderMainWalkthrough(): unknown {
		const progress = this._state.walkthroughProgress.get();

		return html`
			<div part="page" class="welcome scrollable">
				<div class="section header">
					<h1>
						<gitlens-logo-circle></gitlens-logo-circle><span>${l10n.t('Get Started with GitLens')}</span>
					</h1>
					<p>
						${l10n.t('Supercharge Git and unlock untapped knowledge within your repo to better understand, write, and review code.')}
					</p>
				</div>
				<gl-walkthrough-progress
					class="section"
					.doneCount=${progress?.main.doneCount ?? 0}
					.allCount=${progress?.main.allCount ?? 0}
				></gl-walkthrough-progress>
				<div class="section section--centered">
					<p>
						<a class="back-link" href="${createCommandLink('gitlens.showWelcomeView', { mode: 'graph' })}"
							>${l10n.t('Get Started with the Commit Graph →')}</a
						>
					</p>
				</div>
				<gl-walkthrough class="section">
					${walkthroughSteps
						.filter(step => !step.condition || step.condition(this.getStepConditionState()))
						.map(
							step => html`
								<gl-walkthrough-step
									class="card"
									stepId=${step.id}
									.completed=${
										step.walkthroughKey != null &&
										progress?.main.state[step.walkthroughKey] === true
									}
								>
									<h1 slot="title">${step.title}</h1>
									${step.body}
								</gl-walkthrough-step>
							`,
						)}
				</gl-walkthrough>
				<div class="section section--centered">
					<p>
						${localizedContent(l10n.t('You also have access to the {link}, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.'), { link: html`<a href="https://gitkraken.dev/tools" target="_blank">${l10n.t('GitKraken DevEx platform')}</a>` })}
					</p>
				</div>
			</div>
		`;
	}

	private renderGraphWalkthrough(): unknown {
		const progress = this._state.walkthroughProgress.get();

		return html`
			<div part="page" class="welcome scrollable">
				<div class="section section--back">
					<a href="${createCommandLink('gitlens.showWelcomeView')}" class="back-link"
						>${l10n.t('← Back to Get Started with GitLens')}</a
					>
				</div>
				<div class="section header">
					<h1 class="header__title--graph">
						<gl-icon-cube appearance="brand" icon="gl-graph"></gl-icon-cube>
						<span>${l10n.t('Get Started with the Graph')}</span>
					</h1>
				</div>
				<gl-walkthrough-progress
					class="section"
					.doneCount=${progress?.graph.doneCount ?? 0}
					.allCount=${progress?.graph.allCount ?? 0}
				></gl-walkthrough-progress>
				<gl-walkthrough class="section">
					${graphWalkthroughSteps.map(
						step => html`
							<gl-walkthrough-step
								class="card"
								stepId=${step.id}
								.completed=${progress?.graph.state[step.graphWalkthroughKey] === true}
							>
								<h1 slot="title">${step.title}</h1>
								${step.body}
							</gl-walkthrough-step>
						`,
					)}
				</gl-walkthrough>
				<div class="section section--centered">
					<p>
						${localizedContent(l10n.t('You also have access to the {link}, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.'), { link: html`<a href="https://gitkraken.dev/tools" target="_blank">${l10n.t('GitKraken DevEx platform')}</a>` })}
					</p>
				</div>
			</div>
		`;
	}
}
