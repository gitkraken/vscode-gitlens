import { css } from 'lit';

export const featureGateBaseStyles = css`
	:host {
		--gate-background: var(--vscode-editorWidget-background);
		--gate-foreground: var(--vscode-editorWidget-foreground);
		--gate-border: var(--vscode-editorWidget-border);
		--gate-border-size: 0.2rem;

		position: absolute;
		inset: 0;

		box-sizing: border-box;
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
		width: 100%;
		max-width: none;
		height: 100%;
		max-height: none;
		margin: 0;
		padding: 2.4rem 0;

		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		overflow: hidden;

		color: var(--section-foreground);
		/* Gradient border that follows border-radius (border-image ignores radius): a transparent
		   real border, a solid fill clipped to padding-box, and the brand gradient clipped to
		   border-box so it only shows through the border ring. */
		border: var(--gate-border-size) solid transparent;
		border-radius: 1.2rem;
		background:
			linear-gradient(var(--section-background), var(--section-background)) padding-box,
			var(--gl-gradient-brand) border-box;

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
		padding-inline: 2.4rem;
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;

		display: flex;
		flex-direction: column;
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
		max-width: 600px;
		height: max-content;
		max-height: calc(100% - 0.4rem);
		margin: auto;
	}

	:host-context(body[data-placement='editor']) .content ::slotted(gl-button),
	:host([appearance='alert']) .content ::slotted(gl-button) {
		display: block;
		margin-left: auto;
		margin-right: auto;
	}

	.switch-repos {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		z-index: 1;

		opacity: 0.6;
	}

	.switch-repos:hover,
	.switch-repos:focus-within {
		opacity: 1;
	}
`;

export const featureGateContentStyles = css`
	.icon-cube {
		--icon-color: var(--vscode-textLink-foreground);
		--icon-background: color-mix(in srgb, var(--icon-color) 10%, transparent);
		--icon-size: 1.4em;

		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: calc(var(--icon-size) * 1.6);
		aspect-ratio: 1;
		background: var(--icon-background);
		border-radius: 0.6rem;

		code-icon {
			font-size: var(--icon-size);
			color: var(--icon-color);
		}
	}

	.feature {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-block-end: 1.2rem;
		line-height: 1.5;
		color: var(--color-foreground--65);
	}

	.feature__header {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 1.2rem;
	}

	.feature__feature-icon {
		/* Fixed light glyph: the brand gradient is dark in every theme, so a theme-driven foreground
		   (near-black on light themes) would fail contrast against it. */
		--icon-color: #fff;
		--icon-background: var(--gl-gradient-brand);
	}

	.feature__title {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0;
		font-size: 1.6rem;
		font-weight: 600;
		line-height: 1.2;
		color: var(--color-foreground);
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
		font-size: 1.2rem;
	}

	.list {
		list-style: none;
		margin-block: 0.6rem;
		margin-inline: 0;
		padding-inline-start: 0;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.6rem;
	}

	.list__item {
		display: flex;
		align-items: flex-start;
		gap: 1.2rem;
	}

	.list__copy {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 1.1rem;
		text-wrap: pretty;

		strong {
			font-size: 1.2rem;
			color: var(--color-foreground);
		}
	}
`;
