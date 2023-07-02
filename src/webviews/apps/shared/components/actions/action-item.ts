import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';

const template = html<ActionItem>`<a
	role="${x => (!x.href ? 'button' : null)}"
	type="${x => (!x.href ? 'button' : null)}"
	aria-label="${x => x.label}"
	title="${x => x.label}"
	><code-icon icon="${x => x.icon}"></code-icon
></a>`;

const styles = css`
	:host {
		box-sizing: border-box;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		color: inherit;
		padding: 0.2rem;
		vertical-align: text-bottom;
		text-decoration: none;
		cursor: pointer;
	}
	:host(:focus) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	:host(:hover) {
		background-color: var(--vscode-toolbar-hoverBackground);
	}
	:host(:active) {
		background-color: var(--vscode-toolbar-activeBackground);
	}
`;

@customElement({ name: 'action-item', template: template, styles: styles })
export class ActionItem extends FASTElement {
	@attr
	href?: string;

	@attr
	label: string = '';

	@attr
	icon: string = '';
}
