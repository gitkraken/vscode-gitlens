import { css } from 'lit';
import { elevatedSurface } from '../shared/components/styles/lit/elevation.css.js';

// The styleguide dogfoods the new system: every value here is a --gl-* token.
export const styleguideStyles = css`
	:host {
		display: block;
		font-family: var(--font-family);
		font-size: var(--gl-font-base);
		color: var(--gl-color-fg);
		background: var(--gl-color-surface);
	}

	.probe {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	.page {
		display: flex;
		flex-direction: column;
		max-height: 100svh;
	}

	.page__region {
		max-width: 1080px;
		margin-inline: auto;
	}

	.page__header {
		display: grid;
		flex: none;
		grid-template-columns: 1fr auto;
		gap: var(--gl-space-20);
		padding: var(--gl-space-20) var(--gl-space-20) 0;
		background-color: var(--gl-color-surface);
	}

	.controlbar {
		display: flex;
		gap: var(--gl-space-12);
		align-items: center;
		justify-content: space-between;
		padding: var(--gl-space-4) var(--gl-space-8);
		background: var(--gl-color-surface-raised);
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-md);
	}

	.scheme-chip {
		display: inline-flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-8);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-info);
		background: var(--gl-color-info-bg);
		border-radius: var(--gl-radius-circle);
	}

	.scheme-chip--hc {
		color: var(--gl-color-warning);
		background: var(--gl-color-warning-bg);
	}

	/* Snug the theme-picker action against the scheme-chip so they read as one control */
	.scheme-action {
		margin-inline-start: calc(-1 * var(--gl-space-6));
	}

	.controlbar--sticky {
		position: sticky;
		/* Negative offset lets the bar ride up into the content's top padding before pinning near the tab bar */
		top: calc(-1 * var(--gl-space-20));
		z-index: var(--gl-z-sticky);
		justify-content: flex-start;
		margin-block-end: var(--gl-space-16);
	}

	.toggle {
		display: inline-flex;
		gap: var(--gl-space-8);
		align-items: center;
		font-size: var(--gl-font-md);
		color: var(--gl-color-fg-muted);
		cursor: pointer;
		user-select: none;
	}

	.toggle input {
		accent-color: var(--gl-color-accent);
	}

	.page__header h1 {
		margin: 0 0 var(--gl-space-4);
		font-size: 2rem;
		font-weight: 600;
	}

	.subtitle {
		margin: 0;
		color: var(--gl-color-fg-muted);
	}

	.page__content {
		flex: 1;
		padding: var(--gl-space-24) var(--gl-space-20) var(--gl-space-40);
		overflow: hidden auto;
	}

	section {
		margin-bottom: var(--gl-space-32);
	}

	.section-title {
		margin: 0 0 var(--gl-space-4);
		font-size: var(--gl-font-lg);
		font-weight: 600;
	}

	.section-note {
		margin: 0 0 var(--gl-space-12);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.audit-banner {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-8) var(--gl-space-12);
		margin-bottom: var(--gl-space-16);
		font-size: var(--gl-font-md);
		color: var(--gl-color-danger);
		background: var(--gl-color-danger-bg);
		border: var(--gl-border-width) solid var(--gl-color-danger-border);
		border-radius: var(--gl-radius-sm);
	}

	.audit-banner--ok {
		color: var(--gl-color-success);
		background: color-mix(in srgb, var(--gl-color-success) 14%, var(--gl-color-surface));
		border-color: color-mix(in srgb, var(--gl-color-success) 45%, var(--gl-color-surface));
	}

	.swatch-row {
		display: grid;
		grid-template-columns: 2.8rem minmax(0, 1.4fr) minmax(0, 1.2fr) auto;
		gap: var(--gl-space-12);
		align-items: center;
		padding: var(--gl-space-8) var(--gl-space-4);
		border-bottom: var(--gl-border-width) solid var(--gl-color-border);
	}

	.swatch {
		--swatch-color: transparent;
		--swatch-checker-1: #fff;
		--swatch-checker-2: #000;
		--swatch-checker-size: 0.64rem;

		position: relative;
		width: 2.8rem;
		height: 2.8rem;
		overflow: hidden;
		background-image:
			linear-gradient(45deg, var(--swatch-checker-2) 25%, transparent 25%),
			linear-gradient(-45deg, var(--swatch-checker-2) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--swatch-checker-2) 75%),
			linear-gradient(-45deg, transparent 75%, var(--swatch-checker-2) 75%);
		background-position:
			0 0,
			0 var(--swatch-checker-size),
			var(--swatch-checker-size) calc(-1 * var(--swatch-checker-size)),
			calc(-1 * var(--swatch-checker-size)) 0;
		background-clip: padding-box;
		background-size: calc(var(--swatch-checker-size) * 2) calc(var(--swatch-checker-size) * 2);
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-sm);
	}

	.swatch::after {
		position: absolute;
		inset: 0;
		display: block;
		content: '';
		background: var(--swatch-color);
		border-radius: var(--gl-radius-sm);
	}

	.tokens--no-checker .swatch {
		background-image: none;
	}

	/* ── Ramp strip ───────────────────────────────────────────────────────── */
	/* Contiguous chips inside one bordered wrapper — the low stops are near-invisible against the
	   page surface without it. Labels are a parallel flex row so columns stay aligned. */
	.ramp-strip {
		display: flex;
		overflow: hidden;
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-sm);
	}

	.ramp-chip {
		flex: 1;
		height: 2.8rem;
		background: var(--swatch-color, transparent);
	}

	.ramp-labels {
		display: flex;
		margin-top: var(--gl-space-4);
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.ramp-labels span {
		flex: 1;
		text-align: center;
	}

	.token-name {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-md);
	}

	.token-derivation {
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-faint);
	}

	.token-value {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.badge {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-8);
		font-size: var(--gl-font-sm);
		white-space: nowrap;
		border-radius: var(--gl-radius-circle);
	}

	.badge--pass {
		color: var(--gl-color-success);
		background: color-mix(in srgb, var(--gl-color-success) 16%, var(--gl-color-surface));
	}

	.badge--fail {
		color: var(--gl-color-danger);
		background: var(--gl-color-danger-bg);
	}

	.scale-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-12);
	}

	.scale-item {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		align-items: flex-start;
		min-width: 7rem;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}

	.scale-box {
		background: var(--gl-color-accent);
	}
	/* Fixed dims via class; dynamic radius/width/font-size/shadow applied via CSSOM in updated() */
	.scale-radius {
		width: 4rem;
		height: 2.4rem;
	}

	.scale-space {
		height: 1.6rem;
	}

	.scale-shadow {
		width: 4rem;
		height: 2.4rem;
		background: var(--gl-color-surface-raised);
		border-radius: var(--gl-radius-sm);
	}

	.gallery-group {
		margin-bottom: var(--gl-space-16);
	}

	.gallery-group-title {
		margin: 0 0 var(--gl-space-8);
		font-size: var(--gl-font-md);
		font-weight: 600;
		color: var(--gl-color-fg-muted);
	}

	.tabs {
		display: flex;
		grid-column: 1 / -1;
		gap: var(--gl-space-4);
		border-bottom: var(--gl-border-width) solid var(--gl-color-border);
	}

	.tab {
		padding: var(--gl-space-8) var(--gl-space-16);
		margin-bottom: calc(-1 * var(--gl-border-width));
		font-family: inherit;
		font-size: var(--gl-font-base);
		color: var(--gl-color-fg-muted);
		cursor: pointer;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
	}

	.tab:hover {
		color: var(--gl-color-fg);
	}

	.tab--active {
		color: var(--gl-color-fg);
		border-bottom-color: var(--gl-color-accent);
	}

	.demo-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: var(--gl-space-12);
	}

	.demo {
		display: flex;
		flex-direction: column;
	}

	.demo__stage {
		position: relative; /* contain absolutely-positioned demo components (e.g. progress-indicator) so they don't escape the app's scroll and add a second scrollbar */
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-8);
		align-items: center;
		min-height: 5.6rem;
		padding-block: var(--gl-space-16);
	}

	.demo__label {
		padding-block: var(--gl-space-4);
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}
	/* Full-width block components (banner, progress, skeleton) — span the grid + don't flex-squish */
	.demo--block {
		grid-column: 1 / -1;
	}

	.demo--block .demo__stage {
		display: block;
		overflow: hidden; /* clip the progress-indicator's translateX animation to its card */
	}

	.undemoed {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-8);
	}

	.undemoed__item {
		padding: var(--gl-space-4) var(--gl-space-10);
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-faint);
		background: var(--gl-color-neutral-bg);
		border-radius: var(--gl-radius-sm);
	}

	/* ── Z-index diagonal stack ───────────────────────────────────────────── */

	.zstack {
		position: relative;
		height: 12rem;
		isolation: isolate;
	}

	.zstack-box {
		--gl-elevation: var(--gl-shadow-raised);
		--gl-elevation-border-color: var(--gl-color-border);

		position: absolute;
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		width: 9rem;
		height: 4.4rem;
		padding: var(--gl-space-8) var(--gl-space-10);
		background: var(--gl-color-surface-raised);
		border-radius: var(--gl-radius-md);
		${elevatedSurface}
		/* translate applied via CSSOM: calc(var(--gl-stack-i) * 2.4rem) calc(var(--gl-stack-i) * 1.5rem) */
		translate: calc(var(--gl-stack-i, 0) * 2.4rem) calc(var(--gl-stack-i, 0) * 1.5rem);
	}

	.zstack-name {
		font-size: var(--gl-font-md);
		font-weight: 600;
		color: var(--gl-color-fg);
	}

	/* ── Duration bars ────────────────────────────────────────────────────── */

	@keyframes gl-duration-demo {
		0% {
			transform: scaleX(0);
		}

		66% {
			transform: scaleX(1);
		}

		100% {
			transform: scaleX(1);
		}
	}

	.duration-scale {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
	}

	.duration-row {
		display: flex;
		gap: var(--gl-space-12);
		align-items: center;
	}

	.duration-label {
		flex-shrink: 0;
		width: 22rem;
	}

	.duration-track {
		flex: 1;
		height: 0.8rem;
		overflow: hidden;
		background: var(--gl-color-surface-sunken);
		border-radius: var(--gl-radius-sm);
	}

	.duration-fill {
		width: 100%;
		height: 100%;
		background: var(--gl-color-accent);
		transform: scaleX(0);
		transform-origin: left center;
		/* animation-duration applied via CSSOM in updated() */
		animation-name: gl-duration-demo;
		animation-timing-function: var(--gl-ease-out);
		animation-iteration-count: infinite;
		animation-fill-mode: both;
	}

	@media (prefers-reduced-motion: reduce) {
		.duration-fill {
			transform: scaleX(1);
			animation: none;
		}
	}

	/* ── Font baseline row ────────────────────────────────────────────────── */

	.font-samples {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-16);
		align-items: baseline;
	}

	.font-sample {
		display: inline-flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		align-items: center;
	}

	.font-aa {
		line-height: 1;
		/* font-size applied via CSSOM in updated() via [data-fs] */
	}

	/* ── Components tab: jump-nav ─────────────────────────────────────────── */

	section[id] {
		scroll-margin-block-start: 5.6rem;
	}

	.jumpnav {
		position: sticky;
		top: 0;
		z-index: var(--gl-z-sticky);
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		margin-bottom: var(--gl-space-24);
	}

	.jumpnav__link {
		padding: var(--gl-space-4) var(--gl-space-12);
		font-family: inherit;
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
		cursor: pointer;
		background: var(--gl-color-neutral-bg);
		border: none;
		border-radius: var(--gl-radius-circle);
	}

	.jumpnav__link:hover {
		color: var(--gl-color-fg);
		background: var(--gl-color-surface-hover);
	}

	.jumpnav__link:focus-visible {
		outline: var(--gl-border-width) solid var(--gl-color-border-focus);
		outline-offset: 2px;
	}

	/* ── Components tab: demo cell layout variants ───────────────────────── */

	.demo--wide {
		grid-column: span 2;
	}

	/* Matches .demo--block .demo__stage's specificity (2 classes) so stack/tall demos — which also
	   carry demo--block for the full-width grid span — aren't overridden back to display:block. */
	.demo__stage.demo__stage--stack {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		align-items: stretch;
	}

	.demo__stage.demo__stage--tall {
		display: block;
		block-size: 28rem;
	}

	.demo__note {
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-faint);
	}

	/* Bounded-width wrapper so truncation demos actually ellipsize (and can't overflow the page) */
	.demo-narrow {
		display: flex;
		inline-size: 20rem;
		max-inline-size: 100%;
	}

	.demo-narrow > * {
		min-inline-size: 0;
		max-inline-size: 100%;
	}

	.components {
		display: flex;
		flex-direction: row;
		gap: var(--gl-space-20);
	}

	.components__nav {
		flex: none;
		max-width: 16rem;
	}

	.components__content {
		flex: 1;
	}

	/* ── Elements tab ─────────────────────────────────────────────────────── */
	/* Faithful mirror of VS Code's webview default stylesheet (@layer vscode-default, injected
	   by vscode/src/vs/workbench/contrib/webview/browser/pre/index.html). Those rules are
	   document-level and don't pierce this app's shadow root, so without this mirror the raw
	   elements below would render with bare browser defaults. Scoped to .elements; keep in
	   sync with upstream. */

	.elements {
		max-width: 72rem;
	}

	.elements :is(img, video) {
		max-width: 100%;
		max-height: 100%;
	}

	/* Demo scaffolding (not part of the VS Code mirror) */

	.element-stack {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-12);
		align-items: flex-start;
	}

	.scroll-demo {
		max-block-size: 12rem;
		padding-inline: var(--gl-space-12);
		overflow: auto;
		scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background);
		border: var(--gl-border-width) solid var(--gl-color-border-subtle);
	}

	.scroll-demo::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}

	.scroll-demo::-webkit-scrollbar-corner {
		background-color: var(--vscode-editor-background);
	}

	.scroll-demo::-webkit-scrollbar-thumb {
		background-color: var(--vscode-scrollbarSlider-background);
	}

	.scroll-demo::-webkit-scrollbar-thumb:hover {
		background-color: var(--vscode-scrollbarSlider-hoverBackground);
	}

	.scroll-demo::-webkit-scrollbar-thumb:active {
		background-color: var(--vscode-scrollbarSlider-activeBackground);
	}
`;

