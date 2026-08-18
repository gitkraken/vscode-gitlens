import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { GraphMinimapDefaultVisibility } from '../../../../config.js';
import { cspStyleMap } from '../../shared/components/csp-style-map.directive.js';
import { boxSizingBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { PreviewKind } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/code-icon.js';

const sampleCode: { n: number; text: string; fn?: boolean; current?: boolean; container?: boolean }[] = [
	{ n: 1, text: 'export namespace Gitlens {', container: true },
	{ n: 2, text: '  export function supercharge(code: string) {', fn: true },
	{ n: 3, text: '    return optimize(parse(code));', current: true },
	{ n: 4, text: '  }' },
	{ n: 5, text: '}' },
];

const sampleBlameRows = [
	{ who: 'Eric Amodio', ago: '9 years ago', heat: 0.95 },
	{ who: 'Eric Amodio', ago: '9 years ago', heat: 0.95, same: true },
	{ who: 'You', ago: '3 weeks ago', heat: 0.05, current: true },
	{ who: 'Keith Daulton', ago: '2 years ago', heat: 0.55 },
	{ who: 'You', ago: '3 weeks ago', heat: 0.05, same: true },
];

const laneColors = [
	'var(--vscode-gitlens-graphLane1Color, var(--vscode-charts-green))',
	'var(--vscode-gitlens-graphLane2Color, var(--vscode-charts-blue))',
	'var(--vscode-gitlens-graphLane3Color, var(--vscode-charts-purple))',
	'var(--vscode-gitlens-graphLane4Color, var(--vscode-charts-orange))',
];

// Minimap marker rail / top-rail colors. The `--color-graph-minimap-*` aliases live in `graph.scss`
// (the Graph webview's own sheet), so they don't exist here — read the contributed theme colors that
// back them directly, which VS Code injects as `--vscode-*` into every webview.
const graphMinimapColors = {
	activity: 'var(--vscode-progressBar-background)',
	head: 'var(--vscode-gitlens-graphMinimapMarkerHeadColor, var(--vscode-charts-green))',
	upstream: 'var(--vscode-gitlens-graphMinimapMarkerUpstreamColor, var(--vscode-charts-green))',
	localBranches: 'var(--vscode-gitlens-graphMinimapMarkerLocalBranchesColor, var(--vscode-charts-blue))',
	remoteBranches: 'var(--vscode-gitlens-graphMinimapMarkerRemoteBranchesColor, var(--vscode-charts-blue))',
	pullRequests: 'var(--vscode-gitlens-graphMinimapMarkerPullRequestsColor, var(--vscode-charts-orange))',
	tags: 'var(--vscode-gitlens-graphMinimapMarkerTagsColor, var(--vscode-charts-yellow))',
	stashes: 'var(--vscode-gitlens-graphMinimapMarkerStashesColor, var(--color-foreground--50))',
} as const;

/*
 * Static graph-preview fixtures — hoisted so they aren't reallocated on every (signal-driven) render.
 *
 * All of the graph preview's geometry is in CSS px, not rem, because the gutter/minimap SVGs carry
 * px coordinate spaces: a rem-sized rows region would drift out of register with the SVG's nodes the
 * moment the webview's root font size changed. Typography and padding stay on the rem token scale.
 */
const graphRowHeight = 28; // the tall/list row step; `tallRowThreshold` (40) is not crossed
const graphRowCount = 6;
const graphRowsHeight = graphRowHeight * graphRowCount;
const graphGutterWidth = 96;
const graphNodeRadius = 9; // nodeRadiusFor('avatar')
const graphNodeCarveRadius = 11; // the background carve that keeps lane lines out of the node
const graphMergeNodeRadius = 8;
const graphLaneOrigin = 20;
// `laneSpacing('expanded', 'avatar')` is 24 in the real Graph; the preview steps by 16 so five lanes
// still fit the 96px gutter (per the handoff — widening the gutter would cost the message its room).
const graphLaneStep = 16;

function graphLaneX(lane: number): number {
	return graphLaneOrigin + lane * graphLaneStep;
}

function graphNodeY(row: number): number {
	return row * graphRowHeight + graphRowHeight / 2;
}

const graphRows: {
	lane: number;
	message: string;
	body?: string;
	merge?: boolean;
	/** Absent on merge rows, which carry no identity node */
	initials?: string;
	ref?: { icon: string; label: string; upstream?: string };
}[] = [
	{
		lane: 0,
		initials: 'EA',
		message: 'Supercharge the parser',
		ref: { icon: 'vm', label: 'main', upstream: 'origin' },
	},
	{ lane: 1, initials: 'KD', message: 'Add lane color tokens', ref: { icon: 'git-branch', label: 'graph-perf' } },
	{
		lane: 0,
		merge: true,
		message: 'Merge branch graph-perf',
		body: 'Bakes pass-through lanes into one raster per row',
	},
	{ lane: 0, initials: 'EA', message: 'Reuse the gutter raster between rows' },
	{ lane: 2, initials: 'RB', message: 'Cache the DAG layout', ref: { icon: 'tag', label: 'v15.2' } },
	{ lane: 0, initials: 'JS', message: 'Speed up ref lookups' },
];

// Lane strokes in the gutter SVG's coordinate space: straight verticals for pass-through lanes,
// cubics for cross-lane joins (the real connector shape). Lane 4 is a long-lived pass-through that
// never lands a node on a visible row — that is what makes the art read as a real repository.
const graphLanes: { lane: number; d: string }[] = [
	{ lane: 0, d: `M20 14 L20 ${graphRowsHeight}` },
	{ lane: 3, d: `M68 0 L68 ${graphRowsHeight}` },
	{ lane: 1, d: 'M36 42 C36 56 20 56 20 70' },
	{ lane: 2, d: 'M52 126 C52 140 20 140 20 154' },
];

/*
 * Minimap strip. The SVG is stretched to the frame's width (`preserveAspectRatio="none"`), so only
 * the y axis is 1:1 with px — hence the activity spline's `vector-effect="non-scaling-stroke"`.
 * Geometry mirrors `minimapRenderer.ts`: markerSize 3, markerShortY 4 / markerTallY 0 (the two rail
 * lanes), headTriangleHalfWidth 4 + headAnchorLineWidth 2, upstreamTriangleHalfWidth 3 +
 * upstreamAnchorLineWidth 1 at upstreamAnchorLineAlpha 0.5.
 */
const graphMinimapHeight = 26;
const graphMinimapWidth = 400;
const graphMinimapSpline =
	'M0 16 L10 12 L20 14 L30 8 L40 11 L50 5 L60 9 L70 13 L80 7 L90 4 L100 10 L110 14 L120 9 L130 6 L140 12 L150 8 L160 3 L170 7 L180 11 L190 15 L200 10 L210 6 L220 9 L230 13 L240 8 L250 5 L260 11 L270 7 L280 14 L290 10 L300 6 L310 12 L320 9 L330 4 L340 8 L350 13 L360 11 L370 7 L380 10 L390 15 L400 12';
const graphMinimapMarkerSize = 3;
const graphMinimapMarkerHeight = 4;
const graphMinimapShortLaneY = 18;
const graphMinimapTallLaneY = 22;
const graphMinimapMarkers: { x: number; y: number; color: string }[] = [
	{ x: 40, y: graphMinimapShortLaneY, color: graphMinimapColors.localBranches },
	{ x: 80, y: graphMinimapShortLaneY, color: graphMinimapColors.remoteBranches },
	{ x: 120, y: graphMinimapShortLaneY, color: graphMinimapColors.localBranches },
	{ x: 160, y: graphMinimapShortLaneY, color: graphMinimapColors.tags },
	{ x: 200, y: graphMinimapShortLaneY, color: graphMinimapColors.remoteBranches },
	{ x: 220, y: graphMinimapShortLaneY, color: graphMinimapColors.pullRequests },
	{ x: 250, y: graphMinimapShortLaneY, color: graphMinimapColors.localBranches },
	{ x: 300, y: graphMinimapTallLaneY, color: graphMinimapColors.stashes },
	{ x: 370, y: graphMinimapShortLaneY, color: graphMinimapColors.pullRequests },
];

function heatColor(age: number): string {
	if (age < 0.2) return 'var(--vscode-charts-green)';
	if (age < 0.5) return 'var(--vscode-charts-yellow)';
	if (age < 0.8) return 'var(--vscode-charts-orange)';
	return 'var(--vscode-charts-red)';
}

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-preview']: GlSettingsPreview;
	}
}

