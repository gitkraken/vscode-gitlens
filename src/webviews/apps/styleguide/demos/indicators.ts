import { html } from 'lit';
import type { AvatarShape } from '../../shared/components/avatar/avatar-list.js';
import { cspStyleMap } from '../../shared/components/csp-style-map.directive.js';
import type { ComponentGroup } from './types.js';
import '../../shared/components/avatar/avatar-list.js';
import '../../shared/components/avatar/avatar.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/file-icon/file-icon.js';
import '../../shared/components/gitlens-logo-circle.js';
import '../../shared/components/gitlens-logo.js';
import '../../shared/components/icons/icon-cube.js';
import '../../shared/components/indicators/indicator.js';
import '../../shared/components/indicators/watermark-loader.js';
import '../../shared/components/progress.js';
import '../../shared/components/skeleton-loader.js';

// Inline data: URI — never fetch a remote avatar image from the styleguide (CSP + no network).
const AVATAR_IMAGE_DATA_URI =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' rx='16' fill='%236b46c1'/%3E%3Ctext x='16' y='21' font-size='14' text-anchor='middle' fill='white' font-family='sans-serif'%3EKD%3C/text%3E%3C/svg%3E";

const CONTRIBUTORS: AvatarShape[] = [
	{ name: 'Keith Daulton', href: 'https://github.com/keithdaulton' },
	{ name: 'Eric Amodio', href: 'https://github.com/eamodio' },
	{ name: 'Ada Lovelace', href: 'https://github.com/ada-lovelace' },
	{ name: 'Grace Hopper', href: 'https://github.com/grace-hopper' },
	{ name: 'Miguel Solorio', href: 'https://github.com/misolori' },
];