export const elementBoxStyles = css`
	:where(*, *::before, *::after) {
		box-sizing: border-box;
	}
`;

export const elementLinkStyles = css`
	/* Links */

	:where(a, a code) {
		color: var(--vscode-textLink-foreground);
	}

	:where(p > a) {
		text-decoration: var(--text-link-decoration, underline);
	}

	:where(a:hover) {
		color: var(--vscode-textLink-activeForeground);
	}

	:where(a:focus-visible) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
`;

export const elementCodeKeyboardStyles = css`
	:where(code) {
		padding: 1px 3px;
		font-family: var(--monaco-monospace-font, var(--vscode-editor-font-family, monospace));
		color: var(--vscode-textPreformat-foreground);
		background-color: var(--vscode-textPreformat-background);
		border-radius: 4px;
	}

	:where(pre code) {
		padding: 0;
	}

	:where(kbd) {
		padding: 1px 3px;
		vertical-align: middle;
		color: var(--vscode-keybindingLabel-foreground);
		background-color: var(--vscode-keybindingLabel-background);
		border-color: var(--vscode-keybindingLabel-border);
		border-style: solid;
		border-width: 1px;
		border-bottom-color: var(--vscode-keybindingLabel-bottomBorder);
		border-radius: 3px;
		box-shadow: inset 0 -1px 0 var(--vscode-widget-shadow);
	}
`;

export const elementQuoteStyles = css`
	:where(blockquote) {
		background: var(--vscode-textBlockQuote-background);
		border-color: var(--vscode-textBlockQuote-border);
	}
`;

export const elementFormStyles = css`
	:where(input:focus, select:focus, textarea:focus) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
`;

export const elementStyles = [
	elementBoxStyles,
	elementLinkStyles,
	elementCodeKeyboardStyles,
	elementQuoteStyles,
	elementFormStyles,
];