/**
 * Live, state-driven previews replacing the legacy static `.webp` images.
 *
 * Visual structure reacts to the relevant settings immediately; annotation
 * text for Inline Blame/Status Bar is rendered by the host's real
 * `CommitFormatter` (debounced RPC), so what you see is what GitLens shows.
 */
@customElement('gl-settings-preview')
export class GlSettingsPreview extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
				max-width: 80rem;
				font-size: 1.2rem;
				pointer-events: none;
				cursor: default;
			}

			/* Mimics an autolink/PR link visually without being a focusable,
	   clickable anchor (the preview is non-interactive). */
			.preview-link {
				color: var(--vscode-textLink-foreground);
			}

			.frame {
				position: relative;
				overflow: hidden;
				background-color: var(--vscode-editor-background);
				border: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.tab {
				display: inline-flex;
				gap: 0.7rem;
				align-items: center;
				padding: var(--gl-space-6) var(--gl-space-12);
				font-size: 1.15rem;
				color: var(--color-foreground--85);
				background-color: var(--vscode-editor-background);
				border-top: var(--gl-border-width) solid var(--vscode-button-background);
			}

			.tabs {
				background-color: var(--vscode-sideBar-background);
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
			}

			.code {
				padding: 0.5rem 0 0.7rem;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.2rem;
				line-height: 2.1rem;
			}

			.code--relative {
				position: relative;
			}

			.frame--placeholder {
				position: relative;
				height: 12rem;
			}

			.muted {
				color: var(--color-foreground--50);
			}

			.line {
				display: flex;
				align-items: center;
				height: 2.1rem;
				white-space: pre;
			}

			.line--current {
				background-color: var(
					--vscode-editor-lineHighlightBackground,
					color-mix(in srgb, var(--color-foreground) 5%, transparent)
				);
			}

			.line__number {
				flex: none;
				width: 3.2rem;
				padding-right: var(--gl-space-12);
				color: var(--vscode-editorLineNumber-foreground, var(--color-foreground--50));
				text-align: right;
				user-select: none;
			}

			.line__annotation {
				margin-left: 1.8rem;
				overflow: hidden;
				text-overflow: ellipsis;
				font-family: var(--vscode-font-family);
				font-size: 1.1rem;
				font-style: italic;
				color: var(--vscode-gitlens-trailingLineForegroundColor, var(--color-foreground--50));
				white-space: nowrap;
			}

			.codelens {
				display: flex;
				gap: var(--gl-space-12);
				align-items: center;
				height: 2rem;
				padding-left: 4.4rem;
				font-size: 1.05rem;
				color: var(--color-foreground--65);
			}

			.codelens--block {
				padding-left: 6.2rem;
			}

			/* When the file-scope lens is also shown, separate it from the
	   container-scope lens (both sit at column 0) so they read distinctly. */
			.codelens--spaced {
				margin-top: var(--gl-space-8);
			}

			.syntax-keyword {
				color: var(--vscode-charts-blue);
			}

			.syntax-fn {
				color: var(--vscode-charts-yellow);
			}

			.blame-gutter {
				display: flex;
				flex: none;
				gap: var(--gl-space-6);
				align-items: center;
				width: 17rem;
				height: 100%;
				padding-left: var(--gl-space-8);
				overflow: hidden;
				border-right: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.blame-gutter__heat {
				flex: none;
				width: 0.3rem;
				height: 1.6rem;
				border-radius: var(--gl-radius-xs);
			}

			.avatar {
				flex: none;
				width: 1.5rem;
				height: 1.5rem;
				background: var(--vscode-button-background);

				/* HC themes set button-background to the editor background, so a
		   borderless fill vanishes — the contrast border keeps it visible. */
				border: var(--gl-border-width) solid var(--vscode-contrastBorder, transparent);
				border-radius: 50%;
			}

			.avatar--other {
				background: var(--vscode-charts-blue);
			}

			.blame-gutter__text {
				overflow: hidden;
				text-overflow: ellipsis;
				font-family: var(--vscode-font-family);
				font-size: 1.05rem;
				color: var(--color-foreground--65);
				white-space: nowrap;
			}

			.heat-bar {
				flex: none;
				width: 0.4rem;
				height: 1.7rem;
				margin-left: var(--gl-space-6);
				border-radius: var(--gl-radius-xs);
			}

			.overview-ruler {
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				display: flex;
				flex-direction: column;
				gap: 0.3rem;
				align-items: center;
				width: 1.2rem;
				padding-top: var(--gl-space-8);
				background-color: var(--vscode-editor-background);
				border-left: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.overview-ruler__mark {
				width: 0.6rem;
				height: 0.6rem;
				border-radius: 0.1rem;
			}

			.statusbar {
				display: flex;
				gap: 1.4rem;
				align-items: center;
				height: 2.4rem;
				padding: 0 var(--gl-space-10);
				font-size: 1.1rem;
				color: var(--vscode-statusBar-foreground, var(--vscode-button-foreground));
				background-color: var(--vscode-statusBar-background, var(--vscode-button-background));
			}

			.statusbar__item {
				display: inline-flex;
				gap: 0.5rem;
				align-items: center;
				white-space: nowrap;
			}

			.statusbar__spacer {
				flex: 1;
			}

			.editor-placeholder {
				display: grid;
				place-items: center;
				height: 9rem;
				font-size: 1.1rem;
				color: var(--color-foreground--50);
			}

			.hover-card {
				max-width: 40rem;
				margin: var(--gl-space-10) auto;
				overflow: hidden;
				background-color: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
				border: var(--gl-border-width) solid var(--vscode-editorHoverWidget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
				box-shadow: 0 0.8rem 2.4rem var(--vscode-widget-shadow);
			}

			.hover-card__header {
				display: flex;
				gap: 0.9rem;
				align-items: flex-start;
				padding: 1.1rem 1.3rem 0.8rem;
				font-size: 1.2rem;
				line-height: 1.5;
			}

			.hover-card__avatar {
				flex: none;
				background: var(--vscode-button-background);
				border: var(--gl-border-width) solid var(--vscode-contrastBorder, transparent);
				border-radius: 50%;
			}

			.hover-card__actions {
				display: flex;
				gap: 1.4rem;
				padding: 0.7rem 1.3rem;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.1rem;
				color: var(--color-link-foreground);
				border-top: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.hover-card__diff {
				padding: 0.8rem 1.3rem;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.1rem;
				border-top: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.diff-removed {
				color: var(--gl-stat-removed, var(--vscode-charts-red));
			}

			.diff-added {
				color: var(--gl-stat-added, var(--vscode-charts-green));
			}

			/* Minimap strip — a stretched-to-fit SVG, so its height is the only px-faithful axis. */
			.graph-minimap {
				box-sizing: content-box;
				display: flex;
				align-items: stretch;
				height: 26px;
				overflow: hidden;
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			/* Rows region: px, not rem, so the HTML rows stay in register with the gutter SVG's
	   px coordinate space at any root font size. */
			.graph-rows {
				position: relative;
				height: 168px;
				overflow: hidden;
			}

			.graph-gutter {
				position: absolute;
				top: 0;
				left: 0;
			}

			/* The identity node's CONTENT layer (person glyph or initials). The carve, the state fill
	   and the lane ring are drawn in the gutter SVG beneath it; only the glyph/initials sit
	   here so the avatar state can use the shipped codicon font via <code-icon>. */
			.graph-node {
				--code-icon-size: 1.2rem;

				position: absolute;
				display: grid;
				place-items: center;
				width: 18px;
				height: 18px;
				font-size: 0.9rem;
				font-weight: 600;
				color: var(--color-foreground);
				text-transform: uppercase;
			}

			.graph-row {
				position: absolute;
				right: 0.8rem;
				left: 100px;
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				height: 28px;
			}

			.graph-row--dimmed {
				opacity: 0.45;
			}

			/* Mirrors .gl-graph__ref-pill: the ring is an INSET box-shadow (not a border) over a
	   transparent background, so the pill's padding box is its visual box. */
			.graph-ref-pill {
				display: inline-flex;
				flex: none;
				gap: var(--gl-space-6);
				align-items: center;
				padding: 0.4rem 0.9rem;
				font-size: 1rem;
				font-weight: 500;
				line-height: 1;
				white-space: nowrap;
				background-color: transparent;
				border-radius: var(--gl-radius-sm);
			}

			.graph-ref-pill__icon {
				--code-icon-size: 1.2rem;

				display: inline-flex;
				flex-shrink: 0;
				align-items: center;
			}

			/* Mirrors .gl-graph__ref-pill-upstream — split off behind a 1px divider. */
			.graph-ref-pill__upstream {
				display: inline-flex;
				gap: 0.3rem;
				align-items: center;
				padding-left: 0.5rem;
				margin-left: 0.1rem;
				line-height: 1;
				border-left: 1px solid currentcolor;
			}

			.graph-message {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: 1.2rem;
				color: var(--color-foreground);
				white-space: nowrap;
			}

			/* Per .gl-graph__message-body/-sep: dimmed RELATIVE to the row, so the subject reads first. */
			.graph-message__body,
			.graph-message__sep {
				color: color-mix(in srgb, transparent 40%, currentcolor);
			}

			.graph-message__sep {
				margin: 0 var(--gl-space-4);
			}

			.off-overlay {
				position: absolute;
				inset: 0;
				display: grid;
				place-items: center;
				font-size: 1.15rem;
				color: var(--color-foreground--50);
				background-color: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
			}

			.off-overlay span {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ type: String })
	kind!: PreviewKind;

	@property({ attribute: false })
	actions?: SettingsActions;

	// `undefined` distinguishes "not yet loaded" (shows '…') from a legitimately empty result
	@state()
	private _blameAnnotation: string | undefined;

	@state()
	private _statusBarText: string | undefined;

	// Composite of every input the host preview depends on (format + the PR/date settings it reads),
	// so the annotation re-fetches when any of them change — not only when the format string changes
	private _lastBlameKey: string | undefined;
	private _lastStatusBarKey: string | undefined;

	private readonly fetchBlameAnnotation = debounce((format: string) => {
		void this.actions
			?.generateFormatPreview('currentLine.format', 'commit', format)
			.then(preview => {
				this._blameAnnotation = preview;
			})
			.catch(() => {});
	}, 200);

	private readonly fetchStatusBarText = debounce((format: string) => {
		void this.actions
			?.generateFormatPreview('statusBar.format', 'commit', format)
			.then(preview => {
				this._statusBarText = preview;
			})
			.catch(() => {});
	}, 200);

	override willUpdate(): void {
		// Trigger the (debounced) host preview fetches here, not in render(), so
		// render stays side-effect-free. Only the two annotation-bearing previews
		// need them; the composite key re-fetches when the format or any setting
		// the host formatter reads (PR toggle, default date format) changes. Signal
		// reads here are tracked the same as in render (SignalWatcher).
		if (this.actions == null) return;

		if (this.kind === 'blame' && (this.get<boolean>('currentLine.enabled') ?? false)) {
			const format = this.get<string>('currentLine.format') ?? '';
			const key = `${format}\n${this.get<boolean>('currentLine.pullRequests.enabled') ?? false}\n${
				this.get<string>('defaultDateFormat') ?? ''
			}`;
			if (key !== this._lastBlameKey) {
				this._lastBlameKey = key;
				this.fetchBlameAnnotation(format);
			}
		} else if (this.kind === 'statusbar' && (this.get<boolean>('statusBar.enabled') ?? false)) {
			const format = this.get<string>('statusBar.format') ?? '';
			const key = `${format}\n${this.get<boolean>('statusBar.pullRequests.enabled') ?? false}\n${
				this.get<string>('defaultDateFormat') ?? ''
			}`;
			if (key !== this._lastStatusBarKey) {
				this._lastStatusBarKey = key;
				this.fetchStatusBarText(format);
			}
		}
	}

	override render(): unknown {
		switch (this.kind) {
			case 'blame':
				return this.renderBlame();
			case 'codelens':
				return this.renderCodeLens();
			case 'statusbar':
				return this.renderStatusBar();
			case 'fileblame':
				return this.renderFileBlame();
			case 'filechanges':
				return this.renderFileChanges();
			case 'heatmap':
				return this.renderHeatmap();
			case 'graph':
				return this.renderGraph();
			case 'hover':
				return this.renderHover();
			default:
				return nothing;
		}
	}

	private get<T>(path: string): T | undefined {
		return this._state.getSettingValue<T>(path);
	}

	private renderEditorChrome(content: unknown, off?: string) {
		return html`<div class="frame">
			<div class="tabs">
				<span class="tab"><code-icon icon="file" aria-hidden="true"></code-icon> supercharge.ts</span>
			</div>
			${content}
			${
				off
					? html`<div class="off-overlay">
							<span><code-icon icon="eye-closed" aria-hidden="true"></code-icon>${off}</span>
						</div>`
					: nothing
			}
		</div>`;
	}

	private renderCodeLine(line: (typeof sampleCode)[number], annotation?: string) {
		return html`<div class="line ${line.current ? 'line--current' : ''}">
			<span class="line__number">${line.n}</span>
			<span>${this.renderSyntax(line.text)}</span>
			${annotation ? html`<span class="line__annotation">${annotation}</span>` : nothing}
		</div>`;
	}

	private renderSyntax(text: string) {
		// A lightweight, theme-safe approximation — enough to read as code
		const parts = text.split(/(\bexport\b|\bnamespace\b|\bfunction\b|\breturn\b|\bstring\b)/);
		return parts.map(part =>
			/^(export|namespace|function|return|string)$/.test(part)
				? html`<span class="syntax-keyword">${part}</span>`
				: html`<span>${part}</span>`,
		);
	}

	private renderBlame() {
		const on = this.get<boolean>('currentLine.enabled') ?? false;

		return this.renderEditorChrome(
			html`<div class="code">
				${sampleCode.map(line =>
					this.renderCodeLine(line, line.current && on ? (this._blameAnnotation ?? '…') : undefined),
				)}
			</div>`,
			on ? undefined : 'Inline Blame is off',
		);
	}

	private renderCodeLens() {
		const on = this.get<boolean>('codeLens.enabled') ?? false;
		const recent = this.get<boolean>('codeLens.recentChange.enabled') ?? false;
		const authors = this.get<boolean>('codeLens.authors.enabled') ?? false;
		const scopes = this.get<string[]>('codeLens.scopes') ?? [];

		const lens = html`${recent ? html`<span>Eric Amodio, 3 minutes ago</span>` : nothing}
		${authors ? html`<span>1 author (Eric Amodio)</span>` : nothing}`;

		const fileLens = on && scopes.includes('document');

		return this.renderEditorChrome(
			html`<div class="code">
				${fileLens ? html`<div class="codelens">${lens}</div>` : nothing}
				${sampleCode.map(line => {
					const containerLens = on && line.container && scopes.includes('containers');
					const blockLens = on && line.fn && scopes.includes('blocks');
					return html`${
						containerLens
							? html`<div class="codelens ${fileLens ? 'codelens--spaced' : ''}">${lens}</div>`
							: nothing
					}${
						blockLens ? html`<div class="codelens codelens--block">${lens}</div>` : nothing
					}${this.renderCodeLine(line)}`;
				})}
			</div>`,
			on ? undefined : 'Git CodeLens is off',
		);
	}

	private renderStatusBar() {
		const on = this.get<boolean>('statusBar.enabled') ?? false;
		const right = (this.get<string>('statusBar.alignment') ?? 'right') === 'right';

		const blame = on
			? html`<span class="statusbar__item"
					><code-icon icon="gl-gitlens" aria-hidden="true"></code-icon>${this._statusBarText ?? '…'}</span
				>`
			: nothing;

		return html`<div class="frame">
			<div class="editor-placeholder">editor</div>
			<div class="statusbar">
				<span class="statusbar__item"><code-icon icon="git-branch" aria-hidden="true"></code-icon> main</span>
				${right ? nothing : blame}
				<span class="statusbar__spacer"></span>
				${right ? blame : nothing}
				<span class="statusbar__item">Ln 3, Col 12</span>
				<span class="statusbar__item">UTF-8</span>
			</div>
		</div>`;
	}

	private renderFileBlame() {
		const avatars = this.get<boolean>('blame.avatars') ?? true;
		const compact = this.get<boolean>('blame.compact') ?? true;
		const heatmap = this.get<boolean>('blame.heatmap.enabled') ?? true;
		const heatmapLeft = (this.get<string>('blame.heatmap.location') ?? 'right') === 'left';
		const highlight = this.get<boolean>('blame.highlight.enabled') ?? true;

		return this.renderEditorChrome(
			html`<div class="code">
				${sampleBlameRows.map((row, i) => {
					const showBlame = !(compact && row.same);
					return html`<div class="line ${row.current && highlight ? 'line--current' : ''}">
						<span class="blame-gutter">
							${
								heatmap && heatmapLeft
									? html`<span
											class="blame-gutter__heat"
											style=${cspStyleMap({ background: heatColor(row.heat) })}
										></span>`
									: nothing
							}
							${
								avatars && showBlame
									? html`<span class="avatar ${row.who === 'You' ? '' : 'avatar--other'}"></span>`
									: nothing
							}
							${
								showBlame
									? html`<span class="blame-gutter__text">${row.who}, ${row.ago}</span>`
									: nothing
							}
						</span>
						${
							heatmap && !heatmapLeft
								? html`<span
										class="heat-bar"
										style=${cspStyleMap({ background: heatColor(row.heat) })}
									></span>`
								: nothing
						}
						<span class="line__number">${i + 1}</span>
						<span>${this.renderSyntax(sampleCode[Math.min(i, sampleCode.length - 1)].text)}</span>
					</div>`;
				})}
			</div>`,
		);
	}

	private renderFileChanges() {
		const locations = this.get<string[]>('changes.locations') ?? [];
		const gutter = locations.includes('gutter');
		const line = locations.includes('line');
		const overview = locations.includes('overview');

		return this.renderEditorChrome(
			html`<div class="code code--relative">
				${sampleBlameRows.map(
					(row, i) =>
						html`<div
							class="line"
							style=${cspStyleMap({
								background:
									row.current && line
										? 'color-mix(in srgb, var(--vscode-charts-green) 12%, transparent)'
										: null,
							})}
						>
							${
								gutter && row.current
									? html`<span
											class="heat-bar"
											style=${cspStyleMap({
												background: 'var(--gl-stat-modified, var(--vscode-charts-yellow))',
											})}
										></span>`
									: html`<span
											class="heat-bar"
											style=${cspStyleMap({ background: 'transparent' })}
										></span>`
							}
							<span class="line__number">${i + 1}</span>
							<span>${this.renderSyntax(sampleCode[Math.min(i, sampleCode.length - 1)].text)}</span>
						</div>`,
				)}
				${
					overview
						? html`<div class="overview-ruler">
								<span
									class="overview-ruler__mark"
									style=${cspStyleMap({
										background: 'var(--gl-stat-modified, var(--vscode-charts-yellow))',
										marginTop: '3.4rem',
									})}
								></span>
							</div>`
						: nothing
				}
			</div>`,
		);
	}

	private renderHeatmap() {
		const locations = this.get<string[]>('heatmap.locations') ?? [];
		const gutter = locations.includes('gutter');
		const overview = locations.includes('overview');
		const fade = this.get<boolean>('heatmap.fadeLines') ?? false;

		return this.renderEditorChrome(
			html`<div class="code code--relative">
				${sampleBlameRows.map(
					(row, i) =>
						html`<div
							class="line"
							style=${cspStyleMap({ opacity: fade ? String(1 - row.heat * 0.6) : null })}
						>
							${
								gutter
									? html`<span
											class="heat-bar"
											style=${cspStyleMap({ background: heatColor(row.heat) })}
										></span>`
									: nothing
							}
							<span class="line__number">${i + 1}</span>
							<span>${this.renderSyntax(sampleCode[Math.min(i, sampleCode.length - 1)].text)}</span>
						</div>`,
				)}
				${
					overview
						? html`<div class="overview-ruler">
								${sampleBlameRows.map(
									row =>
										html`<span
											class="overview-ruler__mark"
											style=${cspStyleMap({ background: heatColor(row.heat) })}
										></span>`,
								)}
							</div>`
						: nothing
				}
			</div>`,
		);
	}

	private renderGraph() {
		// `onSearch` only shows the minimap while searching, but the preview has no search — draw it
		// anyway so the setting reads as "can show" rather than looking disabled. `hidden` is the one
		// policy with nothing to preview until the user shows it themselves.
		const minimap =
			(this.get<boolean>('graph.minimap.enabled') ?? true) &&
			this.get<GraphMinimapDefaultVisibility>('graph.minimap.defaultVisibility') !== 'hidden';
		const avatars = this.get<boolean>('graph.avatars') ?? true;
		const dimMerges = this.get<boolean>('graph.dimMergeCommits') ?? false;

		return html`<div class="frame">
			${minimap ? this.renderGraphMinimap() : nothing}
			<div class="graph-rows">
				<svg class="graph-gutter" width=${graphGutterWidth} height=${graphRowsHeight} aria-hidden="true">
					${graphLanes.map(
						lane =>
							svg`<path d=${lane.d} fill="none" stroke=${laneColors[lane.lane]} stroke-width="2"></path>`,
					)}
					${graphRows.map((row, i) => this.renderGraphNode(row, i, dimMerges))}
				</svg>
				${graphRows.map((row, i) =>
					row.initials == null
						? nothing
						: html`<span
								class="graph-node"
								style=${cspStyleMap({
									left: `${graphLaneX(row.lane) - graphNodeRadius}px`,
									top: `${graphNodeY(i) - graphNodeRadius}px`,
								})}
								aria-hidden="true"
								>${
									// `graph.avatars` picks image-vs-initials, it never hides identity. The preview has
									// no avatar URLs (that would need host RPC it deliberately doesn't do), so the
									// image state is the same person-glyph placeholder the design reference uses.
									avatars ? html`<code-icon icon="account"></code-icon>` : row.initials
								}</span
							>`,
				)}
				${graphRows.map((row, i) => this.renderGraphRow(row, i, dimMerges))}
			</div>
		</div>`;
	}

	private renderGraphMinimap() {
		return html`<div class="graph-minimap" aria-hidden="true">
			<svg
				width="100%"
				height=${graphMinimapHeight}
				viewBox="0 0 ${graphMinimapWidth} ${graphMinimapHeight}"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<rect
					x="292"
					y="0"
					width="76"
					height=${graphMinimapHeight}
					fill="var(--vscode-scrollbarSlider-background)"
				></rect>
				<path
					d=${graphMinimapSpline}
					fill="none"
					stroke=${graphMinimapColors.activity}
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				></path>
				${graphMinimapMarkers.map(
					m =>
						svg`<rect x=${m.x} y=${m.y} width=${graphMinimapMarkerSize} height=${graphMinimapMarkerHeight} fill=${m.color}></rect>`,
				)}
				<polygon points="330,0 338,0 334,6" fill=${graphMinimapColors.head}></polygon>
				<rect x="333" y="18" width="2" height="8" fill=${graphMinimapColors.head}></rect>
				<polygon points="356,0 362,0 359,5" fill=${graphMinimapColors.upstream} opacity="0.5"></polygon>
				<rect x="358" y="18" width="1" height="8" fill=${graphMinimapColors.upstream} opacity="0.5"></rect>
			</svg>
		</div>`;
	}

	/**
	 * The gutter's per-row node art. Layer order matters: the background carve has to paint over the
	 * lane strokes before anything else, or the lanes show through the node (the real gutter carves
	 * the same way). Merge rows are hollow rings and carry no identity node.
	 */
	private renderGraphNode(row: (typeof graphRows)[number], index: number, dimMerges: boolean) {
		const x = graphLaneX(row.lane);
		const y = graphNodeY(index);
		const lane = laneColors[row.lane];

		const carve = svg`<circle cx=${x} cy=${y} r=${graphNodeCarveRadius} fill="var(--vscode-editor-background)"></circle>`;
		if (row.merge) {
			// `dimMergeCommits` dims the whole row in the real Graph (`.gl-graph__row.is-dimmed` covers its
			// gutter zone), so fade the node too — but only the ring: the carve has to stay opaque or the
			// lane strokes bleed back through. The hollow node's own fill is the carve's color anyway, so
			// fading it changes nothing but the stroke.
			return svg`${carve}<circle cx=${x} cy=${y} r=${graphMergeNodeRadius} fill="var(--vscode-editor-background)" stroke=${lane} stroke-width="2" opacity=${dimMerges ? 0.45 : 1}></circle>`;
		}

		return svg`${carve}<circle cx=${x} cy=${y} r=${graphNodeRadius} fill="var(--vscode-toolbar-hoverBackground)"></circle><circle cx=${x} cy=${y} r=${graphNodeRadius} fill="none" stroke=${lane} stroke-width="2"></circle>`;
	}

	private renderGraphRow(row: (typeof graphRows)[number], index: number, dimMerges: boolean) {
		const lane = laneColors[row.lane];
		// The lane color IS the pill's label color (`--ref-color`) and, at 60%, its ring
		// (`--ref-border` = `withAlpha(color, 0.6)`) — the same derivation `refStyle()` uses.
		const ring = `color-mix(in srgb, ${lane} 60%, transparent)`;

		return html`<div
			class="graph-row ${dimMerges && row.merge ? 'graph-row--dimmed' : ''}"
			style=${cspStyleMap({ top: `${index * graphRowHeight}px` })}
		>
			${
				row.ref
					? html`<span
							class="graph-ref-pill"
							style=${cspStyleMap({ color: lane, boxShadow: `inset 0 0 0 1px ${ring}` })}
							><span class="graph-ref-pill__icon"
								><code-icon icon=${row.ref.icon} aria-hidden="true"></code-icon></span
							>${row.ref.label}${
								row.ref.upstream
									? html`<span
											class="graph-ref-pill__upstream"
											style=${cspStyleMap({ borderLeftColor: ring })}
											><span class="graph-ref-pill__icon"
												><code-icon icon="cloud" aria-hidden="true"></code-icon></span
											>${row.ref.upstream}</span
										>`
									: nothing
							}</span
						>`
					: nothing
			}
			<span class="graph-message"
				>${row.message}${
					row.body
						? html`<span class="graph-message__sep">•</span
								><span class="graph-message__body">${row.body}</span>`
						: nothing
				}</span
			>
		</div>`;
	}

	private renderHover() {
		const avatars = this.get<boolean>('hovers.avatars') ?? true;
		const avatarSize = this.get<number>('hovers.avatarSize') ?? 32;
		const autolinks = this.get<boolean>('hovers.autolinks.enabled') ?? true;
		const diff = this.get<boolean>('hovers.currentLine.changes') ?? true;
		const on = this.get<boolean>('hovers.enabled') ?? true;

		if (!on) {
			return html`<div class="frame frame--placeholder">
				<div class="off-overlay">
					<span><code-icon icon="eye-closed" aria-hidden="true"></code-icon>Hovers are off</span>
				</div>
			</div>`;
		}

		return html`<div class="hover-card">
			<div class="hover-card__header">
				${
					avatars
						? html`<span
								class="hover-card__avatar"
								style=${cspStyleMap({ width: `${avatarSize}px`, height: `${avatarSize}px` })}
							></span>`
						: nothing
				}
				<span>
					<strong>Eric Amodio</strong>, 9 years ago via <span class="preview-link">PR #1</span>
					<span class="muted">(May 6, 2016)</span><br />
					<strong>Supercharged ${autolinks ? html`<span class="preview-link">#1138</span>` : nothing}</strong>
				</span>
			</div>
			<div class="hover-card__actions" aria-hidden="true">
				<span><code-icon icon="git-commit" size="12"></code-icon> 5e7c190</span>
				<span><code-icon icon="git-pull-request" size="12"></code-icon> PR #1</span>
				<code-icon icon="git-compare" size="13"></code-icon>
				<code-icon icon="history" size="13"></code-icon>
				<code-icon icon="globe" size="13"></code-icon>
			</div>
			${
				diff
					? html`<div class="hover-card__diff">
							<div class="diff-removed">- return code;</div>
							<div class="diff-added">+ return optimize(parse(code));</div>
						</div>`
					: nothing
			}
		</div>`;
	}
}
