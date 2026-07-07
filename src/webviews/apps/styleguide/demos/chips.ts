import { html } from 'lit';
import { SubscriptionState } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Subscription } from '../../../../plus/gk/models/subscription.js';
import type { AgentSessionState } from '../../../home/protocol.js';
import type { AgentSessionCategory } from '../../shared/agentUtils.js';
import '../../shared/components/badges/badge.js';
import '../../shared/components/chips/action-chip.js';
import '../../shared/components/chips/autolink-chip.js';
import '../../shared/components/chips/chip-overflow.js';
import { renderLearnAboutAutolinks } from '../../shared/components/chips/learn-about-autolinks.js';
import '../../shared/components/chips/ref-overflow-chip.js';
import type { RefItem } from '../../shared/components/chips/ref-overflow-chip.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/pills/agent-status-pill.js';
import '../../shared/components/pills/tracking-status.js';
import '../../shared/components/pills/tracking.js';
import type { ComponentDemo, ComponentGroup } from './types.js';

// --- gl-feature-badge stub subscriptions ---

const badgeSource: Source = { source: 'feature-badge' };

const proPlan = {
	id: 'pro' as const,
	name: 'GitLens Pro',
	bundle: false,
	trialReactivationCount: 0,
	cancelled: false,
	startedOn: '2026-06-20T00:00:00.000Z',
	organizationId: undefined,
};

const subscriptionPaid: Subscription = {
	plan: { actual: proPlan, effective: proPlan },
	account: {
		id: 'acct_9f21',
		name: 'Keith Daulton',
		email: 'keith.daulton@gitkraken.com',
		verified: true,
		createdOn: '2025-01-10T00:00:00.000Z',
	},
	state: SubscriptionState.Paid,
};

const subscriptionVerificationRequired: Subscription = {
	...subscriptionPaid,
	account: { ...subscriptionPaid.account!, verified: false },
	state: SubscriptionState.VerificationRequired,
};

const subscriptionTrial: Subscription = {
	plan: {
		actual: { ...proPlan, startedOn: '2026-06-28T00:00:00.000Z', expiresOn: '2026-07-12T00:00:00.000Z' },
		effective: { ...proPlan, startedOn: '2026-06-28T00:00:00.000Z', expiresOn: '2026-07-12T00:00:00.000Z' },
	},
	account: undefined,
	state: SubscriptionState.Trial,
};

// The inventory only vetted Paid/VerificationRequired/Trial stubs — Community, TrialExpired, and
// TrialReactivationEligible are trivial derivations of the same shape, added so all of
// GlFeatureBadge's renderPopoverContent() branches (feature-badge.ts) get a demo.
const subscriptionCommunity: Subscription = {
	plan: {
		actual: { ...proPlan, id: 'community', name: 'GitLens Community' },
		effective: { ...proPlan, id: 'community', name: 'GitLens Community' },
	},
	account: undefined,
	state: SubscriptionState.Community,
};

const subscriptionTrialExpired: Subscription = {
	plan: {
		actual: { ...proPlan, startedOn: '2026-05-01T00:00:00.000Z', expiresOn: '2026-05-15T00:00:00.000Z' },
		effective: { ...proPlan, startedOn: '2026-05-01T00:00:00.000Z', expiresOn: '2026-05-15T00:00:00.000Z' },
	},
	account: {
		id: 'acct_9f21',
		name: 'Keith Daulton',
		email: 'keith.daulton@gitkraken.com',
		verified: true,
		createdOn: '2025-01-10T00:00:00.000Z',
	},
	state: SubscriptionState.TrialExpired,
};

const subscriptionTrialReactivationEligible: Subscription = {
	...subscriptionTrialExpired,
	state: SubscriptionState.TrialReactivationEligible,
};

// --- gl-ref-overflow-chip stub refs ---

const refsSingle: RefItem[] = [{ name: 'feature/graph-performance' }];

const refsBranches: RefItem[] = [{ name: 'main' }, { name: 'release/17.4.0' }, { name: 'feature/graph-performance' }];