export const indicatorsGroups: ComponentGroup[] = [
	{
		family: 'Indicators & loaders',
		description:
			'Presentational status-dot, watermark, progress, and skeleton primitives — no context/IPC dependency.',
		demos: [
			{
				label: 'gl-indicator (default)',
				render: () => html`<gl-indicator></gl-indicator>`,
			},
			{
				label: 'gl-indicator (pulse)',
				render: () => html`<gl-indicator pulse></gl-indicator>`,
			},
			{
				label: 'gl-indicator (color override, tracking-ahead)',
				render: () =>
					html`<gl-indicator
						style=${cspStyleMap({ '--gl-indicator-color': 'var(--gl-color-tracking-ahead)' })}
					></gl-indicator>`,
			},
			{
				label: 'gl-indicator (pulse, danger, large)',
				render: () =>
					html`<gl-indicator
						pulse
						style=${cspStyleMap({
							'--gl-indicator-color': 'var(--gl-color-danger)',
							'--gl-indicator-size': '1.4rem',
						})}
					></gl-indicator>`,
			},
			{
				label: 'gl-watermark-loader (loading)',
				layout: 'tall',
				render: () => html`<gl-watermark-loader pulse><p>Loading commit history…</p></gl-watermark-loader>`,
			},
			{
				label: 'gl-watermark-loader (empty state)',
				layout: 'tall',
				render: () => html`<gl-watermark-loader><p>No results found</p></gl-watermark-loader>`,
			},
			{
				label: 'progress-indicator (active, bottom)',
				layout: 'block',
				render: () => html`<progress-indicator active></progress-indicator>`,
			},
			{
				label: 'progress-indicator (active, top)',
				layout: 'block',
				render: () => html`<progress-indicator active position="top"></progress-indicator>`,
			},
			{
				label: 'progress-indicator (active, min-visible)',
				layout: 'block',
				note: 'min-visible only affects how long the bar holds once deactivated — a timing behavior, identical to plain active in a static demo.',
				render: () => html`<progress-indicator active min-visible="300"></progress-indicator>`,
			},
			{
				label: 'progress-indicator (active, mode=discrete)',
				layout: 'block',
				note: 'mode="discrete" swaps the infinite scanning animation for a linear width transition, but nothing drives an explicit width — the bar sits at the same 2% sliver as the default until something moves it toward "discrete done".',
				render: () => html`<progress-indicator active mode="discrete"></progress-indicator>`,
			},
			{
				label: 'progress-indicator (active, mode="discrete done")',
				layout: 'block',
				note: 'The literal mode value "discrete done" is the only built-in way to reach a filled bar — it snaps the width to 100%.',
				render: () => html`<progress-indicator active mode="discrete done"></progress-indicator>`,
			},
			{
				label: 'skeleton-loader (1 line)',
				layout: 'block',
				render: () => html`<skeleton-loader></skeleton-loader>`,
			},
			{
				label: 'skeleton-loader (3 lines)',
				layout: 'block',
				render: () => html`<skeleton-loader lines="3"></skeleton-loader>`,
			},
			{
				label: 'skeleton-loader (lines=5, tall block)',
				layout: 'block',
				note: 'lines scales the height of one shimmering block (1em × line-height × lines) — it does not render 5 discrete stacked row placeholders.',
				render: () => html`<skeleton-loader lines="5"></skeleton-loader>`,
			},
		],
	},
	{
		family: 'Icons, avatars & media',
		description: 'Icon glyphs, the GitLens wordmark/glyph, Seti file-type icons, and avatar primitives.',
		demos: [
			{
				label: 'gl-icon-cube (default)',
				render: () => html`<gl-icon-cube icon="git-commit"></gl-icon-cube>`,
			},
			{
				label: 'gl-icon-cube (brand)',
				render: () => html`<gl-icon-cube appearance="brand" icon="gl-gitlens"></gl-icon-cube>`,
			},
			{
				label: 'gl-icon-cube (custom icon)',
				render: () => html`<gl-icon-cube icon="graph"></gl-icon-cube>`,
			},
			{
				label: 'gitlens-logo',
				render: () => html`<gitlens-logo></gitlens-logo>`,
			},
			{
				label: 'gitlens-logo-circle',
				render: () => html`<gitlens-logo-circle></gitlens-logo-circle>`,
			},
			{
				label: 'code-icon (codicon)',
				render: () => html`<code-icon icon="git-commit"></code-icon>`,
			},
			{
				label: 'code-icon (glicon)',
				render: () => html`<code-icon icon="gl-gitlens"></code-icon>`,
			},
			{
				label: 'code-icon (spin/loading)',
				render: () => html`<code-icon icon="loading" modifier="spin"></code-icon>`,
			},
			{
				label: 'code-icon (flip=inline)',
				render: () => html`<code-icon icon="git-pull-request" flip="inline"></code-icon>`,
			},
			{
				label: 'code-icon (rotate=45)',
				note: 'Same pattern used for the WIP-panel commit-ahead chevron (gl-details-wip-panel.ts).',
				render: () => html`<code-icon icon="arrow-up" rotate="45"></code-icon>`,
			},
			{
				label: 'code-icon (size=24)',
				render: () => html`<code-icon icon="graph" size="24"></code-icon>`,
			},
			{
				label: 'gl-file-icon (.ts)',
				render: () => html`<gl-file-icon filename="gitProviderService.ts"></gl-file-icon>`,
			},
			{
				label: 'gl-file-icon (.json)',
				render: () => html`<gl-file-icon filename="package.json"></gl-file-icon>`,
			},
			{
				label: 'gl-file-icon (.md)',
				render: () => html`<gl-file-icon filename="README.md"></gl-file-icon>`,
			},
			{
				label: 'gl-file-icon (.scss)',
				render: () => html`<gl-file-icon filename="graph.scss"></gl-file-icon>`,
			},
			{
				label: 'gl-file-icon (size override)',
				render: () =>
					html`<gl-file-icon
						filename="tsconfig.json"
						style=${cspStyleMap({ '--gl-file-icon-size': '2.4rem' })}
					></gl-file-icon>`,
			},
			{
				label: 'gl-avatar (initials)',
				render: () => html`<gl-avatar name="Keith Daulton">KD</gl-avatar>`,
			},
			{
				label: 'gl-avatar (large, sized)',
				render: () => html`<gl-avatar name="Ada Lovelace" data-avatar-size="3.2rem">AL</gl-avatar>`,
			},
			{
				label: 'gl-avatar (linked)',
				note: 'Renders as a real <a href> — clicking attempts navigation (intercepted/opened externally by the VS Code webview host).',
				render: () => html`<gl-avatar name="Eric Amodio" href="https://github.com/eamodio">EA</gl-avatar>`,
			},
			{
				label: 'gl-avatar (image)',
				note: 'Uses an inline data: SVG — no network fetch.',
				render: () => html`<gl-avatar name="Keith Daulton" src=${AVATAR_IMAGE_DATA_URI}></gl-avatar>`,
			},
			{
				label: 'gl-avatar-list (default, overflow)',
				note: '5 stub contributors with the default max=3 collapse 2 into a "+2" overflow avatar — hover (or focus) it to open the gl-popover overflow list; gl-popover defaults to trigger="hover focus", so a plain click is a no-op here.',
				render: () => html`<gl-avatar-list .avatars=${CONTRIBUTORS}></gl-avatar-list>`,
			},
			{
				label: 'gl-avatar-list (max=5, no overflow)',
				render: () => html`<gl-avatar-list max="5" .avatars=${CONTRIBUTORS}></gl-avatar-list>`,
			},
			{
				label: 'gl-avatar-group (manual)',
				render: () =>
					html`<gl-avatar-group>
						<gl-avatar name="Ada Lovelace">AL</gl-avatar>
						<gl-avatar name="Grace Hopper">GH</gl-avatar>
						<gl-avatar name="Miguel Solorio">MS</gl-avatar>
					</gl-avatar-group>`,
			},
		],
	},
];
