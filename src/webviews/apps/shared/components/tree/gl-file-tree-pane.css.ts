import { css } from 'lit';

export const fileTreeStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	webview-pane {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	webview-pane[flexible] {
		overflow: hidden;
	}

	gl-tree-view {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		margin-top: var(--gl-tree-view-margin-top, 0);
	}
	gl-tree-view[filterable] {
		margin-top: var(--gl-tree-view-filterable-margin-top, var(--gl-tree-view-margin-top, 0));
	}

	webview-pane [slot='title'] {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	webview-pane::part(header) {
		border-top: none;
		background-color: inherit;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		margin-left: 1rem;
	}

	.leading-actions::slotted(*) {
		margin-right: 0.2rem;
	}

	gl-badge {
		font-size: var(--gl-font-micro);
	}

	gl-badge::part(base) {
		background-color: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		border: none;
		font-variant: normal;
		font-weight: 500;
		line-height: 1;
		min-width: 1.6rem;
		justify-content: center;
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
	}

	.checkbox-header {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 5px 0 5px 2px; /* prevent focus ring from clipping */
	}

	.checkbox-header gl-checkbox {
		--checkbox-foreground: var(--vscode-sideBarSectionHeader-foreground);
		--checkbox-size: 1.6rem;
		--checkbox-spacing: 0;
		--checkbox-radius: 0.3rem;
		--code-icon-size: 14px;
		margin-block: 0;
	}

	.checkbox-header__label {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--vscode-sideBarSectionHeader-foreground);
	}

	action-item.active-toggle {
		color: var(--vscode-inputOption-activeForeground);
		background-color: var(--vscode-inputOption-activeBackground);
		border-radius: 0.3rem;
	}

	/* Filter-mode-mixed: left half shows the filled funnel (icon: 'filter-filled'),
	   right half shows the outline funnel (outline-icon: 'filter') — a visual cue that
	   matches are highlighted, not filtered. Both glyphs share the same outer path so
	   the edges align perfectly at the 50% split. */
	action-item.filter-mode-mixed::part(icon) {
		-webkit-mask-image: linear-gradient(to right, #000 50%, transparent 50%);
		mask-image: linear-gradient(to right, #000 50%, transparent 50%);
	}

	action-item.filter-mode-mixed::part(icon-outline) {
		display: inline-flex;
		-webkit-mask-image: linear-gradient(to right, transparent 50%, #000 50%);
		mask-image: linear-gradient(to right, transparent 50%, #000 50%);
	}
`;