const refsTagsRange: RefItem[] = [{ name: 'v17.3.0' }, { name: 'v17.3.1' }, { name: 'v17.3.2' }, { name: 'v17.4.0' }];

const refsTags: RefItem[] = [
	{ name: 'v17.4.0', icon: 'tag' },
	{ name: 'v17.3.2', icon: 'tag' },
	{ name: 'v17.3.1', icon: 'tag' },
];

// --- gl-agent-status-pill stub sessions ---

const agentWorkingSession: AgentSessionState = {
	id: 'agent-session-a1',
	providerId: 'claude-code',
	providerName: 'Claude Code',
	status: 'tool_use',
	phase: 'working',
	statusDetail: 'Edit(src/git/gitProviderService.ts)',
	worktreePath: '/Users/keith/code/gitlens-worktrees/graph-performance',
	commonPath: '/Users/keith/code/gitlens',
	lastActivity: new Date('2026-07-07T14:32:00Z'),
	phaseSince: new Date('2026-07-07T14:31:40Z'),
	isSubagent: false,
	isInWorkspace: true,
	lastPrompt: 'Refactor the graph zone hover state to use the new pointer capture helper.',
	displayName: 'Graph pointer capture refactor',
	subagentCount: 0,
};

const agentNeedsInputToolSession: AgentSessionState = {
	id: 'agent-session-b2',
	providerId: 'claude-code',
	providerName: 'Claude Code',
	status: 'permission_requested',
	phase: 'waiting',
	worktreePath: '/Users/keith/code/gitlens-worktrees/blame-gutter-fix',
	commonPath: '/Users/keith/code/gitlens',
	lastActivity: new Date('2026-07-07T14:40:12Z'),
	phaseSince: new Date('2026-07-07T14:40:12Z'),
	isSubagent: false,
	isInWorkspace: true,
	pendingPermission: {
		kind: 'tool',
		toolName: 'Bash',
		toolDescription: 'pnpm run check:fix',
		toolInputDescription: 'Run repo lint autofix before committing',
	},
	lastPrompt: 'Fix the flaky blame-gutter test and run lint autofix.',
	displayName: 'Blame gutter flaky test fix',
	subagentCount: 0,
};

const agentNeedsInputPlanSession: AgentSessionState = {
	id: 'agent-session-c3',
	providerId: 'claude-code',
	providerName: 'Claude Code',
	status: 'permission_requested',
	phase: 'waiting',
	worktreePath: '/Users/keith/code/gitlens-worktrees/inspect-wip-removal',
	lastActivity: new Date('2026-07-07T13:58:02Z'),
	phaseSince: new Date('2026-07-07T13:58:02Z'),
	isSubagent: false,
	isInWorkspace: true,
	pendingPermission: {
		kind: 'plan',
		toolName: 'ExitPlanMode',
		toolDescription: 'Exit plan mode',
		planSummary: 'Remove commitDetails wip mode and redirect deep links to the Graph WIP row.',
	},
	lastPrompt: 'Draft a plan to remove the wip-mode code paths.',
	displayName: 'Inspect wip-mode removal',
	subagentCount: 0,
};

const agentNeedsInputQuestionSession: AgentSessionState = {
	id: 'agent-session-e5',
	providerId: 'claude-code',
	providerName: 'Claude Code',
	status: 'permission_requested',
	phase: 'waiting',
	worktreePath: '/Users/keith/code/gitlens-worktrees/waterways-viz',
	commonPath: '/Users/keith/code/gitlens',
	lastActivity: new Date('2026-07-07T15:02:30Z'),
	phaseSince: new Date('2026-07-07T15:02:30Z'),
	isSubagent: false,
	isInWorkspace: true,
	pendingPermission: {
		kind: 'question',
		toolName: 'AskUserQuestion',
		toolDescription: 'Clarify the tributary layout before continuing',
		questionText: 'Should tributary workstreams merge visually at the base branch, or stay parallel?',
		questionCount: 2,
	},
	lastPrompt: 'Prototype the Waterways tributary visualization for the graph minimap.',
	displayName: 'Waterways tributary viz',
	subagentCount: 0,
};

