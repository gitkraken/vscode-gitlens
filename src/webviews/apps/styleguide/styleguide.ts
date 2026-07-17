/*global*/
import './styleguide.scss';
import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { State } from '../../styleguide/protocol.js';
import { GlAppHost } from '../shared/appHost.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { HostIpc } from '../shared/ipc.js';
import type { ThemeChangeEvent } from '../shared/theme.js';
import { componentGroups, nonElements, undemoed } from './demos/index.js';
import { patternsStyles } from './patterns.css.js';
import { renderPatterns } from './patterns.js';
import { StyleguideStateProvider } from './stateProvider.js';
import { elementStyles, styleguideStyles } from './styleguide.css.js';
import '../shared/components/button.js';
import '../shared/components/code-icon.js';

interface TokenDef {
	name: string;
	derivation: string;
}
interface TokenGroup {
	title: string;
	tokens: TokenDef[];
}
interface Pairing {
	fg: string;
	bg: string;
	label: string;
}

const PALETTE: TokenGroup[] = [
	{
		title: 'Foreground',
		tokens: [
			{ name: '--gl-color-fg', derivation: '← vscode editor-foreground' },
			{ name: '--gl-color-fg-muted', derivation: '← vscode descriptionForeground' },
			{ name: '--gl-color-fg-subtle', derivation: 'mix(fg 50%, transparent)' },
			{ name: '--gl-color-fg-faint', derivation: 'mix(fg 25%, transparent)' },
			{ name: '--gl-color-fg-disabled', derivation: '← vscode disabledForeground' },
			{ name: '--gl-color-fg-on-emphasis', derivation: 'primitive · contrast text' },
		],
	},
	{
		title: 'Surface',
		tokens: [
			{ name: '--gl-color-surface', derivation: '← vscode editor/sideBar bg' },
			{ name: '--gl-color-surface-raised', derivation: 'mix(surface, tint-toward 6%)' },
			{ name: '--gl-color-surface-sunken', derivation: 'mix(surface, tint-toward 3%)' },
			{ name: '--gl-color-surface-hover', derivation: '← vscode list-hoverBackground' },
			{ name: '--gl-color-surface-selected', derivation: '← vscode activeSelectionBackground' },
			{ name: '--gl-color-surface-code', derivation: '← vscode textCodeBlock-background' },
			{ name: '--gl-color-scrim', derivation: 'primitive · modal backdrop' },
		],
	},
	{
		title: 'Border',
		tokens: [
			{ name: '--gl-color-border', derivation: '← vscode widget-border' },
			{ name: '--gl-color-border-subtle', derivation: '← vscode panel-border' },
			{ name: '--gl-color-border-focus', derivation: '← vscode focusBorder' },
			{ name: '--gl-color-border-sash-hover', derivation: '← vscode sash-hoverBorder' },
		],
	},
	{
		title: 'Accent & interactive',
		tokens: [
			{ name: '--gl-color-accent', derivation: '← vscode button-background' },
			{ name: '--gl-color-accent-fg', derivation: '← vscode button-foreground' },
			{ name: '--gl-color-accent-active', derivation: 'mix(accent, #000 30%)' },
			{ name: '--gl-color-accent-secondary', derivation: '← vscode button-secondaryBackground' },
			{ name: '--gl-color-link', derivation: '← vscode textLink-foreground' },
			{ name: '--gl-color-link-active', derivation: '← vscode textLink-activeForeground' },
		],
	},
	{
		title: 'Status',
		tokens: [
			{ name: '--gl-color-success', derivation: 'primitive · success green' },
			{ name: '--gl-color-warning', derivation: '← vscode editorWarning-foreground' },
			{ name: '--gl-color-danger', derivation: '← vscode errorForeground' },
			{ name: '--gl-color-info', derivation: '← vscode inputValidation-infoBorder' },
			{ name: '--gl-color-success-bg', derivation: 'mix(success 18%, surface)' },
			{ name: '--gl-color-warning-bg', derivation: 'mix(warning 18%, surface)' },
			{ name: '--gl-color-danger-bg', derivation: 'mix(danger 18%, surface)' },
			{ name: '--gl-color-info-bg', derivation: 'mix(info 18%, surface)' },
		],
	},
	{
		title: 'GitLens domain',
		tokens: [
			{ name: '--gl-color-diff-added', derivation: '← gitDecoration added' },
			{ name: '--gl-color-diff-modified', derivation: '← gitDecoration modified' },
			{ name: '--gl-color-diff-removed', derivation: '← gitDecoration deleted' },
			{ name: '--gl-color-agent-working', derivation: 'primitive · slate-purple' },
			{ name: '--gl-color-agent-waiting', derivation: 'primitive · waiting' },
			{ name: '--gl-color-tracking-ahead', derivation: 'primitive · teal' },
			{ name: '--gl-color-tracking-behind', derivation: 'primitive · orange' },
		],
	},
	{
		title: 'Expressive',
		tokens: [
			{ name: '--gl-color-brand', derivation: 'primitive · brand purple' },
			{ name: '--gl-color-ai-1', derivation: 'primitive · violet' },
			{ name: '--gl-color-ai-2', derivation: 'primitive · sky' },
			{ name: '--gl-color-ai-3', derivation: 'primitive · cyan' },
		],
	},
];

