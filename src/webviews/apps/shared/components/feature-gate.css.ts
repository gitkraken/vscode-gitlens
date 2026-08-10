import { css, unsafeCSS } from 'lit';

/* The single threshold (both axes) below which the gate switches to its compact look. Shared as a
   constant because the width- and height-compact rules span this file and
   feature-gate-plus-state.ts, and @container conditions can't read custom properties. */
export const featureGateCompactThreshold = unsafeCSS('66rem');

/* The width at/above which the feature list shows two comfortable ~33rem columns of static expanded
   rows; below it the list snaps straight to the single-column accordion. Deliberately its own value
   (not featureGateCompactThreshold): this is a list-layout decision, not the gate's compact mode, and
   it must line up with where two columns actually fit so there is never a single-column-expanded
   in-between. */
const featureGateListColumnsThreshold = unsafeCSS('72rem');

export const featureGateBaseStyles = css`
	:host {
		--gate-background: var(--vscode-editorWidget-background);
		--gate-foreground: var(--vscode-editorWidget-foreground);
		--gate-border: var(--vscode-editorWidget-border);
		--gate-border-size: 0.2rem;

		position: absolute;
		inset: 0;
		box-sizing: border-box;

		/* Size container for the gate's narrow-width and short-height adaptations. Safe because the
		   host is an inset-0 overlay, so its size never depends on its contents. The top-layer
		   dialog still resolves against this container via its flat-tree ancestry. */
		container-type: size;
	}

	::slotted(p) {
		margin: revert !important;
	}

	::slotted(p:first-child) {
		margin-top: 0 !important;
	}

	/* The gate renders as a native modal <dialog> promoted to the top layer (via showModal),
			   so it covers the entire webview viewport. These rules reset the UA dialog styles. */
	dialog {
		--section-foreground: var(--gate-foreground);
		--section-background: var(--gate-background);
		--section-border-color: var(--gate-border);

		--link-foreground: var(--vscode-textLink-foreground);
		--link-foreground-active: var(--vscode-textLink-activeForeground);

		position: fixed;
		inset: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: none;
		height: 100%;
		max-height: none;
		padding: var(--gl-space-24) 0;
		margin: 0;
		overflow: hidden;
		color: var(--section-foreground);
		background:
			linear-gradient(var(--section-background), var(--section-background)) padding-box,
			var(--gl-gradient-brand) border-box;

		/* Gradient border that follows border-radius (border-image ignores radius): a transparent
		   real border, a solid fill clipped to padding-box, and the brand gradient clipped to
		   border-box so it only shows through the border ring. */
		border: var(--gate-border-size) solid transparent;
		border-radius: var(--gl-radius-xl);
		box-shadow: 0 0 0 1px var(--section-border-color);
	}

	/* Background-painted borders are dropped in forced-colors mode — restore a solid border. */
	@media (forced-colors: active) {
		dialog {
			border-color: var(--section-border-color);
		}
	}

	dialog::backdrop {
		background: transparent;
		backdrop-filter: blur(3px) saturate(0.8);
	}

	.content {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		padding-inline: var(--gl-space-24);
		overflow: auto;
	}

	@container (max-width: ${featureGateCompactThreshold}) {
		.content {
			padding-inline: var(--gl-space-12);
		}
	}

	:host-context(body[data-placement='editor']) dialog,
	:host([appearance='alert']) dialog {
		--link-decoration-default: underline;
		--link-foreground: color-mix(in srgb, var(--section-foreground) 50%, var(--vscode-textLink-foreground));
		--link-foreground-active: color-mix(
			in srgb,
			var(--section-foreground) 50%,
			var(--vscode-textLink-activeForeground)
		);

		inset: 0;
		width: max-content;
		max-width: 60rem;
		height: max-content;
		max-height: calc(100% - 0.4rem);
		margin: auto;
	}

	:host-context(body[data-placement='editor']) .content ::slotted(gl-button),
	:host([appearance='alert']) .content ::slotted(gl-button) {
		display: block;
		margin-inline: auto;
	}

	.switch-actions {
		position: absolute;
		top: 0.1rem;
		right: 0.6rem;
		z-index: 1;

		gl-button:not(:hover, :focus-within) {
			opacity: 0.6;
		}
	}

	:host([variant='sheet']) .sheet {
		--section-foreground: var(--vscode-foreground);
		--section-background: var(--vscode-editor-background);
		--section-border-color: var(--gate-border);

		--link-foreground: var(--vscode-textLink-foreground);
		--link-foreground-active: var(--vscode-textLink-activeForeground);

		position: absolute;
		inset: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
		color: var(--section-foreground);
		background: var(--vscode-editor-background);
	}

	:host([variant='sheet']) .content {
		inline-size: 100%;
		max-width: 90rem;
		padding-block: var(--gl-space-24);
		margin-inline: auto;
	}
`;