const agentNeedsInputElicitationSession: AgentSessionState = {
	id: 'agent-session-f6',
	providerId: 'claude-code',
	providerName: 'Claude Code',
	status: 'permission_requested',
	phase: 'waiting',
	worktreePath: '/Users/keith/code/gitlens-worktrees/inspect-wip-removal-followup',
	commonPath: '/Users/keith/code/gitlens',
	lastActivity: new Date('2026-07-07T15:10:05Z'),
	phaseSince: new Date('2026-07-07T15:10:05Z'),
	isSubagent: false,
	isInWorkspace: true,
	pendingPermission: {
		kind: 'elicitation',
		toolName: 'mcp__linear__create_issue',
		toolDescription: 'Linear MCP server requests additional input before creating the follow-up issue',
	},
	lastPrompt: 'File a follow-up issue for the remaining wip-mode cleanup.',
	displayName: 'Inspect wip-mode follow-up issue',
	subagentCount: 0,
};

const agentIdleSession: AgentSessionState = {
	id: 'agent-session-d4',
	providerId: 'claude-code',
	providerName: 'Claude Code',
	status: 'idle',
	phase: 'idle',
	worktreePath: '/Users/keith/code/gitlens-worktrees/css-color-revamp',
	lastActivity: new Date('2026-07-07T12:05:00Z'),
	phaseSince: new Date('2026-07-07T12:05:00Z'),
	isSubagent: false,
	isInWorkspace: true,
	lastPrompt: 'Document the --gl-color-* faithful-aliasing rule in the styleguide.',
	displayName: 'CSS color revamp docs',
	subagentCount: 0,
};

const agentSummaryWorking: { category: AgentSessionCategory; sessions: readonly AgentSessionState[] } = {
	category: 'working',
	sessions: [
		agentWorkingSession,
		{
			...agentWorkingSession,
			id: 'agent-session-a5',
			displayName: 'Home overview polish',
			statusDetail: 'Read(src/webviews/home/protocol.ts)',
			lastPrompt: 'Polish the overview branch cards spacing.',
		},
		{
			...agentWorkingSession,
			id: 'agent-session-a6',
			displayName: 'Launchpad summary RPC',
			statusDetail: undefined,
			lastPrompt: 'Wire the Launchpad summary through the RPC pipeline.',
		},
	],
};

