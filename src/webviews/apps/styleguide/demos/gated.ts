import { html } from 'lit';
import type { PendingPermission } from '../../../../agents/provider.js';
import { SubscriptionState } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Promo } from '../../../../plus/gk/models/promo.js';
import type { AiModelInfo } from '../../../rpc/services/types.js';
import '../../shared/components/agents/gl-agent-prompt-detail.js';
import '../../shared/components/button.js';
import '../../shared/components/feature-gate.js';
import '../../shared/components/gl-ai-model-chip.js';
import '../../shared/components/promo.js';
import type { ComponentGroup } from './types.js';

const FEATURE_GATE_SOURCE: Source = { source: 'feature-gate' };

/**
 * Imperatively mounts a <gl-feature-gate> into `stage` on click and removes it again when the
 * gate's own "Switch Repos" affordance fires. The gate has no other dismiss path by design — it's
 * a hard access block that calls dialog.showModal() on every render while `state` isn't Trial/Paid
 * (see feature-gate.ts's updated()) — so mounting it unconditionally in the demo grid would trap
 * the whole page behind a modal with no way out. Gating it behind a click keeps the rest of the
 * Components tab usable, and reuses the gate's real close-adjacent event instead of a fake button.
 */
function mountFeatureGateDemo(stage: HTMLElement, state: SubscriptionState): void {
	if (stage.querySelector('gl-feature-gate') != null) return;

	const gate = document.createElement('gl-feature-gate');
	gate.state = state;
	gate.allowRepoSwitch = true;
	gate.source = FEATURE_GATE_SOURCE;
	gate.featureWithArticleIfNeeded = 'the Commit Graph';
	gate.innerHTML = '<p slot="feature">Full commit graph preview would render here.</p>';
	gate.addEventListener('gl-switch-repos', () => gate.remove());
	stage.append(gate);
}

const PROMO_SOURCE: Source = { source: 'feature-gate' };

const PROMO_INFO: Promo = {
	key: 'pro50',
	plan: 'pro',
	content: {
		quickpick: { detail: '50% off GitLens Pro annual plans.' },
		webview: { info: { html: '<strong>50% off</strong> GitLens Pro annual plans — today only.' } },
	},
};

const PROMO_LINK: Promo = {
	key: 'pro50',
	plan: 'pro',
	content: {
		quickpick: { detail: '50% off GitLens Pro annual plans.' },
		webview: {
			link: { html: 'Get 50% off GitLens Pro', title: 'Limited-time offer', command: 'gitlens.plus.upgrade' },
		},
	},
};

const PROMO_ICON_ONLY: Promo = {
	key: 'pro50',
	plan: 'pro',
	content: { quickpick: { detail: '50% off GitLens Pro annual plans.' }, webview: {} },
};

const AI_MODEL_CLAUDE: AiModelInfo = {
	id: 'anthropic:claude-sonnet-5',
	name: 'Claude Sonnet 5',
	provider: { id: 'anthropic', name: 'Anthropic' },
};

const AI_MODEL_GITKRAKEN: AiModelInfo = {
	id: 'gitkraken:claude-sonnet-5',
	name: 'Claude Sonnet 5',
	provider: { id: 'gitkraken', name: 'GitKraken AI' },
	consumptionRateLabel: '2x',
};

const PERMISSION_TOOL: PendingPermission = {
	kind: 'tool',
	toolName: 'Bash',
	toolDescription: 'Bash(git log --oneline -20 -- src/git/gitProviderService.ts)',
	toolInputDescription: 'Inspect recent history for gitProviderService.ts',
};

const PERMISSION_PLAN: PendingPermission = {
	kind: 'plan',
	toolName: 'ExitPlanMode',
	toolDescription: 'ExitPlanMode',
	planSummary:
		'Refactor gitProviderService.ts to extract blame-cache invalidation into a dedicated BlameCacheInvalidator, then update the three call sites in trackers/documentTracker.ts.',
	planFilePath: '/Users/keith/repos/gitlens/.work/dev/blame-cache-invalidation/plan.md',
};

const PERMISSION_QUESTION: PendingPermission = {
	kind: 'question',
	toolName: 'AskUserQuestion',
	toolDescription: 'AskUserQuestion',
	questionText: 'Should the blame cache invalidate on branch checkout, or only on commit?',
	questionCount: 3,
};

const PERMISSION_ELICITATION: PendingPermission = {
	kind: 'elicitation',
	toolName: 'gk-mcp-provider',
	toolDescription: 'gk-mcp-provider',
};

