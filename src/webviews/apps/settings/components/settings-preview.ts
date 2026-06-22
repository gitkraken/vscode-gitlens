import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { cspStyleMap } from '../../shared/components/csp-style-map.directive.js';
import { boxSizingBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { PreviewKind } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/code-icon.js';

export const tagName = 'gl-settings-preview';

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

// Static graph-preview fixtures — hoisted so they aren't reallocated on every (signal-driven) render
const graphRows = [
	{ lane: 0, message: 'Supercharge the parser', ref: 'main', refIcon: 'git-branch', who: 'you' },
	{ lane: 1, message: 'Add lane color tokens', who: 'other', from: 0 },
	{ lane: 0, message: 'Merge branch graph-perf', who: 'other', merge: true },
	{ lane: 2, message: 'Cache the DAG layout', ref: 'v15.2', refIcon: 'tag', who: 'other' },
	{ lane: 0, message: 'Fix minimap sparkline', who: 'you' },
];
const graphMinimapBars = [5, 9, 4, 12, 7, 3, 10, 6, 14, 8, 4, 11, 5, 9, 6];

function heatColor(age: number): string {
	if (age < 0.2) return 'var(--vscode-charts-green)';
	if (age < 0.5) return 'var(--vscode-charts-yellow)';
	if (age < 0.8) return 'var(--vscode-charts-orange)';
	return 'var(--vscode-charts-red)';
}

/**
 * Live, state-driven previews replacing the legacy static `.webp` images.
 *
 * Visual structure reacts to the relevant settings immediately; annotation
 * text for Inline Blame/Status Bar is rendered by the host's real
 * `CommitFormatter` (debounced RPC), so what you see is what GitLens shows.
 */
@customElement(tagName)
export class GlSettingsPreview extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
				font-size: 1.2rem;
				pointer-events: none;

				/* The preview is a pure illustration — none of its mock affordances
		   (autolinks, action icons, etc.) are real. Neutralize all pointer
		   interaction so nothing reads as clickable. */
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

			.graph-svg {
				position: absolute;
				top: 0;
				left: 4px;
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

			.graph-header {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: 0.7rem 1.1rem;
				font-size: 1.1rem;
				color: var(--color-foreground--75);
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.graph-minimap {
				display: flex;
				gap: var(--gl-space-2);
				align-items: flex-end;
				height: 2.2rem;
				padding: 0 0.8rem 0.3rem;
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.graph-minimap__bar {
				flex: 1;
				border-radius: 0.1rem;
				opacity: 0.8;
			}

			.graph-rows {
				position: relative;
				height: 13rem;
				overflow: hidden;
			}

			.graph-row {
				position: absolute;
				right: 0.8rem;
				left: 7rem;
				display: flex;
				gap: 0.7rem;
				align-items: center;
				height: 2.6rem;
			}

			.graph-row--dimmed {
				opacity: 0.45;
			}

			.graph-row__ref {
				display: inline-flex;
				flex: none;
				gap: 0.3rem;
				align-items: center;
				padding: 0.1rem 0.6rem;
				font-size: 1rem;
				border-radius: var(--gl-radius-sm);
			}

			.graph-row__message {
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: 1.15rem;
				color: var(--color-foreground--85);
				white-space: nowrap;
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
			${off
				? html`<div class="off-overlay">
						<span><code-icon icon="eye-closed" aria-hidden="true"></code-icon>${off}</span>
					</div>`
				: nothing}
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
		const format = this.get<string>('currentLine.format') ?? '';

		if (on && this.actions != null) {
			// The host preview also reads pullRequests.enabled and defaultDateFormat, so re-fetch when
			// any of those change — not just the format string (and only once actions are wired up)
			const key = `${format}\n${this.get<boolean>('currentLine.pullRequests.enabled') ?? false}\n${
				this.get<string>('defaultDateFormat') ?? ''
			}`;
			if (key !== this._lastBlameKey) {
				this._lastBlameKey = key;
				this.fetchBlameAnnotation(format);
			}
		}

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
					return html`${containerLens
						? html`<div class="codelens ${fileLens ? 'codelens--spaced' : ''}">${lens}</div>`
						: nothing}${blockLens
						? html`<div class="codelens codelens--block">${lens}</div>`
						: nothing}${this.renderCodeLine(line)}`;
				})}
			</div>`,
			on ? undefined : 'Git CodeLens is off',
		);
	}

	private renderStatusBar() {
		const on = this.get<boolean>('statusBar.enabled') ?? false;
		const format = this.get<string>('statusBar.format') ?? '';
		const right = (this.get<string>('statusBar.alignment') ?? 'right') === 'right';

		if (on && this.actions != null) {
			const key = `${format}\n${this.get<boolean>('statusBar.pullRequests.enabled') ?? false}\n${
				this.get<string>('defaultDateFormat') ?? ''
			}`;
			if (key !== this._lastStatusBarKey) {
				this._lastStatusBarKey = key;
				this.fetchStatusBarText(format);
			}
		}

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
							${heatmap && heatmapLeft
								? html`<span
										class="blame-gutter__heat"
										style=${cspStyleMap({ background: heatColor(row.heat) })}
									></span>`
								: nothing}
							${avatars && showBlame
								? html`<span class="avatar ${row.who === 'You' ? '' : 'avatar--other'}"></span>`
								: nothing}
							${showBlame
								? html`<span class="blame-gutter__text">${row.who}, ${row.ago}</span>`
								: nothing}
						</span>
						${heatmap && !heatmapLeft
							? html`<span
									class="heat-bar"
									style=${cspStyleMap({ background: heatColor(row.heat) })}
								></span>`
							: nothing}
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
							${gutter && row.current
								? html`<span
										class="heat-bar"
										style=${cspStyleMap({
											background: 'var(--gl-stat-modified, var(--vscode-charts-yellow))',
										})}
									></span>`
								: html`<span
										class="heat-bar"
										style=${cspStyleMap({ background: 'transparent' })}
									></span>`}
							<span class="line__number">${i + 1}</span>
							<span>${this.renderSyntax(sampleCode[Math.min(i, sampleCode.length - 1)].text)}</span>
						</div>`,
				)}
				${overview
					? html`<div class="overview-ruler">
							<span
								class="overview-ruler__mark"
								style=${cspStyleMap({
									background: 'var(--gl-stat-modified, var(--vscode-charts-yellow))',
									marginTop: '3.4rem',
								})}
							></span>
						</div>`
					: nothing}
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
							${gutter
								? html`<span
										class="heat-bar"
										style=${cspStyleMap({ background: heatColor(row.heat) })}
									></span>`
								: nothing}
							<span class="line__number">${i + 1}</span>
							<span>${this.renderSyntax(sampleCode[Math.min(i, sampleCode.length - 1)].text)}</span>
						</div>`,
				)}
				${overview
					? html`<div class="overview-ruler">
							${sampleBlameRows.map(
								row =>
									html`<span
										class="overview-ruler__mark"
										style=${cspStyleMap({ background: heatColor(row.heat) })}
									></span>`,
							)}
						</div>`
					: nothing}
			</div>`,
		);
	}

	private renderGraph() {
		const minimap = this.get<boolean>('graph.minimap.enabled') ?? true;
		const avatars = this.get<boolean>('graph.avatars') ?? true;
		const dimMerges = this.get<boolean>('graph.dimMergeCommits') ?? false;

		const rows = graphRows;
		const rowHeight = 26;

		return html`<div class="frame">
			<div class="graph-header">
				<code-icon icon="gl-graph" aria-hidden="true"></code-icon>
				<span class="statusbar__item"><code-icon icon="git-branch" aria-hidden="true"></code-icon> main</span>
				<span class="statusbar__spacer"></span>
				<code-icon icon="search" aria-hidden="true"></code-icon>
				<code-icon icon="filter" aria-hidden="true"></code-icon>
			</div>
			${minimap
				? html`<div class="graph-minimap" aria-hidden="true">
						${graphMinimapBars.map(
							(h, i) =>
								html`<span
									class="graph-minimap__bar"
									style=${cspStyleMap({
										height: `${h}px`,
										background: laneColors[i % laneColors.length],
									})}
								></span>`,
						)}
					</div>`
				: nothing}
			<div class="graph-rows">
				<svg width="64" height=${rows.length * rowHeight} class="graph-svg" aria-hidden="true">
					${rows.map((row, i) => {
						const x = 12 + row.lane * 14;
						const y = i * rowHeight + rowHeight / 2;
						const next = rows[i + 1];
						return svg`
							${
								next != null
									? svg`<line x1=${x} y1=${y} x2=${12 + next.lane * 14} y2=${y + rowHeight} stroke=${laneColors[row.lane]} stroke-width="2"></line>`
									: nothing
							}
							${
								row.from != null
									? svg`<path d="M${12 + row.from * 14} ${y - rowHeight} Q ${x} ${y - rowHeight} ${x} ${y}" fill="none" stroke=${laneColors[row.lane]} stroke-width="2"></path>`
									: nothing
							}
							<circle cx=${x} cy=${y} r=${row.merge ? 4 : 5} fill=${row.merge ? 'var(--vscode-editor-background)' : laneColors[row.lane]} stroke=${laneColors[row.lane]} stroke-width="2"></circle>`;
					})}
				</svg>
				${rows.map(
					(row, i) =>
						html`<div
							class="graph-row ${dimMerges && row.merge ? 'graph-row--dimmed' : ''}"
							style=${cspStyleMap({ top: `${i * rowHeight}px` })}
						>
							${row.ref
								? html`<span
										class="graph-row__ref"
										style=${cspStyleMap({
											border: `var(--gl-border-width) solid color-mix(in srgb, ${laneColors[row.lane]} 60%, transparent)`,
											background: `color-mix(in srgb, ${laneColors[row.lane]} 16%, transparent)`,
											color: laneColors[row.lane],
										})}
										><code-icon icon=${row.refIcon} size="10" aria-hidden="true"></code-icon
										>${row.ref}</span
									>`
								: nothing}
							${avatars
								? html`<span class="avatar ${row.who === 'you' ? '' : 'avatar--other'}"></span>`
								: nothing}
							<span class="graph-row__message">${row.message}</span>
						</div>`,
				)}
			</div>
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
				${avatars
					? html`<span
							class="hover-card__avatar"
							style=${cspStyleMap({ width: `${avatarSize}px`, height: `${avatarSize}px` })}
						></span>`
					: nothing}
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
			${diff
				? html`<div class="hover-card__diff">
						<div class="diff-removed">- return code;</div>
						<div class="diff-added">+ return optimize(parse(code));</div>
					</div>`
				: nothing}
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSettingsPreview;
	}
}