const badgesAndChips: ComponentDemo[] = [
	{
		label: 'gl-badge (default, unset appearance)',
		render: () => html`<gl-badge>12</gl-badge>`,
	},
	{
		label: 'gl-badge appearance=filled',
		render: () => html`<gl-badge appearance="filled">3</gl-badge>`,
	},
	{
		label: 'gl-badge appearance=warning',
		render: () => html`<gl-badge appearance="warning">Conflict</gl-badge>`,
	},
	{
		label: 'gl-badge appearance=experimental',
		render: () => html`<gl-badge appearance="experimental">Beta</gl-badge>`,
	},
	{
		label: 'gl-badge appearance=muted (nested in filled)',
		render: () =>
			html`<gl-badge appearance="filled"
				>3 of 5 staged <gl-badge appearance="muted">+2 mixed</gl-badge></gl-badge
			>`,
		note: 'Documents the intended nesting pattern — a muted sub-count carved into a filled badge.',
	},
	{
		label: 'gl-feature-badge (no subscription)',
		render: () => html`<gl-feature-badge></gl-feature-badge>`,
		note: 'Popover shows only the generic header — subscription==null short-circuits the promo fetch.',
	},
	{
		label: 'gl-feature-badge preview',
		render: () => html`<gl-feature-badge preview></gl-feature-badge>`,
	},
	{
		label: 'gl-feature-badge cloud',
		render: () => html`<gl-feature-badge cloud></gl-feature-badge>`,
	},
	{
		label: 'gl-feature-badge subscription=Paid',
		render: () => html`<gl-feature-badge .subscription=${subscriptionPaid}></gl-feature-badge>`,
		note: 'Check-icon badge + account-link popover content; Paid never calls getApplicablePromo().',
	},
	{
		label: 'gl-feature-badge subscription=VerificationRequired',
		render: () => html`<gl-feature-badge .subscription=${subscriptionVerificationRequired}></gl-feature-badge>`,
		note: 'Resend Email / Validate buttons use createCommandLink hrefs — no-op if clicked in the styleguide.',
	},
	{
		label: 'gl-feature-badge subscription=Trial',
		render: () =>
			html`<gl-feature-badge .subscription=${subscriptionTrial} .source=${badgeSource}></gl-feature-badge>`,
		note: "Opening the popover renders a <gl-promo> that calls promos.getApplicablePromo() over IPC; the styleguide host doesn't implement that request, so the promo slot silently resolves empty — the rest of the popover still renders.",
	},
	{
		label: 'gl-feature-badge subscription=TrialExpired',
		render: () => html`<gl-feature-badge .subscription=${subscriptionTrialExpired}></gl-feature-badge>`,
	},
	{
		label: 'gl-feature-badge subscription=TrialReactivationEligible',
		render: () =>
			html`<gl-feature-badge .subscription=${subscriptionTrialReactivationEligible}></gl-feature-badge>`,
	},
	{
		label: 'gl-feature-badge subscription=Community (default)',
		render: () => html`<gl-feature-badge .subscription=${subscriptionCommunity}></gl-feature-badge>`,
		note: '"Local Pro features" copy + start-trial actions — the fallback branch for any unmatched state.',
	},
	{
		label: 'gl-action-chip icon+label (tooltip)',
		render: () =>
			html`<gl-action-chip icon="git-branch" label="Switch branch">feature/graph-performance</gl-action-chip>`,
	},
	{
		label: 'gl-action-chip href + truncate',
		render: () =>
			html`<div class="demo-narrow">
				<gl-action-chip
					href="https://github.com/gitkraken/vscode-gitlens/pull/4821"
					icon="link-external"
					label="Open pull request"
					truncate
					>#4821 Improve blame gutter performance on large files</gl-action-chip
				>
			</div>`,
		note: 'constrained to 20rem so the label actually ellipsizes.',
	},
	{
		label: 'gl-action-chip overlay=popover',
		render: () =>
			html`<gl-action-chip
				icon="info"
				overlay="popover"
				label="Autolinks let you jump straight from a commit message to the issue or PR it references."
				>Autolinks</gl-action-chip
			>`,
	},
	{
		label: 'gl-action-chip disabled',
		render: () => html`<gl-action-chip icon="sync" label="Sync changes" disabled>Sync</gl-action-chip>`,
	},
	{
		label: 'gl-action-chip icon=loading (spin modifier)',
		render: () => html`<gl-action-chip icon="loading" label="Fetching…">Fetching</gl-action-chip>`,
	},
	{
		label: 'gl-action-chip alt-icon/alt-label (Alt-key modifier)',
		render: () =>
			html`<gl-action-chip
				icon="git-commit"
				label="Copy commit SHA"
				alt-icon="copy"
				alt-label="Copy full SHA"
				.activeIcon=${'check'}
				>4f9a21c</gl-action-chip
			>`,
		note: "activeIcon has no attribute rename in source, so it's bound via .activeIcon= rather than a kebab-case attribute. The Alt-key swap itself only shows on a real Alt/Shift keydown.",
	},
	{
		label: 'gl-autolink-chip type=pr status=opened',
		render: () =>
			html`<gl-autolink-chip
				type="pr"
				identifier="#4821"
				name="Improve blame gutter performance on large files"
				url="https://github.com/gitkraken/vscode-gitlens/pull/4821"
				status="opened"
				author="keith-daulton"
				.date=${'2026-07-05T18:20:00Z'}
				?openOnRemote=${true}
			></gl-autolink-chip>`,
	},
	{
		label: 'gl-autolink-chip type=pr status=merged + reviewDecision',
		render: () =>
			html`<gl-autolink-chip
				type="pr"
				identifier="#4790"
				name="Split the styleguide into Colors and Components tabs"
				url="https://github.com/gitkraken/vscode-gitlens/pull/4790"
				status="merged"
				author="eamodio"
				.reviewDecision=${'Approved'}
				.date=${'2026-07-01T14:32:00Z'}
			></gl-autolink-chip>`,
	},
	{
		label: 'gl-autolink-chip type=pr isDraft',
		render: () =>
			html`<gl-autolink-chip
				type="pr"
				identifier="#4855"
				name="Prototype Waterways tributary visualization"
				url="https://github.com/gitkraken/vscode-gitlens/pull/4855"
				status="opened"
				?isDraft=${true}
				author="keith-daulton"
			></gl-autolink-chip>`,
	},
	{
		label: 'gl-autolink-chip type=issue status=closed',
		render: () =>
			html`<gl-autolink-chip
				type="issue"
				identifier="#3521"
				name="Blame gutter flickers on rapid scroll"
				url="https://github.com/gitkraken/vscode-gitlens/issues/3521"
				status="closed"
			></gl-autolink-chip>`,
	},
	{
		label: 'gl-autolink-chip type=autolink (custom, e.g. Jira)',
		render: () =>
			html`<gl-autolink-chip
				type="autolink"
				identifier="JIRA-1092"
				name="Investigate flaky launchpad summary test"
				url="https://gitkraken.atlassian.net/browse/JIRA-1092"
			></gl-autolink-chip>`,
	},
	{
		label: 'gl-autolink-chip details (expanded popover body)',
		render: () =>
			html`<gl-autolink-chip
				type="pr"
				identifier="#4821"
				name="Improve blame gutter performance on large files"
				url="https://github.com/gitkraken/vscode-gitlens/pull/4821"
				status="opened"
				author="keith-daulton"
				?details=${true}
			></gl-autolink-chip>`,
	},
	{
		label: 'gl-chip-overflow max-rows=1 (branch refs, single row)',
		layout: 'block',
		render: () =>
			html`<gl-chip-overflow>
				<gl-ref-overflow-chip .refs=${[{ name: 'main' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'feature/graph-performance' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'bug/#3521-blame-gutter' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'release/17.4.0' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'debt/webview-css-design-tokens' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'feature/#3498-launchpad-summary' }]}></gl-ref-overflow-chip>
				<div slot="popover">
					Overflowed refs collapse behind the "+N" chip — real consumers slot a duplicate item list here (see
					gl-details-commit-panel.ts renderAutoLinksPopover).
				</div>
			</gl-chip-overflow>`,
		note: 'Overflow only triggers once the demo stage is narrower than the combined chip width — marked block so it gets the full grid width.',
	},
	{
		label: 'gl-chip-overflow max-rows=2 + suffix action-chip',
		layout: 'block',
		render: () =>
			html`<gl-chip-overflow max-rows="2">
				<gl-ref-overflow-chip .refs=${[{ name: 'main' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'develop' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'feature/graph-performance' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'bug/#3521-blame-gutter' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'release/17.4.0' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'debt/webview-css-design-tokens' }]}></gl-ref-overflow-chip>
				<gl-action-chip slot="suffix" icon="ellipsis" label="More branches"></gl-action-chip>
			</gl-chip-overflow>`,
	},
	{
		label: 'gl-chip-overflow prefix slot, no overflow',
		render: () =>
			html`<gl-chip-overflow>
				<code-icon slot="prefix" icon="git-branch"></code-icon>
				<gl-ref-overflow-chip .refs=${[{ name: 'main' }]}></gl-ref-overflow-chip>
				<gl-ref-overflow-chip .refs=${[{ name: 'develop' }]}></gl-ref-overflow-chip>
			</gl-chip-overflow>`,
	},
	{
		label: 'gl-chip-overflow autolink/issue chips + learn-about-autolinks suffix',
		layout: 'block',
		render: () =>
			html`<gl-chip-overflow max-rows="1">
				<gl-autolink-chip
					type="pr"
					identifier="#4821"
					name="Improve blame gutter performance on large files"
					url="https://github.com/gitkraken/vscode-gitlens/pull/4821"
					status="opened"
					?openOnRemote=${true}
				></gl-autolink-chip>
				<gl-autolink-chip
					type="issue"
					identifier="#3521"
					name="Blame gutter flickers on rapid scroll"
					url="https://github.com/gitkraken/vscode-gitlens/issues/3521"
					status="closed"
				></gl-autolink-chip>
				${renderLearnAboutAutolinks({ hasIntegrationsConnected: true, hasAccount: true, slotName: 'suffix' })}
			</gl-chip-overflow>`,
		note: 'Mirrors the real composition in gl-details-commit-panel.ts. That panel also slots a duplicate item list into slot="popover" for the "+N" view — omitted here; if overflow triggers, the "+N" popover renders empty with no visual break.',
	},
	{
		label: 'gl-ref-overflow-chip single ref',
		render: () => html`<gl-ref-overflow-chip .refs=${refsSingle}></gl-ref-overflow-chip>`,
	},
	{
		label: 'gl-ref-overflow-chip multiple refs + label header',
		render: () =>
			html`<gl-ref-overflow-chip
				label="Branches containing this commit"
				.refs=${refsBranches}
			></gl-ref-overflow-chip>`,
	},
	{
		label: 'gl-ref-overflow-chip multiple refs range=true',
		render: () => html`<gl-ref-overflow-chip range .refs=${refsTagsRange}></gl-ref-overflow-chip>`,
	},
	{
		label: 'gl-ref-overflow-chip per-ref icon override (tags)',
		render: () => html`<gl-ref-overflow-chip .refs=${refsTags}></gl-ref-overflow-chip>`,
		note: "Component-level icon falls back to its default ('git-branch'); each RefItem's own icon:'tag' visibly overrides it.",
	},
	{
		label: 'renderLearnAboutAutolinks (no integrations, no account)',
		render: () => renderLearnAboutAutolinks({ hasIntegrationsConnected: false, hasAccount: false }),
		note: 'Configure autolinks / Connect an Integration links use createCommandLink hrefs — no-op if clicked in the styleguide.',
	},
	{
		label: 'renderLearnAboutAutolinks (integrations connected)',
		render: () => renderLearnAboutAutolinks({ hasIntegrationsConnected: true, hasAccount: true }),
	},
	{
		label: 'renderLearnAboutAutolinks showLabel',
		render: () => renderLearnAboutAutolinks({ hasIntegrationsConnected: true, hasAccount: true, showLabel: true }),
	},
	{
		label: 'renderLearnAboutAutolinks slotName=suffix inside gl-chip-overflow',
		layout: 'block',
		render: () =>
			html`<gl-chip-overflow>
				<gl-ref-overflow-chip .refs=${[{ name: 'main' }]}></gl-ref-overflow-chip>
				${renderLearnAboutAutolinks({ hasIntegrationsConnected: true, hasAccount: true, slotName: 'suffix' })}
			</gl-chip-overflow>`,
	},
];

