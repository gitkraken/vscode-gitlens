import { html } from 'lit';
import { cspStyleMap } from '../../shared/components/csp-style-map.directive.js';
import { linkify } from '../../shared/components/linkify.js';
import type { ComponentGroup } from './types.js';
import '../../shared/components/breadcrumbs.js';
import '../../shared/components/formatted-date.js';
import '../../shared/components/markdown/markdown.js';
import '../../shared/components/rich/issue-icon.js';
import '../../shared/components/rich/issue-pull-request.js';
import '../../shared/components/rich/pr-icon.js';

const prOpenedAt = '2026-06-18T09:14:00Z';
const prMergedAt = '2026-06-02T13:05:00Z';
const issueUpdatedAt = '2026-06-10T16:40:00Z';

const commitDate = new Date('2026-06-18T09:14:00Z');
const releaseDate = new Date('2026-05-01T00:00:00Z');
const oldCommitDate = new Date('2025-11-12T08:30:00Z');

const commitMessageMarkdown =
	'Fix duplicate scrollbar on the styleguide **Components** tab\n\n- Removes redundant `overflow-y` on `.tab-panel`\n- Verified in both light and dark themes';
const prTitleMarkdown = 'Fix `gitProviderService.ts` race condition on repo close $(bug)';
const summaryMarkdown =
	'## Summary\n\nAdds the `--gl-color-*` semantic token system.\n\n- 4 color schemes\n- Hybrid high-contrast support\n\nSee [the design doc](https://github.com/gitkraken/vscode-gitlens/pull/4821) for details.';
const taskListMarkdown =
	'- [x] Reproduce the scrollbar bug\n- [ ] Ship the fix\n\nRun `pnpm run check` before opening the PR.';

const linkifiedHint =
	'See [the design doc](https://github.com/gitkraken/vscode-gitlens/pull/4821) for the full breakdown, or run [gitlens.showSettingsPage](command:gitlens.showSettingsPage) from the command palette.';
const linkifiedUnsafeHint =
	'Do not trust [this](javascript:alert(1)) link — unsafe schemes render as literal text, not an anchor.';