export const featureGateContentStyles = css`
	.icon-cube {
		--icon-color: var(--vscode-textLink-foreground);
		--icon-background: color-mix(in srgb, var(--icon-color) 10%, transparent);
		--icon-size: 1.4em;

		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: calc(var(--icon-size) * 1.6);
		aspect-ratio: 1;
		background: var(--icon-background);
		border-radius: var(--gl-radius-md);

		code-icon {
			font-size: var(--icon-size);
			color: var(--icon-color);
		}
	}

	.feature {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-10);
		margin-block-end: var(--gl-space-12);
		line-height: 1.5;
		color: var(--color-foreground--65);
	}

	.feature__header {
		display: flex;
		flex-direction: row;
		gap: var(--gl-space-12);
		align-items: flex-start;
	}

	.feature__feature-icon {
		/* Fixed light glyph: the brand gradient is dark in every theme, so a theme-driven foreground
		   (near-black on light themes) would fail contrast against it. */
		--icon-color: #fff;
		--icon-background: var(--gl-gradient-brand);
	}

	gitlens-logo-circle.feature__feature-icon {
		flex: none;
		width: 3.2rem;
		height: 3.2rem;
		/* The logo renders a fixed 46px SVG; scale it from the top-left to fill the box. */
		transform: scale(calc(32 / 46));
		transform-origin: top left;
	}

	.feature__title {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-6);
		align-items: baseline;
		margin: 0;
		font-size: 1.6rem;
		font-weight: 600;
		line-height: 1.2;
		color: var(--color-foreground);
	}

	@container (max-width: ${featureGateCompactThreshold}) {
		.feature__title {
			font-size: var(--gl-font-lg);
		}
	}

	.feature__title gl-feature-badge {
		margin: 0;
		transform: translateY(-0.4rem);
	}

	.feature__lede {
		margin: 0;
	}

	.feature__sub {
		margin: 0;
		font-size: var(--gl-font-md);
	}

	.list {
		display: grid;
		/* Single column by default; the list snaps to two columns only once it's wide enough for them
		   (see the min-width container query below). There is deliberately no single-column-expanded
		   state in between — narrow snaps straight to the accordion. */
		grid-template-columns: 1fr;
		gap: var(--gl-space-4);
		padding-inline-start: 0;
		margin-block: var(--gl-space-6);
		margin-inline: 0;
		list-style: none;
	}

	/* Default (narrow) layout: each <details> is a real collapsible accordion row with a clickable
	   summary and a chevron. Closed rows hide their content natively via ::details-content; the wide
	   layout below force-reveals it and neuters the summary into a static row. */
	.list__item {
		display: block;
		padding-block: var(--gl-space-6);
	}

	.list__summary {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		cursor: pointer;
		list-style: none;
	}

	.list__summary::-webkit-details-marker,
	.list__summary::marker {
		display: none;
	}

	.list__chevron {
		display: inline-flex;
		flex: none;
		margin-inline-start: auto;
		color: var(--vscode-descriptionForeground);
		transition: transform var(--gl-duration-fast) var(--gl-ease-out);
	}

	.list__item[open] .list__chevron {
		transform: rotate(90deg);
	}

	.list__copy {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-2);
		padding-inline: var(--gl-space-6);
		margin-block-start: var(--gl-space-6);
		font-size: var(--gl-font-sm);
		text-wrap: pretty;
	}

	.list__summary strong,
	.list__copy strong {
		font-size: var(--gl-font-md);
		color: var(--color-foreground);
	}

	/* Wide layout: two comfortable ~33rem columns, and each <details> reads as a static expanded row
	   rather than an accordion — the summary is blockified and neutered (non-interactive), the chevron
	   is hidden, and ::details-content is force-revealed (Chromium hides a closed details' content
	   wrapper; overriding its content-visibility is the only way to reveal it from CSS). Below this
	   threshold the list snaps back to the single-column accordion — there is no in-between. */
	@container (min-width: ${featureGateListColumnsThreshold}) {
		.list {
			grid-template-columns: 1fr 1fr;
			gap: var(--gl-space-16);
		}

		.list__item {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			padding-block: 0;
		}

		.list__summary {
			pointer-events: none;
			cursor: default;
		}

		.list__item::details-content {
			content-visibility: visible;
		}

		.list__chevron {
			display: none;
		}

		.list__copy {
			padding-inline: 0;
			padding-inline-start: var(--gl-space-36);
			margin-block-start: 0;
		}
	}
`;
