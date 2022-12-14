import { css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<MenuDivider>``;

const styles = css`
	${elementBase}

	:host {
		display: block;
		height: 0;
		margin: 0.6rem;
		border-top: 0.1rem solid var(--vscode-menu-separatorBackground);
	}
`;

@customElement({ name: 'menu-divider', template: template, styles: styles })
export class MenuDivider extends FASTElement {}