export const gatedGroups: ComponentGroup[] = [
	{
		family: 'Context-dependent (stubbed)',
		description:
			'These normally read live subscription, promo, or agent state through context/IPC. Here they run off ' +
			'hand-built stub data and property assignment instead of a real subscription or agent session.',
		demos: [
			{
				label: 'gl-feature-gate (state=Community)',
				render: () => html`
					<gl-button
						@click=${(e: Event) =>
							mountFeatureGateDemo(
								(e.currentTarget as HTMLElement).nextElementSibling as HTMLElement,
								SubscriptionState.Community,
							)}
					>
						Open feature gate (Community)
					</gl-button>
					<div class="feature-gate-stage"></div>
				`,
				note: 'Opens a real native <dialog> (showModal) that covers the page. Close it via the "Switch Repos" button inside — that fires gl-switch-repos, which the demo listens for to unmount the gate. Escape and backdrop clicks are intentionally inert (a hard access gate by design, not a demo bug).',
			},
			{
				label: 'gl-feature-gate (state=TrialExpired)',
				render: () => html`
					<gl-button
						@click=${(e: Event) =>
							mountFeatureGateDemo(
								(e.currentTarget as HTMLElement).nextElementSibling as HTMLElement,
								SubscriptionState.TrialExpired,
							)}
					>
						Open feature gate (Trial expired)
					</gl-button>
					<div class="feature-gate-stage"></div>
				`,
				note: 'Also mounts the nested gl-promo teaser through the real promosContext (provided by GlAppHost). The styleguide host has no handler for ApplicablePromoRequest, so that request settles with no promo and the teaser silently renders nothing — the upgrade CTA above it is unaffected.',
			},
			{
				label: 'gl-feature-gate (state=VerificationRequired)',
				render: () => html`
					<gl-button
						@click=${(e: Event) =>
							mountFeatureGateDemo(
								(e.currentTarget as HTMLElement).nextElementSibling as HTMLElement,
								SubscriptionState.VerificationRequired,
							)}
					>
						Open feature gate (Verify email)
					</gl-button>
					<div class="feature-gate-stage"></div>
				`,
				note: 'Resend Email / refresh buttons are plain command: links — no-op outside the extension host, same as every other command-link button already in the styleguide.',
			},
			{
				label: 'gl-feature-gate (state=TrialReactivationEligible)',
				render: () => html`
					<gl-button
						@click=${(e: Event) =>
							mountFeatureGateDemo(
								(e.currentTarget as HTMLElement).nextElementSibling as HTMLElement,
								SubscriptionState.TrialReactivationEligible,
							)}
					>
						Open feature gate (Reactivate trial)
					</gl-button>
					<div class="feature-gate-stage"></div>
				`,
			},
			{
				label: 'gl-promo (type=info)',
				layout: 'block',
				render: () =>
					html`<gl-promo
						type="info"
						.promoPromise=${Promise.resolve(PROMO_INFO)}
						.source=${PROMO_SOURCE}
					></gl-promo>`,
			},
			{
				label: 'gl-promo (type=link)',
				layout: 'block',
				render: () =>
					html`<gl-promo
						type="link"
						.promoPromise=${Promise.resolve(PROMO_LINK)}
						.source=${PROMO_SOURCE}
					></gl-promo>`,
				note: "The command-url fallback in getCommandUrl() only honors content.link.command when it already starts with the literal string 'command:' — a valid GlExtensionCommands value like 'gitlens.plus.upgrade' never does, so the href always falls back to command:gitlens.plus.upgrade regardless of what's stubbed here. Pre-existing behavior, not something this demo works around.",
			},
			{
				label: 'gl-promo (type=icon)',
				render: () =>
					html`<gl-promo
						type="icon"
						.promoPromise=${Promise.resolve(PROMO_ICON_ONLY)}
						.source=${PROMO_SOURCE}
					></gl-promo>`,
			},
			{
				label: 'gl-promo (no applicable promo)',
				render: () =>
					html`<gl-promo
						type="info"
						.promoPromise=${Promise.resolve(undefined)}
						.source=${PROMO_SOURCE}
					></gl-promo>`,
				note: "Renders nothing once the promise resolves — confirms the empty state doesn't leave a layout gap or console error.",
			},
			{
				label: 'gl-ai-model-chip (model selected)',
				layout: 'block',
				render: () => html`<gl-ai-model-chip .model=${AI_MODEL_CLAUDE}></gl-ai-model-chip>`,
			},
			{
				label: 'gl-ai-model-chip (GitKraken AI, consumption rate)',
				layout: 'block',
				render: () => html`<gl-ai-model-chip .model=${AI_MODEL_GITKRAKEN}></gl-ai-model-chip>`,
			},
			{
				label: 'gl-ai-model-chip (no model selected)',
				layout: 'block',
				render: () => html`<gl-ai-model-chip></gl-ai-model-chip>`,
				note: 'Click dispatches a bubbling switch-model CustomEvent that the styleguide does not handle (no-op) — harmless for demo purposes.',
			},
			{
				label: 'gl-agent-prompt-detail (kind=tool)',
				layout: 'block',
				render: () => html`<gl-agent-prompt-detail .permission=${PERMISSION_TOOL}></gl-agent-prompt-detail>`,
			},
			{
				label: 'gl-agent-prompt-detail (kind=plan)',
				layout: 'block',
				render: () => html`<gl-agent-prompt-detail .permission=${PERMISSION_PLAN}></gl-agent-prompt-detail>`,
				note: 'Caption row renders a real gl-action-chip (href is a command: link — no-ops outside the extension host) and a functional gl-copy-container that actually writes planFilePath to the clipboard via navigator.clipboard.',
			},
			{
				label: 'gl-agent-prompt-detail (kind=question)',
				layout: 'block',
				render: () =>
					html`<gl-agent-prompt-detail .permission=${PERMISSION_QUESTION}></gl-agent-prompt-detail>`,
			},
			{
				label: 'gl-agent-prompt-detail (kind=elicitation)',
				layout: 'block',
				render: () =>
					html`<gl-agent-prompt-detail .permission=${PERMISSION_ELICITATION}></gl-agent-prompt-detail>`,
			},
		],
	},
];
