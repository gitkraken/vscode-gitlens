import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { SubscriptionLoginCommandArgs } from '../../../../plus/gk/models/subscription.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { GraphShowAction } from '../../../plus/graph/protocol.js';
import { boxSizingBase, scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import { graphStateContext } from './context.js';
import { getIntentSourceDetail, intentCopyByAction } from './intentCopy.js';
import '../../shared/components/button.js';
import '../../shared/components/card/card.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/gitlens-logo-circle.js';

const src = { source: 'graph', detail: 'signin' } as const satisfies Source;

const resendVerificationCooldownSeconds = 30;
const syncStatusDelayMs = 1500;
const proStripRotationMs = 5000;

/** One slide of the sign-in screen's Pro feature spotlight strip. */
type ProStripSlide = { name: string; description: string; vignette: () => unknown };

const proStripSlides: ProStripSlide[] = [
	{
		name: 'Commit Graph',
		description:
			'Where your development and agentic workflows come together — run your entire Git lifecycle from one view.',
		vignette: renderGraphVignette,
	},
	{
		name: 'Agents & Worktrees',
		description:
			'Launch, monitor, and interact with coding agents — parallelized across worktrees, without the chaos.',
		vignette: renderWorktreesVignette,
	},
	{
		name: 'AI Compose & Review',
		description: 'Bring order from chaos — clean, review-ready commits and severity-tagged reviews.',
		vignette: renderAiVignette,
	},
	{
		name: 'AI Rebase & Resolve',
		description:
			'Guided, AI-assisted rebase and conflict resolution — see both sides, take the right changes, and finish the merge faster.',
		vignette: renderResolveVignette,
	},
	{
		name: 'Launchpad',
		description: 'Know what needs your attention — PRs, issues, and blockers, prioritized in one view.',
		vignette: renderLaunchpadVignette,
	},
	{
		name: 'Visualizations',
		description:
			'Analyze how your code evolves — Visual History, hotspots, and Files, Commits, and Agent Activity treemaps.',
		vignette: renderVizVignette,
	},
];

/** Commit Graph vignette: a main trunk with a merged and an active feature branch. */
function renderGraphVignette(): unknown {
	return svg`<svg viewBox="0 0 200 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<linearGradient id="graph-bg" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="var(--strip-panel-1)"/><stop offset="1" stop-color="var(--strip-panel-2)"/>
			</linearGradient>
			<filter id="graph-glow-b" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#3687FF" flood-opacity="0.85"/></filter>
		</defs>
		<rect width="200" height="88" fill="url(#graph-bg)"/>
		<rect width="200" height="1" fill="var(--strip-edge-light)"/>
		<circle cx="172" cy="6" r="58" fill="#3C17A7" opacity="0.22"/>
		<circle cx="8" cy="90" r="42" fill="#00A3FF" opacity="0.1"/>
		<path d="M74 92 V28 C74 18 36 24 36 14" stroke="#DD74FF" stroke-width="2" fill="none"/>
		<path d="M36 78 H102 C109 78 114 73 114 66 V54" stroke="#00A3FF" stroke-width="2" fill="none"/>
		<path d="M36 -4 V92" stroke="#3687FF" stroke-width="3.5"/>
		<circle cx="74" cy="30" r="3.5" fill="var(--strip-node-fill)" stroke="#DD74FF" stroke-width="2"/>
		<circle cx="74" cy="66" r="3.5" fill="var(--strip-node-fill)" stroke="#DD74FF" stroke-width="2"/>
		<circle cx="114" cy="54" r="3.5" fill="var(--strip-node-fill)" stroke="#00A3FF" stroke-width="2"/>
		<g filter="url(#graph-glow-b)" class="pulse-soft">
			<circle cx="36" cy="14" r="5.5" fill="var(--strip-node-fill)" stroke="#3687FF" stroke-width="3"/>
			<circle cx="36" cy="14" r="2" fill="var(--strip-node-core)"/>
		</g>
		<circle cx="36" cy="42" r="4.5" fill="var(--strip-node-fill)" stroke="#3687FF" stroke-width="3"/>
		<circle cx="36" cy="78" r="4.5" fill="var(--strip-node-fill)" stroke="#3687FF" stroke-width="3"/>
		<rect x="48" y="7.5" width="32" height="13" rx="6.5" fill="var(--strip-node-fill)" opacity="0.8"/>
		<rect x="48" y="7.5" width="32" height="13" rx="6.5" fill="#3687FF" opacity="0.2"/>
		<rect x="48" y="7.5" width="32" height="13" rx="6.5" stroke="#3687FF" opacity="0.7" fill="none"/>
		<text x="64" y="17" text-anchor="middle" font-family="var(--vscode-font-family)" font-size="8" font-weight="600" fill="var(--strip-text-blue)">main</text>
		<rect x="126" y="47.5" width="44" height="13" rx="6.5" fill="var(--strip-node-fill)" opacity="0.75"/>
		<rect x="126" y="47.5" width="44" height="13" rx="6.5" fill="#00A3FF" opacity="0.14"/>
		<rect x="126" y="47.5" width="44" height="13" rx="6.5" stroke="#00A3FF" opacity="0.55" fill="none"/>
		<text x="148" y="57" text-anchor="middle" font-family="var(--vscode-font-family)" font-size="8" font-weight="600" fill="var(--strip-text-cyan)">feature</text>
		<rect x="126" y="27.5" width="48" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.08"/>
		<rect x="126" y="39.5" width="60" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.07"/>
		<rect x="126" y="63.5" width="42" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.06"/>
		<rect x="126" y="75.5" width="54" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.05"/>
	</svg>`;
}

/** Launchpad vignette: three prioritized rows — ready to merge, needs review, blocked. */
function renderLaunchpadVignette(): unknown {
	return svg`<svg viewBox="0 0 200 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<linearGradient id="launchpad-bg" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="var(--strip-panel-1)"/><stop offset="1" stop-color="var(--strip-panel-2)"/>
			</linearGradient>
			<linearGradient id="launchpad-av1" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7a06c"/><stop offset="1" stop-color="#e05f8a"/></linearGradient>
			<linearGradient id="launchpad-av2" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5ad6c0"/><stop offset="1" stop-color="#2f7fe0"/></linearGradient>
			<linearGradient id="launchpad-av3" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c78bff"/><stop offset="1" stop-color="#6d4de0"/></linearGradient>
			<filter id="launchpad-glow-g" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-color="#2ea043" flood-opacity="0.9"/></filter>
		</defs>
		<rect width="200" height="88" fill="url(#launchpad-bg)"/>
		<rect width="200" height="1" fill="var(--strip-edge-light)"/>
		<circle cx="176" cy="4" r="58" fill="#3C17A7" opacity="0.2"/>
		<rect x="8" y="9" width="184" height="22" rx="7" fill="#2ea043" opacity="0.07"/>
		<rect x="8" y="9" width="184" height="22" rx="7" stroke="#2ea043" opacity="0.22" fill="none"/>
		<circle cx="22" cy="20" r="5.5" fill="url(#launchpad-av1)"/>
		<rect x="34" y="16.5" width="72" height="7" rx="3.5" fill="var(--strip-skeleton)" opacity="0.14"/>
		<rect x="134" y="13" width="52" height="14" rx="7" fill="#2ea043" opacity="0.18"/>
		<rect x="134" y="13" width="52" height="14" rx="7" stroke="#2ea043" opacity="0.55" fill="none"/>
		<circle cx="143" cy="20" r="2.2" fill="#57d364" filter="url(#launchpad-glow-g)" class="pulse"/>
		<text x="163" y="23" text-anchor="middle" font-family="var(--vscode-font-family)" font-size="8" font-weight="600" fill="var(--strip-text-green)">ready</text>
		<circle cx="22" cy="44" r="5.5" fill="url(#launchpad-av2)" opacity="0.85"/>
		<rect x="34" y="40.5" width="90" height="7" rx="3.5" fill="var(--strip-skeleton)" opacity="0.09"/>
		<rect x="134" y="37" width="52" height="14" rx="7" fill="#d29922" opacity="0.13"/>
		<rect x="134" y="37" width="52" height="14" rx="7" stroke="#d29922" opacity="0.4" fill="none"/>
		<circle cx="143" cy="44" r="2.2" fill="#e3b341"/>
		<text x="163" y="47" text-anchor="middle" font-family="var(--vscode-font-family)" font-size="8" font-weight="600" fill="var(--strip-text-amber)">review</text>
		<circle cx="22" cy="68" r="5.5" fill="url(#launchpad-av3)" opacity="0.7"/>
		<rect x="34" y="64.5" width="58" height="7" rx="3.5" fill="var(--strip-skeleton)" opacity="0.06"/>
		<rect x="134" y="61" width="52" height="14" rx="7" fill="#f85149" opacity="0.11"/>
		<rect x="134" y="61" width="52" height="14" rx="7" stroke="#f85149" opacity="0.35" fill="none"/>
		<circle cx="143" cy="68" r="2.2" fill="#ff7b72" opacity="0.85"/>
		<text x="163" y="71" text-anchor="middle" font-family="var(--vscode-font-family)" font-size="8" font-weight="600" fill="var(--strip-text-red)">blocked</text>
	</svg>`;
}

/** AI Compose & Review vignette: tangled working changes passed through AI into composed commits. */
function renderAiVignette(): unknown {
	return svg`<svg viewBox="0 0 200 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<linearGradient id="ai-bg" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="var(--strip-panel-1)"/><stop offset="1" stop-color="var(--strip-panel-2)"/>
			</linearGradient>
			<linearGradient id="ai-brand-lg" x1="0" y1="0" x2="1" y2="1">
				<stop stop-color="#7900c9"/><stop offset="1" stop-color="#196fff"/>
			</linearGradient>
			<filter id="ai-glow-p" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#DD74FF" flood-opacity="0.85"/></filter>
		</defs>
		<rect width="200" height="88" fill="url(#ai-bg)"/>
		<rect width="200" height="1" fill="var(--strip-edge-light)"/>
		<circle cx="24" cy="0" r="54" fill="#7900c9" opacity="0.14"/>
		<circle cx="190" cy="90" r="54" fill="#196fff" opacity="0.16"/>
		<g transform="rotate(-7 42 22)"><rect x="18" y="17" width="48" height="10" rx="3" fill="#f85149" opacity="0.2"/><rect x="18" y="17" width="48" height="10" rx="3" stroke="#f85149" opacity="0.4" fill="none"/><rect x="23" y="20.5" width="26" height="3" rx="1.5" fill="#ff8f87" opacity="0.55"/></g>
		<g transform="rotate(5 40 44)"><rect x="14" y="39" width="52" height="10" rx="3" fill="#2ea043" opacity="0.2"/><rect x="14" y="39" width="52" height="10" rx="3" stroke="#2ea043" opacity="0.4" fill="none"/><rect x="19" y="42.5" width="32" height="3" rx="1.5" fill="#6fe07c" opacity="0.5"/></g>
		<g transform="rotate(-3 44 66)"><rect x="22" y="61" width="44" height="10" rx="3" fill="#2ea043" opacity="0.14"/><rect x="22" y="61" width="44" height="10" rx="3" stroke="#2ea043" opacity="0.3" fill="none"/><rect x="27" y="64.5" width="22" height="3" rx="1.5" fill="#6fe07c" opacity="0.4"/></g>
		<g filter="url(#ai-glow-p)" class="pulse-soft">
			<path d="M98 32 L101 42 L111 45 L101 48 L98 58 L95 48 L85 45 L95 42 Z" fill="#c78bff"/>
		</g>
		<path d="M108 24 L109.4 28 L113.4 29.4 L109.4 30.8 L108 34.8 L106.6 30.8 L102.6 29.4 L106.6 28 Z" fill="#c78bff" opacity="0.6"/>
		<rect x="124" y="10" width="66" height="68" rx="9" fill="var(--strip-inset)"/>
		<rect x="124" y="10" width="66" height="68" rx="9" stroke="url(#ai-brand-lg)" stroke-opacity="0.45" fill="none"/>
		<path d="M136 20 V68" stroke="#3687FF" stroke-width="2"/>
		<circle cx="136" cy="24" r="3.5" fill="var(--strip-inset)" stroke="#3687FF" stroke-width="2"/>
		<circle cx="136" cy="44" r="3.5" fill="var(--strip-inset)" stroke="#3687FF" stroke-width="2"/>
		<circle cx="136" cy="64" r="3.5" fill="var(--strip-inset)" stroke="#3687FF" stroke-width="2"/>
		<rect x="146" y="21" width="26" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.14"/>
		<rect x="146" y="41" width="21" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.11"/>
		<rect x="146" y="61" width="24" height="5" rx="2.5" fill="var(--strip-skeleton)" opacity="0.09"/>
		<path d="M177 22 l2.4 2.6 L184 19.6" stroke="#57d364" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
		<path d="M177 42 l2.4 2.6 L184 39.6" stroke="#57d364" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
		<path d="M177 62 l2.4 2.6 L184 59.6" stroke="#57d364" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

/** AI Rebase & Resolve vignette: conflicting "ours"/"theirs" sides converging into one merge commit. */
function renderResolveVignette(): unknown {
	return svg`<svg viewBox="0 0 200 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<linearGradient id="resolve-bg" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="var(--strip-panel-1)"/><stop offset="1" stop-color="var(--strip-panel-2)"/>
			</linearGradient>
			<filter id="resolve-glow-p" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#DD74FF" flood-opacity="0.85"/></filter>
			<filter id="resolve-glow-b" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#3687FF" flood-opacity="0.85"/></filter>
		</defs>
		<rect width="200" height="88" fill="url(#resolve-bg)"/>
		<rect width="200" height="1" fill="var(--strip-edge-light)"/>
		<circle cx="20" cy="0" r="52" fill="#196fff" opacity="0.14"/>
		<circle cx="190" cy="88" r="50" fill="#7900c9" opacity="0.14"/>
		<g transform="rotate(-5 44 30)"><rect x="16" y="24" width="54" height="12" rx="3.5" fill="#3687FF" opacity="0.2"/><rect x="16" y="24" width="54" height="12" rx="3.5" stroke="#3687FF" opacity="0.45" fill="none"/><rect x="22" y="28.5" width="30" height="3" rx="1.5" fill="#9ec1ff" opacity="0.55"/></g>
		<g transform="rotate(4 46 56)"><rect x="18" y="50" width="54" height="12" rx="3.5" fill="#DD74FF" opacity="0.2"/><rect x="18" y="50" width="54" height="12" rx="3.5" stroke="#DD74FF" opacity="0.45" fill="none"/><rect x="24" y="54.5" width="26" height="3" rx="1.5" fill="#eebcff" opacity="0.5"/></g>
		<path d="M60 40 L54 47 L58 47 L52 55" stroke="#f85149" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
		<g filter="url(#resolve-glow-p)" class="pulse-soft">
			<path d="M97 34 L100 44 L110 47 L100 50 L97 60 L94 50 L84 47 L94 44 Z" fill="#c78bff"/>
		</g>
		<path d="M142 10 C142 32 162 30 162 46" stroke="#3687FF" stroke-width="2.5" fill="none"/>
		<path d="M182 10 C182 32 162 30 162 46" stroke="#DD74FF" stroke-width="2.5" fill="none"/>
		<path d="M162 46 V82" stroke="#3687FF" stroke-width="2.5"/>
		<circle cx="142" cy="16" r="3.5" fill="var(--strip-node-fill)" stroke="#3687FF" stroke-width="2"/>
		<circle cx="182" cy="16" r="3.5" fill="var(--strip-node-fill)" stroke="#DD74FF" stroke-width="2"/>
		<g filter="url(#resolve-glow-b)" class="pulse-soft">
			<circle cx="162" cy="50" r="5" fill="var(--strip-node-fill)" stroke="#3687FF" stroke-width="2.5"/>
			<circle cx="162" cy="50" r="1.8" fill="var(--strip-node-core)"/>
		</g>
		<path d="M172 64 l4 4.4 L184 60" stroke="#57d364" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`;
}

/** Visualizations vignette: a history timeline beside an activity treemap with a glowing hotspot. */
function renderVizVignette(): unknown {
	return svg`<svg viewBox="0 0 200 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<linearGradient id="viz-bg" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="var(--strip-panel-1)"/><stop offset="1" stop-color="var(--strip-panel-2)"/>
			</linearGradient>
			<linearGradient id="viz-area-c" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="#00A3FF" stop-opacity="0.28"/><stop offset="1" stop-color="#00A3FF" stop-opacity="0"/>
			</linearGradient>
			<filter id="viz-glow-c" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#00A3FF" flood-opacity="0.85"/></filter>
			<filter id="viz-glow-p" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#DD74FF" flood-opacity="0.85"/></filter>
		</defs>
		<rect width="200" height="88" fill="url(#viz-bg)"/>
		<rect width="200" height="1" fill="var(--strip-edge-light)"/>
		<circle cx="188" cy="10" r="52" fill="#3C17A7" opacity="0.18"/>
		<path d="M10 60 C26 56 32 36 50 38 C68 40 74 54 90 48 L90 76 L10 76 Z" fill="url(#viz-area-c)"/>
		<path d="M10 60 C26 56 32 36 50 38 C68 40 74 54 90 48" stroke="#00A3FF" stroke-width="2" fill="none"/>
		<circle cx="30" cy="52" r="3.5" fill="#3687FF" opacity="0.75"/>
		<circle cx="50" cy="38" r="7" fill="#DD74FF" opacity="0.45"/>
		<circle cx="50" cy="38" r="7" stroke="#DD74FF" opacity="0.75" fill="none" stroke-width="1.5"/>
		<circle cx="72" cy="48" r="4" fill="#00A3FF" opacity="0.6"/>
		<g filter="url(#viz-glow-c)" class="pulse-soft">
			<circle cx="90" cy="48" r="4" fill="var(--strip-node-fill)" stroke="#00A3FF" stroke-width="2.5"/>
			<circle cx="90" cy="48" r="1.6" fill="var(--strip-node-core)"/>
		</g>
		<rect x="12" y="70" width="18" height="4" rx="2" fill="var(--strip-skeleton)" opacity="0.06"/>
		<rect x="44" y="70" width="18" height="4" rx="2" fill="var(--strip-skeleton)" opacity="0.06"/>
		<rect x="76" y="70" width="14" height="4" rx="2" fill="var(--strip-skeleton)" opacity="0.08"/>
		<rect x="100" y="10" width="1" height="68" fill="var(--strip-skeleton)" opacity="0.08"/>
		<g filter="url(#viz-glow-p)" class="pulse-soft">
			<rect x="110" y="10" width="46" height="36" rx="3.5" fill="#DD74FF" opacity="0.34"/>
			<rect x="110" y="10" width="46" height="36" rx="3.5" stroke="#DD74FF" opacity="0.7" fill="none"/>
		</g>
		<rect x="160" y="10" width="30" height="20" rx="3.5" fill="#3687FF" opacity="0.28"/>
		<rect x="160" y="34" width="30" height="12" rx="3.5" fill="#00A3FF" opacity="0.2"/>
		<rect x="110" y="50" width="24" height="28" rx="3.5" fill="#3687FF" opacity="0.18"/>
		<rect x="138" y="50" width="26" height="28" rx="3.5" fill="#00A3FF" opacity="0.13"/>
		<rect x="168" y="50" width="22" height="28" rx="3.5" fill="var(--strip-skeleton)" opacity="0.05"/>
	</svg>`;
}

/** Agents & Worktrees vignette: one repo, three worktrees sharing a common root. */
function renderWorktreesVignette(): unknown {
	return svg`<svg viewBox="0 0 200 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<linearGradient id="worktrees-bg" x1="0" y1="0" x2="0" y2="1">
				<stop stop-color="var(--strip-panel-1)"/><stop offset="1" stop-color="var(--strip-panel-2)"/>
			</linearGradient>
			<linearGradient id="worktrees-brand-lg" x1="0" y1="0" x2="1" y2="1">
				<stop stop-color="#7900c9"/><stop offset="1" stop-color="#196fff"/>
			</linearGradient>
			<filter id="worktrees-glow-b" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="#3687FF" flood-opacity="0.85"/></filter>
			<filter id="worktrees-glow-g" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-color="#2ea043" flood-opacity="0.9"/></filter>
		</defs>
		<rect width="200" height="88" fill="url(#worktrees-bg)"/>
		<rect width="200" height="1" fill="var(--strip-edge-light)"/>
		<circle cx="100" cy="-6" r="58" fill="#3C17A7" opacity="0.16"/>
		<path d="M100 82 C100 74 40 76 40 62" stroke="#DD74FF" stroke-width="1.8" fill="none" opacity="0.5"/>
		<path d="M100 82 V62" stroke="#3687FF" stroke-width="1.8" opacity="0.7"/>
		<path d="M100 82 C100 74 160 76 160 62" stroke="#00A3FF" stroke-width="1.8" fill="none" opacity="0.5"/>
		<g filter="url(#worktrees-glow-b)"><circle cx="100" cy="82" r="3.5" fill="var(--strip-node-fill)" stroke="#3687FF" stroke-width="2.2"/></g>
		<g opacity="0.7">
			<rect x="14" y="8" width="52" height="54" rx="7" fill="var(--strip-inset)" stroke="var(--strip-inset-border)"/>
			<rect x="22" y="15" width="30" height="9" rx="4.5" fill="#DD74FF" opacity="0.2"/>
			<path d="M40 32 V54" stroke="#DD74FF" stroke-width="2" opacity="0.75"/>
			<circle cx="40" cy="38" r="3" fill="var(--strip-inset)" stroke="#DD74FF" stroke-width="2"/>
		</g>
		<rect x="74" y="8" width="52" height="54" rx="7" fill="var(--strip-inset)"/>
		<rect x="74" y="8" width="52" height="54" rx="7" stroke="url(#worktrees-brand-lg)" stroke-opacity="0.7" fill="none" stroke-width="1.5"/>
		<rect x="82" y="15" width="30" height="9" rx="4.5" fill="#3687FF" opacity="0.28"/>
		<path d="M100 32 V54" stroke="#3687FF" stroke-width="2"/>
		<circle cx="100" cy="38" r="3" fill="var(--strip-inset)" stroke="#3687FF" stroke-width="2"/>
		<circle cx="100" cy="50" r="3" fill="var(--strip-inset)" stroke="#3687FF" stroke-width="2"/>
		<g filter="url(#worktrees-glow-g)" class="pulse"><circle cx="117" cy="54" r="3.2" fill="#2ea043"/></g>
		<g opacity="0.7">
			<rect x="134" y="8" width="52" height="54" rx="7" fill="var(--strip-inset)" stroke="var(--strip-inset-border)"/>
			<rect x="142" y="15" width="30" height="9" rx="4.5" fill="#00A3FF" opacity="0.2"/>
			<path d="M160 32 V54" stroke="#00A3FF" stroke-width="2" opacity="0.75"/>
			<circle cx="160" cy="40" r="3" fill="var(--strip-inset)" stroke="#00A3FF" stroke-width="2"/>
		</g>
	</svg>`;
}

@customElement('gl-graph-access-account')
export class GlGraphAccessAccount extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		scrollableBase,
		css`
			:host {
				--link-foreground: var(--vscode-textLink-foreground);
				--link-foreground-active: var(--vscode-textLink-activeForeground);
			}

			/* No justify-content here on purpose: .content centers itself with margin-block: auto (which
			   yields the free space back to flex-start on overflow, so the top stays scrollable). A
			   justify-content: center would re-center the overflow once those auto margins zero out,
			   clipping the top of tall content in short viewports. */
			.container {
				display: flex;
				flex-direction: column;
				align-items: center;
				height: 100vh;
				padding: var(--gitlens-gutter-width);
				overflow: auto;
				background: var(--vscode-editor-background);
			}

			.content {
				display: flex;
				flex-direction: column;
				align-items: center;
				inline-size: 100%;
				max-width: 42ch;
				block-size: fit-content;
				margin-block: auto;
				text-align: center;
			}

			/* Slim, subtly-tinted notice pinned to the top of the sign-in screen for users upgrading
			   from before v19 (the Commit Graph's move to an account-gated home). flex: none keeps it
			   at its natural size at the top while .content's auto margins take the remaining space. */
			.upgrade-banner {
				display: flex;
				flex: none;
				gap: var(--gl-space-8);
				align-items: center;
				inline-size: 100%;
				padding: var(--gl-space-8) var(--gl-space-12);
				margin-inline: auto;
				font-size: var(--gl-font-md);
				line-height: 1.4;
				color: var(--color-foreground--85);
				text-align: start;
				text-wrap: pretty;
				background: color-mix(in lab, var(--vscode-editor-background) 100%, var(--vscode-foreground) 12%);
				border-inline-start: 0.2rem solid var(--color-alert-infoBorder);
				border-radius: var(--gl-radius-sm);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.upgrade-banner code-icon {
				flex: none;
				color: var(--color-alert-infoBorder);
			}

			.logo {
				margin-block: var(--gl-space-4) var(--gl-space-10);
				transform: scale(1.22);
				/* Dedicated keyframe: the shared gl-fade-up ends at translateY(0), which would overwrite the logo's scale (transform is a single property). This one carries the scale through both keyframes so the logo stays at ~56px. */
				animation: gl-fade-up-logo var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.icon-accent {
				color: var(--vscode-charts-blue);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.success {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				margin-block: 0 var(--gl-space-6);
				font-size: var(--gl-font-md);
				color: var(--vscode-descriptionForeground);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.success code-icon {
				color: var(--vscode-charts-green);
			}

			.heading {
				margin-block: 0;
				font-size: var(--gl-font-lg);
				font-weight: 600;
				color: var(--vscode-foreground);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 60ms both;
			}

			.body {
				margin-block: var(--gl-space-8) 0;
				font-size: var(--gl-font-base);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				text-wrap: pretty;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 120ms both;
			}

			.nowrap {
				white-space: nowrap;
			}

			.actions {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				inline-size: 100%;
				margin-block-start: var(--gl-space-20);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 180ms both;
			}

			.waiting {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-10);
				align-items: center;
				inline-size: 100%;
				margin-block-start: var(--gl-space-20);
				animation: gl-fade-up var(--gl-duration-slow) var(--gl-ease-out) both;
			}

			.waiting code-icon {
				--code-icon-size: 1.8rem;

				color: var(--vscode-descriptionForeground);
			}

			.waiting__status {
				font-size: var(--gl-font-md);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
			}

			.cancel {
				padding: 0;
				font-family: inherit;
				font-size: var(--gl-font-md);
				color: var(--link-foreground);
				appearance: none;
				cursor: pointer;
				background: none;
				border: none;
			}

			.cancel:hover,
			.cancel:focus-visible {
				color: var(--link-foreground-active);
				text-decoration: underline;
			}

			.cancel:focus-visible {
				outline: var(--gl-border-width) solid var(--color-focus-border);
				outline-offset: 2px;
				border-radius: var(--gl-radius-xs);
			}

			.sync-status {
				margin-block: var(--gl-space-16) 0;
				font-size: var(--gl-font-sm);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
				animation: gl-fade-up var(--gl-duration-slow) var(--gl-ease-out) both;
			}

			.learn-more {
				--button-gap: var(--gl-space-4);

				margin-block-start: var(--gl-space-16);
				font-size: var(--gl-font-sm);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 300ms both;
			}

			.walkthrough {
				--button-gap: var(--gl-space-4);

				margin-block-start: var(--gl-space-12);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 180ms both;
			}

			.setup {
				/* The component's card surface defaults derive from the sidebar background; re-derive it
				   here since this screen sits on the editor background instead. */
				--gl-card-background: color-mix(
					in lab,
					var(--vscode-editor-background) 100%,
					var(--vscode-foreground) 4%
				);
				--gl-card-hover-background: color-mix(
					in lab,
					var(--vscode-editor-background) 100%,
					var(--vscode-foreground) 8%
				);

				display: flex;
				flex-direction: column;
				inline-size: 100%;
				margin-block-start: var(--gl-space-16);
				text-align: start;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 240ms both;
			}

			.setup__label {
				margin-block: 0 var(--gl-space-6);
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.setup-card {
				display: flex;
				gap: var(--gl-space-10);
				align-items: center;
			}

			.setup-card__icon {
				flex: none;
				color: var(--vscode-charts-blue);
			}

			.setup-card__content {
				display: flex;
				flex: 1;
				flex-direction: column;
				gap: var(--gl-space-2);
			}

			.setup-card__title {
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.setup-card__hint {
				font-size: var(--gl-font-sm);
				line-height: 1.4;
				color: var(--vscode-descriptionForeground);
			}

			.setup-card__chevron {
				flex: none;
				color: var(--vscode-descriptionForeground);
			}

			.actions--last {
				position: sticky;
				bottom: calc(var(--gl-space-20) * -1);
				padding-block: var(--gl-space-8) var(--gl-space-10);
				margin-block-start: var(--gl-space-12);
				background: var(--vscode-editor-background);
				animation-delay: 300ms;
			}

			.layout {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				inline-size: 100%;
				margin-block-start: var(--gl-space-16);
				text-align: start;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 270ms both;
			}

			.layout__question {
				margin: 0;
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.layout__options {
				display: flex;
				gap: var(--gl-space-8) 0;
				justify-content: center;
			}

			.layout__option {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-16);
				font-family: inherit;
				font-size: inherit;
				color: inherit;
				appearance: none;
				cursor: pointer;
				background: none;
				border: 1px solid var(--vscode-widget-border);
				border-radius: var(--gl-radius-sm);
			}

			.layout__option:hover,
			.layout__option:focus-visible {
				outline: none;
				background-color: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-focusBorder);
			}

			.layout__option.selected {
				background-color: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-focusBorder);
				box-shadow: inset 0 0 0 var(--gl-border-width) var(--vscode-focusBorder);
			}

			.layout__option-text {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				align-items: center;
			}

			.layout__option-label {
				font-weight: 600;
			}

			.layout__illustration {
				display: block;
				width: 11.8rem;
				height: auto;
			}

			/* Designed illustrations ship as dark/light exports differing only in these colors — one
			   markup, themed via custom properties (host body carries the vscode-* theme class) */
			:host {
				--lp-frame-bg: #121212;
				--lp-frame-stroke: #363636;
				--lp-shell-bg: #2a2a2c;
				--lp-dot-fill: #d9d9d9;
				--lp-row: #808080;
				--lp-purple: #aa5bf5;
				--lp-green: #00a02e;

				/* Pro strip vignettes: dark/light exports differing only in these colors, same as the
				   layout illustrations above. */
				--strip-panel-1: #16181e;
				--strip-panel-2: #0e1015;
				--strip-inset: #171a21;
				--strip-inset-border: #2c2d33;
				--strip-node-fill: #0f1116;
				--strip-node-core: #e3efff;
				--strip-skeleton: #ffffff;
				--strip-edge-light: rgba(255, 255, 255, 0.05);
				--strip-text-blue: #b4d0ff;
				--strip-text-cyan: #9fdcff;
				--strip-text-green: #6fe07c;
				--strip-text-amber: #e3b341;
				--strip-text-red: #ff8f87;
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--lp-frame-bg: #fefefe;
				--lp-frame-stroke: #dddddd;
				--lp-shell-bg: #e3e3e3;
				--lp-dot-fill: #9c9c9c;
				--lp-row: #b4b4b4;
				--lp-purple: #c180ff;
				--lp-green: #37d865;

				--strip-panel-1: #f7f7fa;
				--strip-panel-2: #ececf1;
				--strip-inset: #ffffff;
				--strip-inset-border: #d9dade;
				--strip-node-fill: #f2f2f6;
				--strip-node-core: #1f4f9e;
				--strip-skeleton: #000000;
				--strip-edge-light: rgba(0, 0, 0, 0.05);
				--strip-text-blue: #2b5cb8;
				--strip-text-cyan: #0969a2;
				--strip-text-green: #1a7f37;
				--strip-text-amber: #9a6700;
				--strip-text-red: #cf222e;
			}

			.pro-strip {
				/* Scales continuously with viewport height (like the fluid width) — full size above
				   ~670px, easing down to the floor before the compact tier hides the strip. */
				--strip-vignette-size: clamp(12rem, 30vh, 20rem);

				display: flex;
				flex: none;
				flex-direction: column;
				align-items: center;
				inline-size: 100%;
				margin-block-start: clamp(var(--gl-space-8), 2.5vh, var(--gl-space-20));
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 360ms both;
			}

			.pro-strip__hairline {
				inline-size: 100%;
				block-size: 1px;
				margin-block-end: clamp(var(--gl-space-8), 2vh, var(--gl-space-16));
				background: linear-gradient(
					to right,
					transparent,
					var(--vscode-widget-border) 18%,
					var(--vscode-widget-border) 82%,
					transparent
				);
			}

			.pro-strip__spot {
				display: flex;
				gap: var(--gl-space-16);
				align-items: center;
				text-align: start;
			}

			.pro-strip__vignette {
				flex: none;
				inline-size: var(--strip-vignette-size);
				aspect-ratio: 200 / 88;
				overflow: hidden;
				border: 1px solid var(--strip-inset-border);
				border-radius: var(--gl-radius-md);
			}

			.pro-strip__vignette svg {
				display: block;
				inline-size: 100%;
				block-size: 100%;
			}

			.pro-strip__copy {
				inline-size: 34rem;
			}

			.pro-strip__title-row {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
			}

			.pro-strip__title {
				font-size: var(--gl-font-lg);
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.pro-strip__desc {
				min-height: 5.2rem;
				margin-block-start: var(--gl-space-4);
				font-size: var(--gl-font-md);
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
			}

			.pro-strip__slide-in {
				animation: gl-fade-up var(--gl-duration-slow) var(--gl-ease-out) both;
			}

			.pro-strip__tabs {
				display: flex;
				gap: var(--gl-space-20);
				margin-block-start: var(--gl-space-8);
				font-size: var(--gl-font-sm);
			}

			.pro-strip__tab {
				position: relative;
				padding: 0 0 var(--gl-space-4);
				font-family: inherit;
				font-size: inherit;
				color: var(--vscode-descriptionForeground);
				appearance: none;
				cursor: pointer;
				background: none;
				border: none;
			}

			.pro-strip__tab[aria-pressed='true'] {
				color: var(--vscode-foreground);
			}

			.pro-strip__tab[aria-pressed='true']::before {
				position: absolute;
				inset: auto 0 0 0;
				block-size: 0.2rem;
				content: '';
				background: color-mix(in lab, var(--vscode-editor-background) 100%, var(--vscode-foreground) 14%);
				border-radius: var(--gl-radius-xs);
			}

			.pro-strip__tab[aria-pressed='true']::after {
				position: absolute;
				inset-block-end: 0;
				inset-inline-start: 0;
				block-size: 0.2rem;
				inline-size: 100%;
				content: '';
				background: var(--gl-gradient-brand);
				border-radius: var(--gl-radius-xs);
				transform-origin: left;
				animation: pro-strip-tab-fill 5s linear forwards;
			}

			.pro-strip__tab:focus-visible {
				outline: var(--gl-border-width) solid var(--color-focus-border);
				outline-offset: 2px;
				border-radius: var(--gl-radius-xs);
			}

			.pro-strip__dots {
				display: none;
			}

			.pro-strip__dot {
				inline-size: 0.5rem;
				block-size: 0.5rem;
				padding: 0;
				appearance: none;
				cursor: pointer;
				background: color-mix(in lab, var(--vscode-editor-background) 100%, var(--vscode-foreground) 24%);
				border: none;
				border-radius: var(--gl-radius-circle);
				transition: inline-size var(--gl-duration-medium) var(--gl-ease-out);
			}

			.pro-strip__dot[aria-pressed='true'] {
				inline-size: 1.4rem;
				background: var(--gl-gradient-brand);
				border-radius: var(--gl-radius-xs);
			}

			.pro-strip__dot:focus-visible {
				outline: var(--gl-border-width) solid var(--color-focus-border);
				outline-offset: 2px;
			}

			@keyframes pro-strip-tab-fill {
				from {
					transform: scaleX(0);
				}

				to {
					transform: scaleX(1);
				}
			}

			@keyframes pro-strip-pulse {
				0%,
				100% {
					opacity: 1;
				}

				50% {
					opacity: 0.35;
				}
			}

			@keyframes pro-strip-pulse-soft {
				0%,
				100% {
					opacity: 1;
				}

				50% {
					opacity: 0.7;
				}
			}

			.pulse {
				animation: pro-strip-pulse 2.4s ease-in-out infinite;
			}

			.pulse-soft {
				animation: pro-strip-pulse-soft 3.2s ease-in-out infinite;
			}

			@keyframes gl-fade-up {
				from {
					opacity: 0;
					transform: translateY(0.6rem);
				}

				to {
					opacity: 1;
					transform: translateY(0);
				}
			}

			@keyframes gl-fade-up-logo {
				from {
					opacity: 0;
					transform: translateY(0.6rem) scale(1.22);
				}

				to {
					opacity: 1;
					transform: translateY(0) scale(1.22);
				}
			}

			/* Compact tier for short viewports (e.g. the default bottom-panel height ~265px), where the
			   comfortable spacing pushes the sign-in actions below the fold. A media query (not a container
			   query) is intentional: this screen fills the webview viewport and the host is the scroll
			   surface, so 'container-type: size' would change scroll ownership. */
			@media (height <= 360px) {
				:host {
					padding-block: var(--gl-space-12);
				}

				/* The fill-mode animation carries the 1.22 upscale, so switching to the plain keyframes is
				   what actually drops it; the static transform only applies under reduced motion. */
				.logo {
					margin-block: 0 var(--gl-space-6);
					transform: none;
					animation-name: gl-fade-up;
				}

				.actions,
				.waiting {
					margin-block-start: var(--gl-space-12);
				}

				.sync-status {
					margin-block-start: var(--gl-space-8);
				}

				.walkthrough {
					margin-block-start: var(--gl-space-8);
				}

				.setup {
					margin-block-start: var(--gl-space-10);
				}

				.layout {
					margin-block-start: var(--gl-space-10);
				}

				/* No room for a marketing strip at this tier — the sign-in actions themselves are
				   already tight against the fold. */
				.pro-strip {
					display: none;
				}
			}

			@media (width <= 559px) {
				.pro-strip__spot {
					flex-direction: column;
					align-items: center;
				}

				.pro-strip {
					--strip-vignette-size: clamp(12rem, 30vh, 26rem);
				}

				/* Fluid width with the artwork's own aspect ratio — a fixed height would make the
				   'slice' fitting crop-zoom as the ratio drifts from the 200:88 viewBox. */
				.pro-strip__vignette {
					inline-size: 100%;
					max-width: var(--strip-vignette-size);
				}

				.pro-strip__copy {
					inline-size: 100%;
					max-width: 26rem;
					text-align: center;
				}

				.pro-strip__desc {
					min-height: 4.8rem;
					font-size: var(--gl-font-sm);
				}

				.pro-strip__tabs {
					display: none;
				}

				.pro-strip__dots {
					display: flex;
					gap: var(--gl-space-6);
					justify-content: center;
					margin-block-start: var(--gl-space-6);
				}
			}

			@media (width <= 419px) or (height <= 419px) {
				.layout__illustration {
					width: 9.6rem;
				}

				.layout__options {
					gap: 0;
				}
			}

			@media (width <= 479px) {
				.layout__options {
					flex-wrap: wrap;
					align-items: center;
				}

				.layout__option {
					padding: var(--gl-space-12);
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.logo,
				.icon-accent,
				.success,
				.heading,
				.body,
				.actions,
				.waiting,
				.sync-status,
				.learn-more,
				.walkthrough,
				.setup,
				.layout,
				.upgrade-banner,
				.pro-strip,
				.pro-strip__slide-in,
				.pulse,
				.pulse-soft {
					animation: none;
				}

				/* Static full-width fill — the animated progress read is motion, but the active
				   indicator itself must survive. */
				.pro-strip__tab[aria-pressed='true']::after {
					transform: none;
					animation: none;
				}
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	/** The task that brought the user here (parked by the app while gated) — selects the
	 *  sign-in copy; actions without task copy fall back to the generic pitch. */
	@property({ attribute: false })
	intentAction?: GraphShowAction;

	/** Selects the welcome copy variant — true keeps the "You're signed in" framing; false
	 *  (already signed in on first entry) drops it. */
	@property({ type: Boolean })
	liveSignIn = false;

	/** Render the first-run welcome screen (the `graph:intro` surface). Set by the app when
	 *  `shouldShowWelcome` holds; the app keeps this element mounted while set, so `account` is
	 *  non-null on that screen. */
	@property({ type: Boolean })
	welcome = false;

	/** Show the Side Bar vs Bottom Panel layout picker within the welcome (view host only; fed by the
	 *  host's `layoutPromptNeeded`). */
	@property({ type: Boolean, attribute: 'show-layout-options' })
	showLayoutOptions = false;

	/** Upgraded from a pre-19 version — surfaces a subtle "new home for the Commit Graph" notice atop
	 *  the sign-in screen so returning users understand why the Graph now asks for an account. */
	@property({ type: Boolean })
	upgradedFromPreV19 = false;

	@state()
	private _selectedLayout?: 'sidebar' | 'panel';

	@state()
	private waiting = false;

	@state()
	private cooldown = 0;

	@state()
	private syncing = false;

	@state()
	private syncChecked = false;

	@state()
	private _slideIndex = 0;

	private _cooldownInterval: ReturnType<typeof setInterval> | undefined;
	private _syncTimer: ReturnType<typeof setTimeout> | undefined;
	private _stripInterval: ReturnType<typeof setInterval> | undefined;
	// Hover/focus pause flag for the Pro strip's rotation — doesn't affect markup, only interval
	// behavior, so a plain field avoids an unnecessary re-render on every hover.
	private _stripPaused = false;
	private _lastScreen: 'signin' | 'verify' | 'welcome' | undefined;
	private _lastFocusKey: string | undefined;

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.clearTimers();
	}

	private get screen(): 'signin' | 'verify' | 'welcome' {
		const account = this.graphState.subscription?.account;
		if (account == null) return 'signin';
		if (account.verified === false) return 'verify';

		return this.welcome ? 'welcome' : 'verify';
	}

	protected override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		super.willUpdate(changedProperties);

		const screen = this.screen;
		// The sign-in, verify, and welcome sub-screens share one reused element instance; drop
		// transient UI state when switching between them so a stale spinner, cooldown, or "not
		// verified" note can't leak across the transition (including waiting -> welcome).
		if (this._lastScreen != null && this._lastScreen !== screen) {
			this.clearTimers();
			this.waiting = false;
			this.syncing = false;
			this.syncChecked = false;
			this.cooldown = 0;
			this._selectedLayout = undefined;

			if (this._lastScreen === 'signin') {
				this._slideIndex = 0;
			}
		}
		this._lastScreen = screen;

		if (screen === 'signin' && this._stripInterval == null) {
			this.startStripTimer();
		}
	}

	protected override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		// Keep focus on the primary control whenever the visible view changes — the initial mount, the
		// sign-in <-> verify switches, and the actions <-> "waiting" swap each remove the focused
		// control, which would otherwise drop focus to <body>. Defer a frame so the new control's
		// inner element has rendered (gl-button.focus() delegates to a not-yet-rendered `.control`).
		const screen = this.screen;
		const focusKey = `${screen}:${this.waiting ? 'waiting' : 'idle'}`;
		if (focusKey === this._lastFocusKey) return;

		this._lastFocusKey = focusKey;
		// The welcome screen is an informational interstitial — don't auto-focus its Continue button;
		// stealing focus there is disruptive (and reads abruptly to screen readers).
		if (screen === 'welcome') return;

		requestAnimationFrame(() => {
			// `gl-button.focus()` delegates to its inner `.control`, which is null while the button is
			// still rendering or being torn down during a screen swap — ignore focus in that window.
			try {
				this.renderRoot?.querySelector<HTMLElement>('gl-button, .cancel')?.focus();
			} catch {
				/* control not ready yet */
			}
		});
	}

	override render(): unknown {
		switch (this.screen) {
			case 'signin':
				return this.renderSignIn();
			case 'welcome':
				return this.renderWelcome();
			default:
				return this.renderVerifyEmail();
		}
	}

	private get signInCopy(): { heading: string; body: string } | undefined {
		return this.intentAction != null ? intentCopyByAction[this.intentAction] : undefined;
	}

	private get signInSource(): Source {
		return { source: 'graph', detail: getIntentSourceDetail('signin', this.intentAction) };
	}

	private renderSignIn(): unknown {
		const copy = this.signInCopy;
		return html`
			<div class="container scrollable">
				${
					this.upgradedFromPreV19
						? html`<div class="upgrade-banner" role="note">
								<code-icon icon="info"></code-icon>
								<span>The all-new Commit Graph has moved here, replacing the Home view.</span>
							</div>`
						: nothing
				}
				<div class="content">
					<gitlens-logo-circle class="logo"></gitlens-logo-circle>
					<h1 class="heading">${copy?.heading ?? 'Sign In to GitLens'}</h1>
					<p class="body">
						${
							copy?.body ??
							html`Supercharge Git and stay in control of
								<span class="nowrap">AI-assisted</span> development by connecting coding agents,
								worktrees, commits, and reviews directly into the Git workflow.`
						}
					</p>
					${this.waiting ? this.renderWaiting() : this.renderSignInActions()}
					<gl-button
						class="learn-more"
						appearance="link"
						href=${createCommandLink('gitlens.showWelcomeView', { mode: 'main' })}
					>
						<code-icon slot="prefix" icon="book"></code-icon>
						Learn More
					</gl-button>
				</div>
				${this.renderProStrip()}
			</div>
		`;
	}

	/** Rotating spotlight of GitLens Pro features, pinned to the bottom of the sign-in screen. */
	private renderProStrip(): unknown {
		const slide = proStripSlides[this._slideIndex];
		return html`
			<div
				class="pro-strip"
				role="region"
				aria-label="GitLens Pro features"
				@mouseenter=${this.onStripPauseOn}
				@mouseleave=${this.onStripPauseOff}
				@focusin=${this.onStripPauseOn}
				@focusout=${this.onStripPauseOff}
			>
				<div class="pro-strip__hairline"></div>
				<div class="pro-strip__spot">
					<div class="pro-strip__vignette">
						${keyed(this._slideIndex, html`<div class="pro-strip__slide-in">${slide.vignette()}</div>`)}
					</div>
					${keyed(
						this._slideIndex,
						html`
							<div class="pro-strip__copy pro-strip__slide-in">
								<div class="pro-strip__title-row">
									<span class="pro-strip__title">${slide.name}</span>
									<gl-feature-badge
										.source=${{ source: 'graph', detail: 'signin-strip' } as const}
										.subscription=${this.graphState.subscription}
									></gl-feature-badge>
								</div>
								<div class="pro-strip__desc">${slide.description}</div>
							</div>
						`,
					)}
				</div>
				<div class="pro-strip__tabs">
					${proStripSlides.map(
						(s, i) => html`
							<button
								type="button"
								class="pro-strip__tab"
								aria-pressed=${i === this._slideIndex}
								@click=${() => this.goToSlide(i)}
							>
								${s.name}
							</button>
						`,
					)}
				</div>
				<div class="pro-strip__dots">
					${proStripSlides.map(
						(s, i) => html`
							<button
								type="button"
								class="pro-strip__dot"
								aria-pressed=${i === this._slideIndex}
								aria-label=${`Show ${s.name}`}
								@click=${() => this.goToSlide(i)}
							></button>
						`,
					)}
				</div>
			</div>
		`;
	}

	private renderSignInActions(): unknown {
		return html`
			<div class="actions">
				<gl-button
					full
					href=${createCommandLink<SubscriptionLoginCommandArgs>('gitlens.plus.signUp', {
						...this.signInSource,
						openAccountView: false,
					})}
					@click=${this.onStart}
					>Create Free Account</gl-button
				>
				<gl-button
					full
					appearance="secondary"
					href=${createCommandLink<SubscriptionLoginCommandArgs>('gitlens.plus.login', {
						...this.signInSource,
						openAccountView: false,
					})}
					@click=${this.onStart}
					>Sign In</gl-button
				>
			</div>
		`;
	}

	private renderWaiting(): unknown {
		return html`
			<div class="waiting">
				<code-icon icon="sync" modifier="spin"></code-icon>
				<div class="waiting__status" role="status" aria-live="polite">
					Waiting for sign-in to complete in your browser&hellip;
				</div>
				<button type="button" class="cancel" @click=${this.onCancel}>Cancel</button>
			</div>
		`;
	}

	private renderVerifyEmail(): unknown {
		return html`
			<div class="container scrollable">
				<div class="content">
					<code-icon class="icon-accent" icon="mail" .size=${28}></code-icon>
					<h1 class="heading">Verify your email</h1>
					<p class="body">
						We sent a verification link to your email. Click it to activate your account, then synchronize
						to continue.
					</p>
					<div class="actions">
						<gl-button
							full
							href=${createCommandLink<Source>('gitlens.plus.resendVerification', src)}
							?disabled=${this.cooldown > 0}
							@click=${this.onResend}
							>${this.cooldown > 0 ? `Email Sent · ${this.cooldown}s` : 'Resend Email'}</gl-button
						>
						<gl-button
							full
							appearance="secondary"
							href=${createCommandLink<Source>('gitlens.plus.validate', src)}
							@click=${this.onSync}
						>
							<code-icon slot="prefix" icon="sync" modifier=${this.syncing ? 'spin' : ''}></code-icon>
							Synchronize Status
						</gl-button>
					</div>
					${
						this.syncChecked && !this.syncing
							? html`<p class="sync-status" role="status">
									Not verified yet &mdash; check your inbox for the link.
								</p>`
							: nothing
					}
				</div>
			</div>
		`;
	}

	private renderWelcome(): unknown {
		return html`
			<div class="container scrollable">
				<div class="content">
					<gitlens-logo-circle class="logo"></gitlens-logo-circle>
					${
						this.liveSignIn
							? html`<p class="success" role="status">
									<code-icon icon="pass-filled"></code-icon>
									You're signed in
								</p>`
							: nothing
					}
					<h1 class="heading">Welcome to the Commit Graph</h1>
					<p class="body">
						Where your development and agentic workflows come
						together${!this.showLayoutOptions && !this.upgradedFromPreV19 ? html` &mdash; visualize branches and commits, manage parallel work and agents, and run your entire Git workflow from one view.` : '.'}
					</p>
					${this.showLayoutOptions ? this.renderLayoutOptions() : nothing}
					<div class="setup">
						<h2 class="setup__label">Set up your workflow</h2>
						<gl-card class="setup__card" href=${createCommandLink('gitlens.showSettingsPage!ai')}>
							<div class="setup-card">
								<code-icon class="setup-card__icon" icon="sparkle"></code-icon>
								<div class="setup-card__content">
									<span class="setup-card__title">Set up AI</span>
									<span class="setup-card__hint"
										>Compose commits, review changes, and resolve conflicts with AI</span
									>
								</div>
								<code-icon class="setup-card__chevron" icon="chevron-right"></code-icon>
							</div>
						</gl-card>
						<gl-card class="setup__card" href=${createCommandLink('gitlens.showSettingsPage!agents')}>
							<div class="setup-card">
								<code-icon class="setup-card__icon" icon="robot"></code-icon>
								<div class="setup-card__content">
									<span class="setup-card__title">Set up Agents</span>
									<span class="setup-card__hint"
										>Choose your default coding agent and install the GitKraken MCP</span
									>
								</div>
								<code-icon class="setup-card__chevron" icon="chevron-right"></code-icon>
							</div>
						</gl-card>
						<gl-card class="setup__card" href=${createCommandLink('gitlens.showSettingsPage!integrations')}>
							<div class="setup-card">
								<code-icon class="setup-card__icon" icon="plug"></code-icon>
								<div class="setup-card__content">
									<span class="setup-card__title">Connect Integrations</span>
									<span class="setup-card__hint"
										>See and act on PRs and issues from GitHub, Jira, and more</span
									>
								</div>
								<code-icon class="setup-card__chevron" icon="chevron-right"></code-icon>
							</div>
						</gl-card>
					</div>
					<div class="actions actions--last">
						<gl-button full class="continue" @click=${this.onContinue}>Continue to Commit Graph</gl-button>
					</div>
				</div>
			</div>
		`;
	}

	private renderLayoutOptions(): unknown {
		return html`
			<div class="layout">
				<h2 class="layout__question">Would you like to change the Graph location?</h2>
				<div class="layout__options">
					<button
						type="button"
						class="layout__option ${this._selectedLayout === 'sidebar' ? 'selected' : ''}"
						aria-pressed=${this._selectedLayout === 'sidebar'}
						@click=${() => this.onSelectLayout('sidebar')}
					>
						${this.renderSidebarIllustration()}
						<span class="layout__option-text">
							<span class="layout__option-label">Side Bar</span>
						</span>
					</button>
					<button
						type="button"
						class="layout__option ${this._selectedLayout === 'panel' ? 'selected' : ''}"
						aria-pressed=${this._selectedLayout === 'panel'}
						@click=${() => this.onSelectLayout('panel')}
					>
						${this.renderPanelIllustration()}
						<span class="layout__option-text">
							<span class="layout__option-label">Bottom Panel</span>
						</span>
					</button>
				</div>
			</div>
		`;
	}

	/** Designed window mock: highlighted side bar hosting a vertical commit graph */
	private renderSidebarIllustration() {
		return svg`<svg class="layout__illustration" width="138" height="75" viewBox="0 0 138 75" fill="none" aria-hidden="true">
			<rect x="0.336586" y="0.336586" width="137.327" height="74.0488" rx="1.00976" fill="var(--lp-frame-bg)" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M0.5 0.999999C0.5 0.447715 0.947715 0 1.5 0H37.5V74H1.5C0.947715 74 0.5 73.5523 0.5 73V0.999999Z" fill="var(--lp-shell-bg)"/>
			<rect x="114.837" y="5.33659" width="18.3268" height="10.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="101.837" y="21.3366" width="22.3268" height="33.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="101.837" y="59.3366" width="31.3268" height="10.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="127.566" y="63.6147" width="3.36585" height="3.36585" rx="1.68293" fill="var(--lp-dot-fill)" stroke="#D9D9D9" stroke-width="0.673171"/>
			<path d="M37.4707 0L37.4707 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M96.1536 0L96.1536 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M9.11255 74.4023L9.11255 62.0884" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 45.2381L9.11255 10.8887" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 51.7189L9.11255 49.1265" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 58.1998L9.11255 55.6074" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M15.5935 74.4025L15.5935 42.6455" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<path d="M15.5935 38.4579L15.5935 17.0706" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<path d="M22.0745 74.4026L22.0745 23.8506" stroke="#40AAA3" stroke-width="0.812499"/>
			<path d="M28.5557 74.4023L28.5557 30.3313" stroke="#8A743A" stroke-width="0.812499"/>
			<circle cx="28.5556" cy="28.3874" r="1.94431" stroke="#8A743A" stroke-width="0.812499"/>
			<circle cx="22.0747" cy="21.9062" r="1.94431" stroke="#40AAA3" stroke-width="0.812499"/>
			<circle cx="15.5937" cy="15.4253" r="1.94431" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<circle cx="15.5937" cy="40.7014" r="1.94431" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="8.94431" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="60.1443" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="53.6633" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="47.1823" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M37.3506 8.94385L11.0569 8.94385" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 47.1821H11.0569" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 53.6631H11.0569" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 15.4248L17.5379 15.4248" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 40.7012H17.5379" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 21.906H24.0189" stroke="#309FC7" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 28.3872H30.4999" stroke="#C7B830" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 60.7925H11.0569" stroke="#C7308B" stroke-opacity="0.3" stroke-width="2.75444"/>
		</svg>`;
	}

	/** Designed window mock: highlighted bottom panel hosting the commit graph */
	private renderPanelIllustration() {
		return svg`<svg class="layout__illustration" width="138" height="75" viewBox="0 0 138 75" fill="none" aria-hidden="true">
			<rect x="0.336586" y="0.336586" width="137.327" height="74.0488" rx="1.00976" fill="var(--lp-frame-bg)" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M1.5 75C0.947712 75 0.5 74.5523 0.5 74L0.499998 40L102.5 40L102.5 74C102.5 74.5523 102.052 75 101.5 75L1.5 75Z" fill="var(--lp-shell-bg)"/>
			<rect x="118.815" y="5.04899" width="14.8098" height="10.7707" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="106.697" y="21.205" width="14.8098" height="33.6586" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="106.697" y="58.9025" width="26.9268" height="10.7707" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="127.566" y="63.6149" width="3.36585" height="3.36585" rx="1.68293" fill="var(--lp-dot-fill)" stroke="#D9D9D9" stroke-width="0.673171"/>
			<path d="M102.5 40L0.499999 40" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M102.154 0L102.154 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M37.3188 63.404L37.3188 63.2017" stroke="var(--lp-purple)" stroke-width="0.673171"/>
			<g clip-path="url(#lp-panel-clip)">
				<path d="M12.3188 76.2404L12.3188 47.7812" stroke="var(--lp-purple)" stroke-width="0.673171"/>
				<path d="M60 46.1702H13.9299" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 51.5398H19.2996" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 72.4817H19.2996" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 56.9094H24.6692" stroke="#309FC7" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 62.2793H30.0389" stroke="#C7B830" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M17.6885 70.6232L17.6885 52.9033" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<path d="M23.0581 100.404L23.0581 58.5205" stroke="#40AAA3" stroke-width="0.673171"/>
				<path d="M28.4282 100.404L28.4282 63.8901" stroke="#8A743A" stroke-width="0.673171"/>
				<circle cx="28.4278" cy="62.2794" r="1.6109" stroke="#8A743A" stroke-width="0.673171"/>
				<circle cx="23.0582" cy="56.9097" r="1.6109" stroke="#40AAA3" stroke-width="0.673171"/>
				<circle cx="17.6885" cy="51.5401" r="1.6109" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<circle cx="17.6885" cy="72.4817" r="1.6109" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<circle cx="12.3189" cy="46.1705" r="1.6109" stroke="var(--lp-purple)" stroke-width="0.673171"/>
			</g>
			<path d="M88.8481 47.1704H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M80.7939 52.54H65.7589" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M88.8481 57.9097H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M80.7939 63.2793H65.7589" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M88.8481 68.6489H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<defs>
				<clipPath id="lp-panel-clip">
					<rect width="51" height="30" fill="white" transform="translate(9.5 44)"/>
				</clipPath>
			</defs>
		</svg>`;
	}

	private readonly onStart = (): void => {
		this.waiting = true;
	};

	private readonly onCancel = (): void => {
		this.waiting = false;
	};

	private readonly onResend = (): void => {
		if (this.cooldown > 0) return;

		this.cooldown = resendVerificationCooldownSeconds;
		this._cooldownInterval = setInterval(() => {
			this.cooldown -= 1;
			if (this.cooldown <= 0) {
				this.cooldown = 0;
				this.clearCooldownTimer();
			}
		}, 1000);
	};

	private readonly onSync = (): void => {
		if (this.syncing) return;

		this.syncing = true;
		this._syncTimer = setTimeout(() => {
			this.syncing = false;
			this.syncChecked = true;
			this._syncTimer = undefined;
		}, syncStatusDelayMs);
	};

	private readonly onContinue = (): void => {
		this.dispatchEvent(
			new CustomEvent('gl-continue', {
				detail: { layoutChoice: this._selectedLayout ?? 'dismissed' },
			}),
		);
	};

	private readonly onSelectLayout = (choice: 'sidebar' | 'panel'): void => {
		this._selectedLayout = choice;
	};

	private readonly onStripPauseOn = (): void => {
		this._stripPaused = true;
	};

	private readonly onStripPauseOff = (): void => {
		this._stripPaused = false;
	};

	private readonly goToSlide = (index: number): void => {
		this.advanceSlide(index);
		this.clearStripTimer();
		this.startStripTimer();
	};

	private advanceSlide(next?: number): void {
		this._slideIndex = next ?? (this._slideIndex + 1) % proStripSlides.length;
	}

	private startStripTimer(): void {
		// Read once when the interval starts, not per-tick — the mode doesn't change mid-session.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		this._stripInterval = setInterval(() => {
			if (this._stripPaused) return;

			this.advanceSlide();
		}, proStripRotationMs);
	}

	private clearCooldownTimer(): void {
		if (this._cooldownInterval == null) return;

		clearInterval(this._cooldownInterval);
		this._cooldownInterval = undefined;
	}

	private clearSyncTimer(): void {
		if (this._syncTimer == null) return;

		clearTimeout(this._syncTimer);
		this._syncTimer = undefined;
	}

	private clearStripTimer(): void {
		if (this._stripInterval == null) return;

		clearInterval(this._stripInterval);
		this._stripInterval = undefined;
	}

	private clearTimers(): void {
		this.clearCooldownTimer();
		this.clearSyncTimer();
		this.clearStripTimer();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-access-account': GlGraphAccessAccount;
	}
}
