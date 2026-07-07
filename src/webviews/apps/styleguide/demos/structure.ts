import { Signal } from '@lit-labs/signals';
import { html } from 'lit';
import type { ComponentGroup } from './types.js';
import '../../shared/components/accordion/accordion.js';
import '../../shared/components/banner/banner.js';
import '../../shared/components/button.js';
import '../../shared/components/card/card.js';
import '../../shared/components/card/work-item.js';
import '../../shared/components/chips/action-chip.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/details-header/gl-details-header.js';
import '../../shared/components/gl-error-banner.js';
import '../../shared/components/hooks-banner.js';
import '../../shared/components/mcp-banner.js';
import '../../shared/components/panes/pane-group.js';
import '../../shared/components/split-panel/split-panel.js';
import '../../shared/components/webview-pane.js';

// gl-error-banner takes its error message as a Signal so the demo's dismiss interaction (which
// calls `error.set(undefined)`) has real state to mutate — a plain string prop could not do that.
const demoErrorSignal = new Signal.State<string | undefined>(
	'Failed to load commit graph: request to origin timed out after 30s.',
);

export const structureGroups: ComponentGroup[] = [
	{
		family: 'Cards & surfaces',
		description: 'Collapsible containers, indicator-driven cards, and card-based list rows.',
		demos: [
			{
				label: 'gl-accordion (closed)',
				render: () => html`
					<gl-accordion>
						<span slot="header">Changed Files (2)</span>
						<div>src/git/gitProviderService.ts</div>
						<div>src/webviews/apps/shared/components/card/card.ts</div>
					</gl-accordion>
				`,
			},
			{
				label: 'gl-accordion (open)',
				render: () => html`
					<gl-accordion open>
						<span slot="header">Commit Message</span>
						<p>Fix graph rendering regression when switching branches with a cherry-pick in progress.</p>
					</gl-accordion>
				`,
			},
			{
				label: 'gl-card (default, no indicator)',
				render: () => html`<gl-card>Working tree has 3 modified files.</gl-card>`,
			},
			{
				label: 'gl-card (indicator=conflict)',
				render: () =>
					html`<gl-card indicator="conflict">Merge conflict in src/git/gitProviderService.ts</gl-card>`,
			},
			{
				label: 'gl-card (indicator=pr-open, grouping=item, focusable)',
				render: () =>
					html`<gl-card indicator="pr-open" grouping="item" focusable
						>#4821 Add waterways visualization to Commit Graph</gl-card
					>`,
			},
			{
				label: 'gl-card (href, renders as an anchor)',
				render: () =>
					html`<gl-card href="https://github.com/gitkraken/vscode-gitlens/pull/4821" indicator="pr-merged"
						>#4821 merged into main</gl-card
					>`,
				note: 'href being set forces focusable true internally, so the card is clickable and tabbable without the attribute.',
			},
			{
				label: 'gl-card (density=tight, grouping=item-primary, active)',
				render: () =>
					html`<gl-card grouping="item-primary" density="tight" indicator="active"
						>HEAD → feature/graph-performance</gl-card
					>`,
			},
			{
				label: 'gl-card (with actions slot)',
				render: () => html`
					<gl-card indicator="attention">
						Launchpad: 2 PRs need your review
						<gl-button slot="actions" appearance="toolbar">
							<code-icon icon="arrow-right"></code-icon>
						</gl-button>
					</gl-card>
				`,
			},
			{
				label: 'gl-work-item (nested, collapsed w/ summary)',
				render: () => html`
					<gl-work-item nested>
						<span>bug/#3521-blame-gutter</span>
						<span slot="summary">3 files changed</span>
					</gl-work-item>
				`,
				note: 'nested toggles the list-row grouping background — real callers (branch-card.ts) bind it conditionally on `!branch.opened`, true only while the branch is collapsed in the list.',
			},
			{
				label: 'gl-work-item (nested, expanded w/ context+actions)',
				render: () => html`
					<gl-work-item nested expanded indicator="conflict">
						<span>Merge conflict in gitProviderService.ts</span>
						<div slot="context">Rebasing feature/graph-performance onto main — 2 of 5 commits applied.</div>
						<gl-button slot="actions" appearance="secondary">Resolve</gl-button>
					</gl-work-item>
				`,
			},
			{
				label: 'gl-work-item (primary, nested, active)',
				render: () => html`
					<gl-work-item primary nested indicator="active">
						<span>HEAD → feature/graph-performance</span>
						<span slot="summary">Ahead 3, behind 1</span>
					</gl-work-item>
				`,
			},
			{
				label: 'gl-card indicator matrix (remaining values)',
				layout: 'stack',
				render: () => html`
					<gl-card density="tight" indicator="base">base</gl-card>
					<gl-card density="tight" indicator="info">info</gl-card>
					<gl-card density="tight" indicator="cherry-picking">cherry-picking</gl-card>
					<gl-card density="tight" indicator="merging">merging</gl-card>
					<gl-card density="tight" indicator="rebasing">rebasing</gl-card>
					<gl-card density="tight" indicator="reverting">reverting</gl-card>
					<gl-card density="tight" indicator="issue-open">issue-open</gl-card>
					<gl-card density="tight" indicator="issue-closed">issue-closed</gl-card>
					<gl-card density="tight" indicator="pr-closed">pr-closed</gl-card>
					<gl-card density="tight" indicator="mergeable">mergeable</gl-card>
					<gl-card density="tight" indicator="blocked">blocked</gl-card>
					<gl-card density="tight" indicator="branch-merged">branch-merged</gl-card>
					<gl-card density="tight" indicator="branch-synced">branch-synced</gl-card>
					<gl-card density="tight" indicator="branch-diverged">branch-diverged</gl-card>
					<gl-card density="tight" indicator="branch-behind">branch-behind</gl-card>
					<gl-card density="tight" indicator="branch-ahead">branch-ahead</gl-card>
					<gl-card density="tight" indicator="branch-changes">branch-changes</gl-card>
					<gl-card density="tight" indicator="branch-missingUpstream">branch-missingUpstream</gl-card>
				`,
				note: 'Covers every gl-card indicator value not already shown above (active, conflict, pr-open, pr-merged, and attention are demoed elsewhere in this family).',
			},
		],
	},
	{
		family: 'Panes & structure',
		description: 'Pane groups, resizable split panels, and the details-panel header.',
		demos: [
			{
				label: 'webview-pane-group (stacked, fixed-height sections)',
				layout: 'tall',
				render: () => html`
					<webview-pane-group>
						<webview-pane collapsable expanded>
							<span slot="title">Commits</span>
							<span slot="subtitle">12</span>
							<div>9f2b4a7 Fix graph rendering regression</div>
						</webview-pane>
						<webview-pane collapsable>
							<span slot="title">Changed Files</span>
							<span slot="subtitle">3</span>
						</webview-pane>
					</webview-pane-group>
				`,
			},
			{
				label: 'webview-pane-group (flexible, one pane fills remaining space)',
				layout: 'tall',
				render: () => html`
					<webview-pane-group flexible>
						<webview-pane collapsable expanded>
							<span slot="title">Commit Message</span>
						</webview-pane>
						<webview-pane flexible expanded>
							<span slot="title">Changed Files</span>
							<span slot="subtitle">6</span>
						</webview-pane>
					</webview-pane-group>
				`,
				note: 'flexible on both the group and the pane, plus expanded on the pane, is what triggers the ::slotted(webview-pane[flexible][expanded]) { flex: 1 } rule in the pane-group stylesheet — visible mainly once an ancestor gives the group an explicit height, as its real callers do.',
			},
			{
				label: 'webview-pane (static header, non-collapsable)',
				layout: 'tall',
				render: () => html`
					<webview-pane-group>
						<webview-pane>
							<span slot="title">Commit Details</span>
							<div>9f2b4a7c3e185d6f0a4b7c9e2d5f8a1b3c6e9d02</div>
						</webview-pane>
					</webview-pane-group>
				`,
			},
			{
				label: 'webview-pane (collapsable, collapsed)',
				layout: 'tall',
				render: () => html`
					<webview-pane-group>
						<webview-pane collapsable>
							<span slot="title">Changed Files</span>
							<span slot="subtitle">4</span>
						</webview-pane>
					</webview-pane-group>
				`,
			},
			{
				label: 'webview-pane (collapsable, expanded, loading, with actions)',
				layout: 'tall',
				render: () => html`
					<webview-pane-group>
						<webview-pane collapsable expanded loading>
							<span slot="title">Changed Files</span>
							<span slot="subtitle">4</span>
							<gl-action-chip slot="actions" icon="refresh" label="Refresh"></gl-action-chip>
							<div>src/git/gitProviderService.ts</div>
						</webview-pane>
					</webview-pane-group>
				`,
				note: 'Clicking the header toggles a real expanded-change event and internal state, not a no-op.',
			},
			{
				label: 'gl-split-panel (horizontal, primary=start)',
				layout: 'tall',
				render: () => html`
					<gl-split-panel position="30" primary="start">
						<div slot="start">File Tree</div>
						<div slot="end">Diff view for src/git/gitProviderService.ts</div>
					</gl-split-panel>
				`,
			},
			{
				label: 'gl-split-panel (vertical, primary=end)',
				layout: 'tall',
				render: () => html`
					<gl-split-panel orientation="vertical" position="65" primary="end">
						<div slot="start">Commit Graph</div>
						<div slot="end">Commit Details</div>
					</gl-split-panel>
				`,
				note: 'primary=end keeps the end panel (Commit Details) pinned to its pixel height on container resize and reverses which edge the Enter-key collapse animates toward.',
			},
			{
				label: 'gl-split-panel (overlay mode, primary=start)',
				layout: 'tall',
				render: () => html`
					<gl-split-panel mode="overlay" position="28" primary="start">
						<div slot="start">Minimap Waterways</div>
						<div slot="end">Commit Graph rows…</div>
					</gl-split-panel>
				`,
			},
			{
				label: 'gl-split-panel (disabled)',
				layout: 'tall',
				render: () => html`
					<gl-split-panel position="50" disabled>
						<div slot="start">Locked panel A</div>
						<div slot="end">Locked panel B</div>
					</gl-split-panel>
				`,
			},
			{
				label: 'gl-details-header (idle, compose+review modes)',
				layout: 'block',
				render: () => html`
					<gl-details-header .modes=${['compose', 'review']}>
						<span>Fix rebase conflict handling</span>
						<gl-button slot="actions" appearance="toolbar">
							<code-icon icon="kebab-vertical"></code-icon>
						</gl-button>
					</gl-details-header>
				`,
			},
			{
				label: 'gl-details-header (active mode, results view)',
				layout: 'block',
				render: () => html`
					<gl-details-header .modes=${['compose', 'review']} .activeMode=${'review'} in-results-view>
						<span>Reviewing Changes</span>
					</gl-details-header>
				`,
				note: 'in-results-view swaps the Refresh + Close action cluster for Restart + Close (Close-only appears separately, only while modeStatus reports execState: "generating").',
			},
			{
				label: 'gl-details-header (compare entry-point + loading)',
				layout: 'block',
				render: () => html`
					<gl-details-header .modes=${['compose']} .compareEnabled=${true} loading>
						<span>4f9a2c1 Fix graph rendering regression</span>
					</gl-details-header>
				`,
			},
			{
				label: 'gl-details-header (running-operation status overlay)',
				layout: 'block',
				render: () => html`
					<gl-details-header
						.modes=${['compose', 'review']}
						.modeStatus=${{ compose: { execState: 'generating', hasResult: false } }}
					>
						<span>Working tree changes</span>
					</gl-details-header>
				`,
				note: 'execState generating renders a spinning icon on the Compose chip in place of its mode icon.',
			},
		],
	},
	{
		family: 'Banners',
		description: 'Solid, gradient, and stub-driven banner variants.',
		demos: [
			{
				label: 'gl-banner (solid, primary+secondary, dismissible)',
				layout: 'block',
				render: () => html`
					<gl-banner
						banner-title="Heads up"
						body="A short message about something that needs your attention."
						primary-button="Got it"
						secondary-button="Dismiss"
						dismissible
					></gl-banner>
				`,
			},
			{
				label: 'gl-banner (gradient, primary+secondary)',
				layout: 'block',
				render: () => html`
					<gl-banner
						display="gradient"
						banner-title="New: Graph Waterways"
						body="Visualize workstream tributaries directly in the Commit Graph."
						primary-button="Try it"
						secondary-button="Not now"
						dismissible
					></gl-banner>
				`,
			},
			{
				label: 'gl-banner (gradient-purple, AI/MCP styling)',
				layout: 'block',
				render: () => html`
					<gl-banner
						display="gradient-purple"
						banner-title="Install GitKraken MCP"
						body="Leverage Git and your integrations to provide context in AI chat."
						primary-button="Install"
						dismissible
					></gl-banner>
				`,
			},
			{
				label: 'gl-banner (outline, responsive layout)',
				layout: 'block',
				render: () => html`
					<gl-banner
						display="outline"
						layout="responsive"
						banner-title="New: Graph Waterways"
						body="Visualize workstream tributaries directly in the Commit Graph."
						primary-button="Try it"
						secondary-button="Not now"
					></gl-banner>
				`,
			},
			{
				label: 'gl-banner (gradient-transparent, title+body only)',
				layout: 'block',
				render: () => html`
					<gl-banner
						display="gradient-transparent"
						banner-title="Sync in progress"
						body="Fetching latest changes from origin."
					></gl-banner>
				`,
			},
			{
				label: 'gl-banner (command-driven primary button)',
				layout: 'block',
				render: () => html`
					<gl-banner
						banner-title="Reload required"
						body="GitLens updated its Git provider — reload the window to apply."
						primary-button="Reload Window"
						primary-button-command="workbench.action.reloadWindow"
						secondary-button="Later"
						dismissible
					></gl-banner>
				`,
				note: 'primary-button-command prevents navigation and dispatches gl-banner-primary-click instead — a harmless no-op here since nothing listens for it.',
			},
			{
				label: 'gl-error-banner (with error message)',
				layout: 'block',
				render: () => html`<gl-error-banner .error=${demoErrorSignal}></gl-error-banner>`,
				note: 'Fully interactive: dismissing calls error.set(undefined) on the signal and the banner disappears in place.',
			},
			{
				label: 'gl-mcp-banner (install prompt, w/ Claude Hooks CTA)',
				layout: 'block',
				render: () => html`<gl-mcp-banner source="commit-graph" can-install-claude-hook></gl-mcp-banner>`,
			},
			{
				label: 'gl-mcp-banner (already bundled + cleanup notice)',
				layout: 'block',
				render: () => html`<gl-mcp-banner source="home" canautoregister show-cleanup-notice></gl-mcp-banner>`,
				note: 'canAutoRegister is TS-private, so it can only be set via the bare canautoregister attribute, not a .canAutoRegister= property binding.',
			},
			{
				label: 'gl-mcp-banner (responsive layout)',
				layout: 'block',
				render: () => html`<gl-mcp-banner source="inspect" layout="responsive"></gl-mcp-banner>`,
			},
			{
				label: 'gl-hooks-banner (default layout)',
				layout: 'block',
				render: () => html`<gl-hooks-banner source="commit-graph"></gl-hooks-banner>`,
			},
			{
				label: 'gl-hooks-banner (responsive layout)',
				layout: 'block',
				render: () => html`<gl-hooks-banner source="home" layout="responsive"></gl-hooks-banner>`,
			},
		],
	},
];