// Rendered as a contiguous strip (not swatch rows) — the stops only mean anything relative to
// their neighbors. Sits after the Surface group to mirror the colors.scss ordering.
const RAMP: string[] = [
	'--gl-color-ramp-05',
	'--gl-color-ramp-10',
	'--gl-color-ramp-20',
	'--gl-color-ramp-30',
	'--gl-color-ramp-40',
	'--gl-color-ramp-50',
	'--gl-color-ramp-60',
	'--gl-color-ramp-70',
	'--gl-color-ramp-80',
	'--gl-color-ramp-90',
	'--gl-color-ramp-95',
];

const CONTRAST_PAIRS: Pairing[] = [
	{ fg: '--gl-color-fg', bg: '--gl-color-surface', label: 'fg on surface' },
	{ fg: '--gl-color-fg-muted', bg: '--gl-color-surface', label: 'fg-muted on surface' },
	{ fg: '--gl-color-fg-subtle', bg: '--gl-color-surface', label: 'fg-subtle on surface' },
	{ fg: '--gl-color-fg-faint', bg: '--gl-color-surface', label: 'fg-faint on surface' },
	{ fg: '--gl-color-fg', bg: '--gl-color-surface-raised', label: 'fg on surface-raised' },
	{ fg: '--gl-color-link', bg: '--gl-color-surface', label: 'link on surface' },
	{ fg: '--gl-color-fg-on-emphasis', bg: '--gl-color-accent', label: 'on-emphasis on accent' },
	{ fg: '--gl-color-on-status', bg: '--gl-color-success', label: 'on-status on success' },
	{ fg: '--gl-color-on-status', bg: '--gl-color-danger', label: 'on-status on danger' },
	{ fg: '--gl-color-on-status', bg: '--gl-color-warning', label: 'on-status on warning' },
];

interface Scale {
	title: string;
	tokens: string[];
	kind: 'radius' | 'space' | 'font' | 'shadow' | 'zindex' | 'duration';
}
const SCALES: Scale[] = [
	{
		title: 'Radius',
		kind: 'radius',
		tokens: ['--gl-radius-xs', '--gl-radius-sm', '--gl-radius-md', '--gl-radius-lg', '--gl-radius-xl'],
	},
	{
		title: 'Space',
		kind: 'space',
		tokens: [
			'--gl-space-2',
			'--gl-space-4',
			'--gl-space-8',
			'--gl-space-12',
			'--gl-space-16',
			'--gl-space-24',
			'--gl-space-32',
		],
	},
	{
		title: 'Font',
		kind: 'font',
		tokens: ['--gl-font-micro', '--gl-font-sm', '--gl-font-md', '--gl-font-base', '--gl-font-lg'],
	},
	{
		title: 'Shadow',
		kind: 'shadow',
		tokens: ['--gl-shadow-raised', '--gl-shadow-popover', '--gl-shadow-dialog', '--gl-shadow-tooltip'],
	},
	{
		title: 'Z-index',
		kind: 'zindex',
		tokens: ['--gl-z-sticky', '--gl-z-cover', '--gl-z-sheet', '--gl-z-popover', '--gl-z-tooltip'],
	},
	{
		title: 'Duration',
		kind: 'duration',
		tokens: [
			'--gl-duration-x-fast',
			'--gl-duration-fast',
			'--gl-duration-medium',
			'--gl-duration-slow',
			'--gl-duration-x-slow',
		],
	},
];

interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

@customElement('gl-styleguide-app')
export class GlStyleguideApp extends GlAppHost<State, StyleguideStateProvider> {
	static override styles = [elementStyles, styleguideStyles, patternsStyles];

	@query('.probe') private probe!: HTMLElement;
	@state() private tab: 'tokens' | 'patterns' | 'components' | 'elements' = 'tokens';
	@state() private auditOn = localStorage.getItem('gl-styleguide-audit') === 'on';
	@state() private checkerOn = localStorage.getItem('gl-styleguide-checker') !== 'off';
	@state() private resolved = new Map<string, string>();
	@state() private contrast = new Map<string, number>();
	@state() private scheme = '';

	private canvas?: CanvasRenderingContext2D;

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): StyleguideStateProvider {
		return new StyleguideStateProvider(this, bootstrap, ipc, logger);
	}

	override firstUpdated(): void {
		this.recompute();
	}

	override updated(changed: Map<string, unknown>): void {
		super.updated?.(changed);
		// Apply dynamic swatch/scale styles via CSSOM (.style.setProperty) rather than inline style
		// attributes — the webview CSP blocks inline style attributes (incl. Lit styleMap output) but
		// permits CSSOM mutations. data-* attrs carry the token; we resolve them to var() refs here.
		const root = this.renderRoot as ParentNode;
		root.querySelectorAll<HTMLElement>('[data-bg]').forEach(el => {
			el.style.setProperty('--swatch-color', `var(${el.dataset.bg})`);
		});
		root.querySelectorAll<HTMLElement>('[data-radius]').forEach(el => {
			el.style.setProperty('border-radius', `var(${el.dataset.radius})`);
		});
		root.querySelectorAll<HTMLElement>('[data-w]').forEach(el => {
			el.style.setProperty('width', `var(${el.dataset.w})`);
		});
		root.querySelectorAll<HTMLElement>('[data-fs]').forEach(el => {
			el.style.setProperty('font-size', `var(${el.dataset.fs})`);
		});
		root.querySelectorAll<HTMLElement>('[data-shadow]').forEach(el => {
			el.style.setProperty('box-shadow', `var(${el.dataset.shadow})`);
		});
		root.querySelectorAll<HTMLElement>('[data-z]').forEach(el => {
			el.style.setProperty('z-index', `var(${el.dataset.z})`);
		});
		root.querySelectorAll<HTMLElement>('[data-i]').forEach(el => {
			el.style.setProperty('--gl-stack-i', el.dataset.i ?? '0');
		});
		root.querySelectorAll<HTMLElement>('[data-duration]').forEach(el => {
			el.style.setProperty('animation-duration', `calc(var(${el.dataset.duration}) * 1.5)`);
		});
		root.querySelectorAll<HTMLElement>('[data-avatar-size]').forEach(el => {
			el.style.setProperty('--gl-avatar-size', el.dataset.avatarSize ?? '');
		});
		root.querySelectorAll<HTMLElement>('[data-tree-frame-height]').forEach(el => {
			el.style.setProperty('height', el.dataset.treeFrameHeight ?? '');
		});
	}

	protected override onThemeUpdated(_e: ThemeChangeEvent): void {
		// Re-read all resolved values + contrast against the now-active theme.
		this.recompute();
	}

	private toRgba(cssColor: string): Rgba {
		this.canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true }) ?? undefined;
		const ctx = this.canvas;
		if (ctx == null) return { r: 0, g: 0, b: 0, a: 0 };

		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#000';
		ctx.fillStyle = cssColor;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return { r: r, g: g, b: b, a: a / 255 };
	}

	private resolveToken(token: string): string {
		if (this.probe == null) return '';

		this.probe.style.color = `var(${token})`;
		return getComputedStyle(this.probe).color;
	}

	private resolveRaw(token: string): string {
		return this.probe != null ? getComputedStyle(this.probe).getPropertyValue(token).trim() : '';
	}

	private static luminance({ r, g, b }: Rgba): number {
		const ch = (c: number) => {
			const s = c / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
	}

	private static composite(fg: Rgba, bg: Rgba): Rgba {
		const a = fg.a;
		return {
			r: fg.r * a + bg.r * (1 - a),
			g: fg.g * a + bg.g * (1 - a),
			b: fg.b * a + bg.b * (1 - a),
			a: 1,
		};
	}

	private ratio(fgToken: string, bgToken: string): number {
		const fg = this.toRgba(this.resolveToken(fgToken));
		const bg = this.toRgba(this.resolveToken(bgToken));
		const fgOver = fg.a < 1 ? GlStyleguideApp.composite(fg, bg) : fg;
		const l1 = GlStyleguideApp.luminance(fgOver);
		const l2 = GlStyleguideApp.luminance(bg);
		const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
		return (hi + 0.05) / (lo + 0.05);
	}

	private recompute(): void {
		const resolved = new Map<string, string>();
		for (const group of PALETTE) {
			for (const t of group.tokens) {
				resolved.set(t.name, this.resolveToken(t.name));
			}
		}
		for (const t of RAMP) {
			resolved.set(t, this.resolveToken(t));
		}
		const contrast = new Map<string, number>();
		for (const p of CONTRAST_PAIRS) {
			contrast.set(p.label, this.ratio(p.fg, p.bg));
		}
		this.resolved = resolved;
		this.contrast = contrast;
		this.scheme = this.detectScheme();
	}

	private detectScheme(): string {
		const c = document.body.classList;
		if (c.contains('vscode-high-contrast-light')) return 'High Contrast Light';
		if (c.contains('vscode-high-contrast')) return 'High Contrast Dark';
		if (c.contains('vscode-light')) return 'Light';
		return 'Dark';
	}

	private get isHc(): boolean {
		return this.scheme.startsWith('High Contrast');
	}

	private toggleAudit(e: Event): void {
		this.auditOn = (e.target as HTMLInputElement).checked;
		localStorage.setItem('gl-styleguide-audit', this.auditOn ? 'on' : 'off');
	}

	private toggleChecker(e: Event): void {
		this.checkerOn = (e.target as HTMLInputElement).checked;
		localStorage.setItem('gl-styleguide-checker', this.checkerOn ? 'on' : 'off');
	}

	private selectTab(tab: 'tokens' | 'patterns' | 'components' | 'elements'): void {
		this.tab = tab;
	}

	private static slugify(family: string): string {
		return family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	}

	private jumpToFamily(family: string): void {
		const id = `family-${GlStyleguideApp.slugify(family)}`;
		this.renderRoot.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	private renderBadge(label: string): unknown {
		if (!this.auditOn) return nothing;

		const r = this.contrast.get(label);
		if (r == null) return nothing;

		const rounded = Math.round(r * 10) / 10;
		const level = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : 'fail';
		const cls = level === 'fail' ? 'badge badge--fail' : 'badge badge--pass';
		return html`<span class="${cls}">${level} · ${rounded}:1</span>`;
	}

	private renderAuditBanner(): unknown {
		if (!this.auditOn) return nothing;

		const failing = CONTRAST_PAIRS.filter(p => (this.contrast.get(p.label) ?? 21) < 4.5);
		if (failing.length === 0) {
			return html`<div class="audit-banner audit-banner--ok">
				<code-icon icon="pass"></code-icon> All semantic text pairings pass AA in this theme.
			</div>`;
		}
		return html`<div class="audit-banner">
			<code-icon icon="warning"></code-icon> ${failing.length} pairing${failing.length > 1 ? 's' : ''} fail AA in
			this theme: ${failing.map(p => p.label).join(', ')}
		</div>`;
	}

	private renderPalette(): unknown {
		return PALETTE.map(
			group => html`
				<section>
					<h2 class="section-title">${group.title}</h2>
					${group.tokens.map(
						t => html`
							<div class="swatch-row">
								<div class="swatch" data-bg=${t.name}></div>
								<div>
									<div class="token-name">${t.name}</div>
									<div class="token-derivation">${t.derivation}</div>
								</div>
								<div class="token-value">${this.resolved.get(t.name) ?? ''}</div>
								<div>${this.renderContrastFor(t.name)}</div>
							</div>
						`,
					)}
				</section>
				${group.title === 'Surface' ? this.renderRamp() : nothing}
			`,
		);
	}

	private renderRamp(): unknown {
		return html`
			<section>
				<h2 class="section-title">Ramp</h2>
				<p class="section-note">
					--gl-color-ramp-<em>n</em> · flexible surface→fg tint scale — mix(surface (100−n)%, fg). Hover a
					stop for its resolved value.
				</p>
				<div class="ramp">
					<div class="ramp-strip">
						${RAMP.map(
							t => html`
								<div class="ramp-chip" data-bg=${t} title="${t} · ${this.resolved.get(t) ?? ''}"></div>
							`,
						)}
					</div>
					<div class="ramp-labels">
						${RAMP.map(t => html`<span>${t.replace('--gl-color-ramp-', '')}</span>`)}
					</div>
				</div>
			</section>
		`;
	}

	private renderContrastFor(token: string): unknown {
		// Show a badge for any contrast pairing whose foreground is this token.
		const pair = CONTRAST_PAIRS.find(p => p.fg === token);
		return pair != null ? this.renderBadge(pair.label) : nothing;
	}

	private renderScales(): unknown {
		return html`
			<section>
				<h2 class="section-title">Token scales</h2>
				<p class="section-note">The dimensionless --gl-* scales the color system sits alongside.</p>
				${SCALES.map(
					scale => html`
						<div class="gallery-group">
							<h3 class="gallery-group-title">${scale.title}</h3>
							${scale.kind === 'zindex'
								? this.renderZStack(scale.tokens)
								: scale.kind === 'duration'
									? this.renderDurationScale(scale.tokens)
									: scale.kind === 'font'
										? this.renderFontScale(scale.tokens)
										: html`<div class="scale-grid">
												${scale.tokens.map(t => this.renderScaleItem(scale.kind, t))}
											</div>`}
						</div>
					`,
				)}
			</section>
		`;
	}

	private renderScaleItem(kind: Scale['kind'], token: string): unknown {
		// Dynamic dims/colors are applied via CSSOM in updated() (data-* attrs), not inline style
		// attributes — the webview CSP blocks inline style attributes but allows CSSOM .style.setProperty.
		let sample: unknown = nothing;
		if (kind === 'radius') {
			sample = html`<div class="scale-box scale-radius" data-radius=${token}></div>`;
		} else if (kind === 'space') {
			sample = html`<div class="scale-box scale-space" data-w=${token}></div>`;
		} else if (kind === 'shadow') {
			sample = html`<div class="scale-shadow" data-shadow=${token}></div>`;
		}
		return html`<div class="scale-item">${sample}<span>${token}</span></div>`;
	}

	private renderZStack(tokens: string[]): unknown {
		// Each box is positioned absolutely, offset by its index, and raised to its actual z-index token.
		// isolation: isolate on the container dogfoods the system's own "prefer isolation" rule.
		return html`
			<div class="zstack">
				${tokens.map(
					(t, i) => html`
						<div class="zstack-box" data-z=${t} data-i=${i}>
							<span class="zstack-name">${t.replace('--gl-z-', '')}</span>
							<span class="token-value">${this.resolveRaw(t)}</span>
						</div>
					`,
				)}
			</div>
		`;
	}

	private renderDurationScale(tokens: string[]): unknown {
		return html`
			<div class="duration-scale">
				${tokens.map(
					t => html`
						<div class="duration-row">
							<span class="duration-label token-value">${t} · ${this.resolveRaw(t)}</span>
							<div class="duration-track">
								<div class="duration-fill" data-duration=${t}></div>
							</div>
						</div>
					`,
				)}
			</div>
		`;
	}

	private renderFontScale(tokens: string[]): unknown {
		return html`
			<div class="font-samples">
				${tokens.map(
					t => html`
						<div class="font-sample">
							<span class="font-aa" data-fs=${t}>Aa</span>
							<span class="token-value">${t}</span>
						</div>
					`,
				)}
			</div>
		`;
	}

	override render(): unknown {
		return html`
			<span class="probe" aria-hidden="true"></span>
			<div class="page">
				<header class="page__header">
					<hgroup>
						<h1>GitLens styleguide</h1>
						<p class="subtitle">
							Live reference for the --gl-color-* system and the shared components that consume it. Switch
							VS Code themes to verify all four schemes.
						</p>
					</hgroup>
					<div class="page__controlbar">
						<div class="controlbar">
							<span class="scheme-chip ${this.isHc ? 'scheme-chip--hc' : ''}">
								<code-icon icon="${this.isHc ? 'color-mode' : 'symbol-color'}"></code-icon> ${this
									.scheme}
							</span>
							<gl-button
								class="scheme-action"
								appearance="toolbar"
								href="command:workbench.action.selectTheme"
								tooltip="Change Color Theme"
								aria-label="Change Color Theme"
								><code-icon icon="paintcan"></code-icon
							></gl-button>
						</div>
					</div>

					<div class="tabs" role="tablist">
						<button
							class="tab ${this.tab === 'tokens' ? 'tab--active' : ''}"
							role="tab"
							aria-selected=${this.tab === 'tokens'}
							@click=${() => this.selectTab('tokens')}
						>
							Colors &amp; tokens
						</button>
						<button
							class="tab ${this.tab === 'patterns' ? 'tab--active' : ''}"
							role="tab"
							aria-selected=${this.tab === 'patterns'}
							@click=${() => this.selectTab('patterns')}
						>
							Patterns Demo
						</button>
						<button
							class="tab ${this.tab === 'components' ? 'tab--active' : ''}"
							role="tab"
							aria-selected=${this.tab === 'components'}
							@click=${() => this.selectTab('components')}
						>
							Components
						</button>
						<button
							class="tab ${this.tab === 'elements' ? 'tab--active' : ''}"
							role="tab"
							aria-selected=${this.tab === 'elements'}
							@click=${() => this.selectTab('elements')}
						>
							HTML Elements
						</button>
					</div>
				</header>

				<main class="page__content">
					${this.tab === 'tokens'
						? this.renderTokensTab()
						: this.tab === 'patterns'
							? renderPatterns()
							: this.tab === 'components'
								? this.renderComponentsTab()
								: this.renderElementsTab()}
				</main>
			</div>
		`;
	}

	private renderTokensTab(): unknown {
		return html`
			<div class="tokens ${this.checkerOn ? '' : 'tokens--no-checker'}">
				<div class="controlbar controlbar--sticky">
					<label class="toggle">
						Accessibility audit
						<input type="checkbox" .checked=${this.auditOn} @change=${this.toggleAudit} />
					</label>
					<label class="toggle">
						Transparency checker
						<input type="checkbox" .checked=${this.checkerOn} @change=${this.toggleChecker} />
					</label>
				</div>
				${this.renderAuditBanner()} ${this.renderPalette()} ${this.renderScales()}
			</div>
		`;
	}

	private renderComponentsTab(): unknown {
		return html`
			<div class="components">
				<div class="components__nav">
					<nav class="jumpnav">
						${componentGroups.map(
							group => html`
								<button class="jumpnav__link" @click=${() => this.jumpToFamily(group.family)}>
									${group.family}
								</button>
							`,
						)}
					</nav>
				</div>
				<div class="components__content">
					<p class="section-note">
						Real shared components rendered live, consuming the tokens. Switch themes to see them adapt.
					</p>
					${componentGroups.map(
						group => html`
							<section id="family-${GlStyleguideApp.slugify(group.family)}">
								<h2 class="section-title">${group.family}</h2>
								${group.description ? html`<p class="section-note">${group.description}</p>` : nothing}
								<div class="demo-grid">
									${group.demos.map(
										d => html`
											<div
												class="demo ${d.layout === 'block' ||
												d.layout === 'stack' ||
												d.layout === 'tall'
													? 'demo--block'
													: ''} ${d.wide ? 'demo--wide' : ''}"
											>
												<div class="demo__stage demo__stage--${d.layout ?? 'inline'}">
													${d.render()}
												</div>
												<div class="demo__label">${d.label}</div>
												${d.note ? html`<div class="demo__note">${d.note}</div>` : nothing}
											</div>
										`,
									)}
								</div>
							</section>
						`,
					)}
					<section>
						<h2 class="section-title">Not standalone</h2>
						<p class="section-note">
							Function-only modules with no standalone element, and components that depend on
							subscription/integration/IPC/git state and aren't rendered here.
						</p>
						<div class="undemoed">
							${nonElements.map(
								n => html`<span class="undemoed__item" title=${n.reason}>${n.name}</span>`,
							)}
							${undemoed.map(name => html`<span class="undemoed__item">${name}</span>`)}
						</div>
					</section>
				</div>
			</div>
		`;
	}

	private renderElementsTab(): unknown {
		return html`
			<div class="elements">
				<p class="section-note">
					Raw HTML as it renders inside a GitLens webview. VS Code injects a small default stylesheet into
					every webview document, but those document-level rules don't pierce this app's shadow root — so
					they're mirrored here, scoped to this tab. Each section notes where its styling comes from.
				</p>

				<section>
					<h2 class="section-title">Typography</h2>
					<p class="section-note">
						Browser defaults — VS Code adds nothing element-specific here; everything inherits the editor
						font (--vscode-font-family/-size/-weight) and foreground from body.
					</p>
					<h1>Heading 1</h1>
					<h2>Heading 2</h2>
					<h3>Heading 3</h3>
					<h4>Heading 4</h4>
					<h5>Heading 5</h5>
					<h6>Heading 6</h6>
					<p>
						GitLens started as a simple blame annotation extension and grew into a full Git workbench inside
						<strong>VS Code</strong>. This sentence demonstrates <em>emphasis</em>,
						<small>fine print</small>, H<sub>2</sub>O, 2<sup>10</sup>, a <mark>highlighted phrase</mark>,
						<del>deleted text</del>, and <ins>inserted text</ins>, plus an abbreviation like
						<abbr title="Cascading Style Sheets">CSS</abbr>.
					</p>
					<hr />
				</section>

				<section>
					<h2 class="section-title">Links</h2>
					<p class="section-note">
						VS Code colors links (--vscode-textLink-foreground; -activeForeground on hover), applies the
						user's link-underline preference to links inside paragraphs (--text-link-decoration), and
						outlines focused links — Tab through to see.
					</p>
					<p>Read more about GitLens in the <a href="#">official documentation</a>.</p>
					<div><a href="#">A bare link outside a paragraph</a></div>
					<p>
						<a href="#">a link around <code>code</code></a>
					</p>
				</section>

				<section>
					<h2 class="section-title">Code &amp; keyboard</h2>
					<p class="section-note">
						VS Code styles inline code (--vscode-textPreformat-*), zeroes its padding inside pre, and
						dresses kbd as a keybinding label. pre itself is unstyled — block code backgrounds are an app
						concern (--gl-color-surface-code).
					</p>
					<p>Call <code>getComputedStyle(element)</code> to resolve a token to its live value.</p>
					<pre><code>const shas = await git.log({ maxCount: 10 });
const [latest] = shas;
console.log(latest.message);</code></pre>
					<p>Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> to open the Command Palette.</p>
				</section>

				<section>
					<h2 class="section-title">Blockquote</h2>
					<p class="section-note">
						VS Code sets only background and border-color on blockquote — no border width or style — so raw
						webviews show just the tinted background. The familiar left border comes from the Markdown
						preview's own stylesheet, not the webview defaults.
					</p>
					<blockquote>
						<p>
							Blame annotations show who last changed each line and why — hover one to see the full commit
							message without leaving your editor.
						</p>
					</blockquote>
				</section>

				<section>
					<h2 class="section-title">Lists</h2>
					<p class="section-note">Browser defaults — markers, indentation, and spacing are stock.</p>
					<ul>
						<li>Unordered list item 1</li>
						<li>
							Unordered list item 2
							<ul>
								<li>Nested item 1</li>
								<li>Nested item 2</li>
							</ul>
						</li>
						<li>Unordered list item 3</li>
					</ul>
					<ol>
						<li>Ordered list item 1</li>
						<li>Ordered list item 2</li>
						<li>Ordered list item 3</li>
					</ol>
					<dl>
						<dt>Blame</dt>
						<dd>Attributes each line to the commit and author that last changed it.</dd>
						<dt>Worktree</dt>
						<dd>A linked working copy of a repository checked out to a different branch.</dd>
					</dl>
				</section>

				<section>
					<h2 class="section-title">Table</h2>
					<p class="section-note">
						Browser defaults — no borders, spacing, or striping. Webview tables need app styles or a
						component.
					</p>
					<table>
						<thead>
							<tr>
								<th>Header 1</th>
								<th>Header 2</th>
								<th>Header 3</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Row 1, Cell 1</td>
								<td>Row 1, Cell 2</td>
								<td>Row 1, Cell 3</td>
							</tr>
							<tr>
								<td>Row 2, Cell 1</td>
								<td>Row 2, Cell 2</td>
								<td>Row 2, Cell 3</td>
							</tr>
						</tbody>
					</table>
				</section>

				<section>
					<h2 class="section-title">Forms &amp; controls</h2>
					<p class="section-note">
						VS Code adds only a focus outline to input, select, and textarea — Tab through to see.
						Everything else is stock Chromium; use the GitLens components (Components tab) for real UI.
					</p>
					<div class="element-stack">
						<input type="text" placeholder="Text input" />
						<textarea rows="3" placeholder="Textarea"></textarea>
						<select>
							<option>Option 1</option>
							<option>Option 2</option>
							<option>Option 3</option>
						</select>
						<label><input type="checkbox" /> Checkbox</label>
						<label><input type="radio" name="sg-radio" /> Radio 1</label>
						<label><input type="radio" name="sg-radio" /> Radio 2</label>
						<button type="button">Button</button>
					</div>
				</section>

				<section>
					<h2 class="section-title">Media</h2>
					<p class="section-note">
						VS Code caps img and video at max-width/max-height 100% so media never overflows the webview.
						The image below is 800px wide, constrained by its container.
					</p>
					<img
						alt="800×120 sample image"
						src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='120'%3E%3Crect width='800' height='120' fill='%23885fd3'/%3E%3Ctext x='400' y='68' fill='white' font-family='sans-serif' font-size='24' text-anchor='middle'%3E800 × 120%3C/text%3E%3C/svg%3E"
					/>
				</section>

				<section>
					<h2 class="section-title">Scrollbars</h2>
					<p class="section-note">
						VS Code themes webview scrollbars (::-webkit-scrollbar-* and scrollbar-color) — mirrored here
						since pseudo-element rules don't pierce the shadow root either.
					</p>
					<div class="scroll-demo">
						<p>
							GitLens surfaces Git history directly in the editor gutter, so you rarely need to leave the
							file you're working in to understand how it got that way.
						</p>
						<p>
							The commit graph visualizes branches, merges, and tags across the whole repository, making
							it easy to see how work has flowed over time.
						</p>
						<p>
							Interactive rebase lets you reorder, squash, and reword commits before they ever leave your
							machine.
						</p>
						<p>
							Worktrees let you check out multiple branches at once, each in its own folder, without
							stashing or juggling a single working copy.
						</p>
						<p>
							Autolinks turn issue and PR references in commit messages into clickable links back to the
							tracker they came from.
						</p>
						<p>
							Launchpad groups your open pull requests by what they need from you next, so review work
							doesn't get lost in a flat list.
						</p>
					</div>
				</section>
			</div>
		`;
	}
}