const pillsAndTracking: ComponentDemo[] = [
	{
		label: 'gl-agent-status-pill session=working (compact)',
		render: () => html`<gl-agent-status-pill .session=${agentWorkingSession}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-agent-status-pill session=needs-input (tool permission)',
		render: () => html`<gl-agent-status-pill .session=${agentNeedsInputToolSession}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-agent-status-pill session=needs-input (plan permission)',
		render: () => html`<gl-agent-status-pill .session=${agentNeedsInputPlanSession}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-agent-status-pill session=needs-input (question)',
		render: () => html`<gl-agent-status-pill .session=${agentNeedsInputQuestionSession}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-agent-status-pill session=needs-input (elicitation)',
		render: () => html`<gl-agent-status-pill .session=${agentNeedsInputElicitationSession}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-agent-status-pill session=idle',
		render: () => html`<gl-agent-status-pill .session=${agentIdleSession}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-agent-status-pill full session=working',
		layout: 'block',
		render: () => html`<gl-agent-status-pill full .session=${agentWorkingSession}></gl-agent-status-pill>`,
		note: "full mode sets :host([full-active]) { display:block; width:100% } — marked block so the grid card doesn't squeeze it.",
	},
	{
		label: 'gl-agent-status-pill full session=needs-input (tool permission)',
		layout: 'block',
		render: () => html`<gl-agent-status-pill full .session=${agentNeedsInputToolSession}></gl-agent-status-pill>`,
		note: 'needs-input + canResolve renders the Allow / Deny / More-actions trio inline instead of the single Open Session affordance.',
	},
	{
		label: 'gl-agent-status-pill summary category=working ×3',
		render: () => html`<gl-agent-status-pill .summary=${agentSummaryWorking}></gl-agent-status-pill>`,
	},
	{
		label: 'gl-tracking-status behind=3',
		wide: true,
		render: () =>
			html`<gl-tracking-status
				branch-name="feature/graph-performance"
				upstream-name="origin/feature/graph-performance"
				behind="3"
			></gl-tracking-status>`,
	},
	{
		label: 'gl-tracking-status ahead+behind colorized',
		wide: true,
		render: () =>
			html`<gl-tracking-status
				branch-name="bug/#3521-blame-gutter"
				upstream-name="origin/bug/#3521-blame-gutter"
				ahead="2"
				behind="5"
				colorized
			></gl-tracking-status>`,
	},
	{
		label: 'gl-tracking-status missing-upstream',
		wide: true,
		render: () =>
			html`<gl-tracking-status
				branch-name="feature/waterways-viz"
				missing-upstream
				upstream-name="origin/feature/waterways-viz"
			></gl-tracking-status>`,
	},
	{
		label: 'gl-tracking-status up-to-date outlined',
		wide: true,
		render: () =>
			html`<gl-tracking-status branch-name="main" upstream-name="origin/main" outlined></gl-tracking-status>`,
	},
	{
		label: 'gl-tracking-status with extra slotted content',
		wide: true,
		render: () =>
			html`<gl-tracking-status branch-name="release/17.4.0" upstream-name="origin/release/17.4.0" ahead="1">
				<p slot="extra">Working tree has 2 uncommitted changes.</p>
			</gl-tracking-status>`,
	},
	{
		label: 'gl-tracking-pill ahead=2 behind=5',
		render: () => html`<gl-tracking-pill ahead="2" behind="5"></gl-tracking-pill>`,
	},
	{
		label: 'gl-tracking-pill colorized ahead+behind',
		render: () => html`<gl-tracking-pill ahead="2" behind="5" colorized></gl-tracking-pill>`,
	},
	{
		label: 'gl-tracking-pill outlined',
		render: () => html`<gl-tracking-pill ahead="1" outlined></gl-tracking-pill>`,
	},
	{
		label: 'gl-tracking-pill always-show (up to date)',
		render: () => html`<gl-tracking-pill always-show></gl-tracking-pill>`,
	},
	{
		label: 'gl-tracking-pill always-show missing-upstream',
		render: () => html`<gl-tracking-pill always-show ?missingUpstream=${true}></gl-tracking-pill>`,
		note: "missingUpstream has no attribute rename in source, so the plain kebab attribute wouldn't map — bound via ?missingUpstream=.",
	},
	{
		label: 'gl-tracking-pill working=4 colorized',
		render: () => html`<gl-tracking-pill working="4" colorized></gl-tracking-pill>`,
	},
];

export const chipsGroups: ComponentGroup[] = [
	{
		family: 'Badges & chips',
		description:
			'Status badges, feature-gating badges, and action/overflow chips used in commit, PR, and branch summaries.',
		demos: badgesAndChips,
	},
	{
		family: 'Pills & tracking',
		description: 'Agent session status pills and ahead/behind tracking pills for branches and worktrees.',
		demos: pillsAndTracking,
	},
];
