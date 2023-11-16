import { defineGkElement, Dialog } from '@gitkraken/shared-web-components';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../code-icon';

@customElement('gl-dialog')
export class GlDialog extends LitElement {
	static override styles = [
		css`
			:host {
				display: contents;
			}

			gk-dialog::part(base) {
				--gk-dialog-width: 60rem;
				--gk-dialog-background-color: var(--vscode-editorWidget-background);
				--gk-dialog-font-color: var(--vscode-editorWidget-foreground);
				z-index: 1000;
			}

			gk-dialog::part(body) {
				padding-top: 0;
			}

			.dialog {
				display: flex;
				flex-direction: row;
				align-items: flex-start;
				gap: 0 2.4rem;
			}

			:host([type='info']) .icon {
				color: var(--vscode-problemsInfoIcon-foreground);
			}

			:host([type='warning']) .icon {
				color: var(--vscode-problemsWarningIcon-foreground);
			}

			:host([type='error']) .icon {
				color: var(--vscode-problemsErrorIcon-foreground);
			}

			.content {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.header {
				font-size: 1.8rem;
			}
		`,
	];

	@property()
	icon?: string = 'info';

	@property({ type: Boolean, reflect: true })
	modal: boolean = false;

	@property({ reflect: true })
	type: 'info' | 'warning' | 'error' = 'info';

	@query('gk-dialog')
	dialogEl!: Dialog;

	public open() {
		this.dialogEl.open();
	}

	public close() {
		this.dialogEl.close();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		defineGkElement(Dialog);
	}
	override render() {
		return html`<gk-dialog .modal=${this.modal}>
			<div class="dialog">
				${when(
					this.icon != null,
					() => html`<div class="icon"><code-icon size="48" icon="${this.icon}"></code-icon></div>`,
				)}
				<div class="content">
					<slot class="header" name="header"></slot>
					<slot class="body"></slot>
				</div>
			</div>
		</gk-dialog>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-dialog': GlDialog;
	}
}
