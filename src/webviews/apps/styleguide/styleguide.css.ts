import { css } from 'lit';

// The styleguide dogfoods the new system: every value here is a --gl-* token.
export const styleguideStyles = css`
	:host {
		display: block;
		height: 100%;
		overflow: auto;
		color: var(--gl-color-fg);
		background: var(--gl-color-surface);
		font-family: var(--font-family);
		font-size: var(--gl-font-base);
	}

	* {
		box-sizing: border-box;
	}

	.probe {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: var(--gl-space-24) var(--gl-space-20) var(--gl-space-40);
	}

	.controlbar {
		position: sticky;
		top: 0;
		z-index: var(--gl-z-sticky);
		display: flex;
		gap: var(--gl-space-12);
		align-items: center;
		justify-content: space-between;
		padding: var(--gl-space-10) var(--gl-space-12);
		margin-bottom: var(--gl-space-20);
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

	h1 {
		margin: 0 0 var(--gl-space-4);
		font-size: 2rem;
		font-weight: 600;
	}
	.subtitle {
		margin: 0 0 var(--gl-space-24);
		color: var(--gl-color-fg-muted);
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
		width: 2.8rem;
		height: 2.8rem;
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-sm);
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
		border-radius: var(--gl-radius-xs);
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
	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--gl-space-10);
	}
	.gallery-card {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		justify-content: space-between;
		padding: var(--gl-space-10) var(--gl-space-12);
		background: var(--gl-color-surface-raised);
		border: var(--gl-border-width) solid var(--gl-color-border);
		border-radius: var(--gl-radius-md);
	}
	.gallery-card__name {
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: var(--gl-font-md);
	}

	.pill {
		padding: var(--gl-space-2) var(--gl-space-8);
		font-size: var(--gl-font-micro);
		white-space: nowrap;
		border-radius: var(--gl-radius-circle);
	}
	.pill--new-tokens {
		color: var(--gl-color-success);
		background: color-mix(in srgb, var(--gl-color-success) 16%, var(--gl-color-surface));
	}
	.pill--mixed {
		color: var(--gl-color-warning);
		background: var(--gl-color-warning-bg);
	}
	.pill--vscode-direct {
		color: var(--gl-color-info);
		background: var(--gl-color-info-bg);
	}
	.pill--legacy {
		color: var(--gl-color-fg-muted);
		background: var(--gl-color-neutral-bg);
	}
	.pill--hardcoded {
		color: var(--gl-color-danger);
		background: var(--gl-color-danger-bg);
	}
	.pill--none {
		color: var(--gl-color-fg-faint);
		background: var(--gl-color-neutral-bg);
	}

	.scoreboard {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
		gap: var(--gl-space-10);
	}
	.metric {
		padding: var(--gl-space-12);
		background: var(--gl-color-surface-raised);
		border-radius: var(--gl-radius-md);
	}
	.metric__n {
		font-size: 2.2rem;
		font-weight: 600;
	}
	.metric__l {
		margin-top: var(--gl-space-2);
		font-size: var(--gl-font-sm);
		color: var(--gl-color-fg-muted);
	}
`;