export const contentGroups: ComponentGroup[] = [
	{
		family: 'Rich content',
		description:
			'Autolinked issues/PRs and their status icons, relative/absolute dates, breadcrumb navigation, and the Markdown/linkify text renderers used throughout commit details, hovers, and Home rows.',
		demos: [
			{
				label: 'issue-pull-request type=pr status=opened (author, details + open-on-remote actions)',
				wide: true,
				render: () => html`
					<issue-pull-request
						type="pr"
						name="Add semantic --gl-color-* token system to shared webview CSS"
						url="https://github.com/gitkraken/vscode-gitlens/pull/4821"
						identifier="#4821"
						status="opened"
						author="Keith Daulton"
						date=${prOpenedAt}
						details
						?openOnRemote=${true}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-pull-request type=pr status=merged reviewDecision=Approved',
				wide: true,
				render: () => html`
					<issue-pull-request
						type="pr"
						name="Fix duplicate scrollbar on the styleguide Components tab"
						url="https://github.com/gitkraken/vscode-gitlens/pull/4790"
						identifier="#4790"
						status="merged"
						author="Eric Amodio"
						.reviewDecision=${'Approved'}
						date=${prMergedAt}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-pull-request type=pr status=opened isDraft reviewDecision=ReviewRequired',
				wide: true,
				render: () => html`
					<issue-pull-request
						type="pr"
						name="WIP: graph waterways tributary visualization"
						url="https://github.com/gitkraken/vscode-gitlens/pull/4832"
						identifier="#4832"
						status="opened"
						author="Keith Daulton"
						?isDraft=${true}
						.reviewDecision=${'ReviewRequired'}
						date=${prOpenedAt}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-pull-request type=issue status=closed',
				wide: true,
				render: () => html`
					<issue-pull-request
						type="issue"
						name="Blame gutter shows stale author after rebase"
						url="https://github.com/gitkraken/vscode-gitlens/issues/3521"
						identifier="#3521"
						status="closed"
						author="Uma Patel"
						date=${issueUpdatedAt}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-pull-request type=pr status=closed',
				wide: true,
				render: () => html`
					<issue-pull-request
						type="pr"
						name="Drop legacy --color-* aliases from the graph minimap"
						url="https://github.com/gitkraken/vscode-gitlens/pull/4758"
						identifier="#4758"
						status="closed"
						author="Priya Shah"
						date=${issueUpdatedAt}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-pull-request compact (icon + identifier only)',
				note: 'compact switches the host to a 2-column grid and skips title/date/details rows entirely — only the status icon + identifier render.',
				render: () =>
					html`<issue-pull-request
						compact
						type="pr"
						status="merged"
						identifier="#4790"
					></issue-pull-request>`,
			},
			{
				label: 'issue-pull-request type=autolink',
				wide: true,
				note: 'type=autolink uses the generic "link" icon regardless of the `status` attribute (status is only interpreted for issue/pr icon selection).',
				render: () => html`
					<issue-pull-request
						type="autolink"
						name="Related discussion"
						url="https://github.com/gitkraken/vscode-gitlens/discussions/512"
						identifier="#512"
						date=${issueUpdatedAt}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-pull-request reviewDecision=ChangesRequested',
				wide: true,
				render: () => html`
					<issue-pull-request
						type="pr"
						name="Refactor gitProviderService sub-provider resolution"
						url="https://github.com/gitkraken/vscode-gitlens/pull/4765"
						identifier="#4765"
						status="opened"
						author="Ramin Tadayon"
						.reviewDecision=${'ChangesRequested'}
						date=${prOpenedAt}
					></issue-pull-request>
				`,
			},
			{
				label: 'issue-icon (no state — plain icon, no tooltip)',
				render: () => html`<issue-icon></issue-icon>`,
			},
			{
				label: 'issue-icon state=opened',
				note: 'Wrapped in gl-tooltip only when `state` is set; label reads "Issue #3544 is opened".',
				render: () => html`<issue-icon state="opened" issue-id="3544"></issue-icon>`,
			},
			{
				label: 'issue-icon state=closed',
				render: () => html`<issue-icon state="closed" issue-id="3502"></issue-icon>`,
			},
			{
				label: 'pr-icon (no state — default git-pull-request icon)',
				render: () => html`<pr-icon></pr-icon>`,
			},
			{
				label: 'pr-icon state=opened',
				render: () => html`<pr-icon state="opened" pr-id="4821"></pr-icon>`,
			},
			{
				label: 'pr-icon state=opened draft',
				note: 'draft changes the icon whenever state is "opened" or unset, but only adds the pr-icon--draft modifier class when state is explicitly "opened" — for unset state, only the icon reflects draft.',
				render: () => html`<pr-icon state="opened" draft pr-id="4832"></pr-icon>`,
			},
			{
				label: 'pr-icon state=closed',
				render: () => html`<pr-icon state="closed" pr-id="4758"></pr-icon>`,
			},
			{
				label: 'pr-icon state=merged',
				render: () => html`<pr-icon state="merged" pr-id="4744"></pr-icon>`,
			},
			{
				label: 'formatted-date relative (default)',
				note: '`date` is declared `attribute: false`, so it must be bound with `.date=` — a plain `date="…"` attribute is silently ignored.',
				render: () => html`<formatted-date .date=${commitDate}></formatted-date>`,
			},
			{
				label: 'formatted-date date-style=absolute',
				render: () => html`<formatted-date .date=${commitDate} date-style="absolute"></formatted-date>`,
			},
			{
				label: 'formatted-date short relative',
				render: () => html`<formatted-date .date=${oldCommitDate} short></formatted-date>`,
			},
			{
				label: 'formatted-date custom format (date-style=absolute)',
				note: '`format` only feeds the absolute-date string; without `date-style="absolute"` the visible label stays relative ("2 months ago") and the custom format is only visible in the tooltip.',
				render: () => html`
					<formatted-date .date=${releaseDate} date-style="absolute" format="YYYY-MM-DD"></formatted-date>
				`,
			},
			{
				label: 'formatted-date with tooltip prefix',
				note: '`tooltip` is prepended as plain text before the computed absolute date string in the gl-tooltip content.',
				render: () => html`<formatted-date .date=${commitDate} tooltip="Last commit:"></formatted-date>`,
			},
			{
				label: 'gl-breadcrumbs default chain (repo > branch > folder > file)',
				wide: true,
				note: 'See the "collapsed (narrow width)" demo below for the ellipsis/overflow state — this stage is wide enough that nothing collapses here.',
				render: () => html`
					<gl-breadcrumbs label="Visual History scope">
						<gl-breadcrumb-item icon="gl-repository" priority="1">vscode-gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item icon="git-branch" priority="4"
							>feature/graph-performance</gl-breadcrumb-item
						>
						<gl-breadcrumb-item appearance="segment" icon="folder" priority="2" foldable
							>src</gl-breadcrumb-item
						>
						<gl-breadcrumb-item appearance="segment" priority="2">git</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="3">gitProviderService.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumbs collapsed (narrow width, collapse=outer-in)',
				note: 'Width constrained via the CSP-safe `cspStyleMap` directive (CSSOM property writes, not an inline `style="…"` attribute — breadcrumbs.ts uses the same directive internally for its overflow indicator) so the host\'s own ResizeObserver triggers the outer-in collapse algorithm: lower-priority crumbs compact to icon-only, then fold into a "…" overflow run — click it to open the popover listing the hidden crumbs.',
				render: () => html`
					<gl-breadcrumbs style=${cspStyleMap({ maxWidth: '18rem' })} label="Narrow scope (collapsed)">
						<gl-breadcrumb-item icon="gl-repository" priority="1">vscode-gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item icon="git-branch" priority="4"
							>feature/graph-performance</gl-breadcrumb-item
						>
						<gl-breadcrumb-item appearance="segment" icon="folder" priority="2" foldable
							>src</gl-breadcrumb-item
						>
						<gl-breadcrumb-item appearance="segment" priority="2">git</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="3">gitProviderService.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumbs collapse=shrink (currently a no-op)',
				note: '"shrink" is a declared BreadcrumbCollapse value, but `recompute()` only runs the compaction algorithm when `collapse === \'outer-in\'` — any other value (including "shrink") just clears compact/hidden state and returns, so at the same constrained width as the demo above this renders uncollapsed, identically to collapse="none".',
				render: () => html`
					<gl-breadcrumbs
						collapse="shrink"
						style=${cspStyleMap({ maxWidth: '18rem' })}
						label="Shrink collapse (no-op today)"
					>
						<gl-breadcrumb-item icon="gl-repository" priority="1">vscode-gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item icon="git-branch" priority="4"
							>feature/graph-performance</gl-breadcrumb-item
						>
						<gl-breadcrumb-item appearance="segment" icon="folder" priority="2" foldable
							>src</gl-breadcrumb-item
						>
						<gl-breadcrumb-item appearance="segment" priority="2">git</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="3">gitProviderService.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumbs density=compact',
				wide: true,
				note: 'density="compact" also expects `compactBreadcrumbsConsumerStyles` installed in a consumer\'s own `static styles` when slotting gl-ref-button/gl-repo-button-group widgets — not needed here since this demo uses plain text/icon crumbs only.',
				render: () => html`
					<gl-breadcrumbs density="compact" label="Compact breadcrumb chain">
						<gl-breadcrumb-item icon="gl-repository" priority="1">gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item icon="git-branch" priority="4">bug/#3521-blame-gutter</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="3">blameAnnotationProvider.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumbs collapse=none, 2-item chain',
				wide: true,
				render: () => html`
					<gl-breadcrumbs collapse="none" label="Two-item chain">
						<gl-breadcrumb-item icon="gl-repository" priority="1">gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="1">README.md</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumb-item appearance=segment foldable + tooltip slot',
				wide: true,
				render: () => html`
					<gl-breadcrumbs label="Folder tooltip example">
						<gl-breadcrumb-item icon="gl-repository" priority="1">gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item appearance="segment" icon="folder" priority="2" foldable interactive>
							src
							<span slot="tooltip">src/git/parsers</span>
						</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="3">gitProviderService.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumb-item appearance=ellipsis (overflow-indicator glyph preview)',
				wide: true,
				note: 'In real usage gl-breadcrumbs renders this itself (inside a gl-popover trigger) when items collapse — consumers don\'t normally author appearance="ellipsis" directly. Clicking it does nothing here; no popover content is attached.',
				render: () => html`
					<gl-breadcrumbs label="Overflow indicator preview">
						<gl-breadcrumb-item icon="gl-repository" priority="1">gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item appearance="ellipsis" interactive></gl-breadcrumb-item>
						<gl-breadcrumb-item priority="1">gitProviderService.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-breadcrumb-item forced compact state (icon-only, hover-reveals label)',
				wide: true,
				note: "`compact`/`hidden` are normally set by the parent's collapse algorithm, not authored directly — forced here purely to preview the icon-only, hover-reveal-label visual state.",
				render: () => html`
					<gl-breadcrumbs label="Forced compact state">
						<gl-breadcrumb-item icon="gl-repository" priority="1">gitlens</gl-breadcrumb-item>
						<gl-breadcrumb-item icon="folder" compact priority="2">src</gl-breadcrumb-item>
						<gl-breadcrumb-item priority="3">gitProviderService.ts</gl-breadcrumb-item>
					</gl-breadcrumbs>
				`,
			},
			{
				label: 'gl-markdown density=compact (default) — commit message',
				layout: 'block',
				render: () => html`<gl-markdown .markdown=${commitMessageMarkdown}></gl-markdown>`,
			},
			{
				label: 'gl-markdown inline — title with inline code + codicon ref',
				note: '`$(bug)` resolves to `<code-icon icon="bug">` via renderThemeIcon — code-icon must already be a registered custom element elsewhere on the page for it to upgrade (the styleguide side-effect-imports it for its own chrome).',
				render: () => html`<gl-markdown inline .markdown=${prTitleMarkdown}></gl-markdown>`,
			},
			{
				label: 'gl-markdown density=document — heading, list, link',
				layout: 'block',
				render: () => html`<gl-markdown density="document" .markdown=${summaryMarkdown}></gl-markdown>`,
			},
			{
				label: 'gl-markdown task list + inline code',
				layout: 'block',
				render: () => html`<gl-markdown .markdown=${taskListMarkdown}></gl-markdown>`,
			},
			{
				label: 'linkify() — http(s) + command: links rendered inline',
				wide: true,
				note: "Not a mountable element — this `<p>` wrapper is the same pattern real consumers use (setting-control.ts) to host the function's output inline.",
				render: () => html`<p>${linkify(linkifiedHint)}</p>`,
			},
			{
				label: 'linkify() — unsafe scheme rejected, kept as literal text',
				wide: true,
				render: () => html`<p>${linkify(linkifiedUnsafeHint)}</p>`,
			},
		],
	},
];
