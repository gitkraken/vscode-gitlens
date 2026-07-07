/*global*/
import './styleguide.scss';
import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { State } from '../../styleguide/protocol.js';
import { GlAppHost } from '../shared/appHost.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { HostIpc } from '../shared/ipc.js';
import type { ThemeChangeEvent } from '../shared/theme.js';
import '../shared/components/code-icon.js';
import { componentGroups, nonElements, undemoed } from './demos/index.js';
import { StyleguideStateProvider } from './stateProvider.js';
import { styleguideStyles } from './styleguide.css.js';

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
			{ name: '--gl-color-success-bg', derivation: 'mix(success 16%, surface)' },
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
	static override styles = styleguideStyles;

	@query('.probe') private probe!: HTMLElement;
	@state() private tab: 'tokens' | 'components' = 'tokens';
	@state() private auditOn = localStorage.getItem('gl-styleguide-audit') === 'on';
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
		root.querySelectorAll<HTMLElement>('.swatch[data-bg]').forEach(el => {
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

	private selectTab(tab: 'tokens' | 'components'): void {
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
			`,
		);
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
				<div class="controlbar">
					<span class="scheme-chip ${this.isHc ? 'scheme-chip--hc' : ''}">
						<code-icon icon="${this.isHc ? 'color-mode' : 'symbol-color'}"></code-icon> ${this.scheme}
					</span>
					${this.tab === 'tokens'
						? html`<label class="toggle">
								Accessibility audit
								<input type="checkbox" .checked=${this.auditOn} @change=${this.toggleAudit} />
							</label>`
						: nothing}
				</div>

				<h1>GitLens styleguide</h1>
				<p class="subtitle">
					Live reference for the --gl-color-* system and the shared components that consume it. Switch VS Code
					themes to verify all four schemes.
				</p>

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
						class="tab ${this.tab === 'components' ? 'tab--active' : ''}"
						role="tab"
						aria-selected=${this.tab === 'components'}
						@click=${() => this.selectTab('components')}
					>
						Components
					</button>
				</div>

				${this.tab === 'tokens' ? this.renderTokensTab() : this.renderComponentsTab()}
			</div>
		`;
	}

	private renderTokensTab(): unknown {
		return html`${this.renderAuditBanner()} ${this.renderPalette()} ${this.renderScales()}`;
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
}
