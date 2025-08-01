import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { focusableBaseStyles } from '../styles/lit/a11y.css';

@customElement('gl-dialog')
export class GlDialog extends LitElement {
	static override styles = [
		focusableBaseStyles,
		css`
			:host {
				display: contents;
			}

			::backdrop {
				background: rgba(0, 0, 0, 0.5);
			}

			dialog {
				padding: 2.4rem;
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 0.4rem;
				color: var(--vscode-foreground);
				box-shadow: 0 0.4rem 0.4rem 0 hsba(0, 0%, 0%, 0.25);
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	open = false;

	@property({ type: Boolean, reflect: true })
	modal = false;

	@property()
	closedby?: 'any' | 'closerequest' | 'none';

	@query('dialog')
	dialog!: HTMLDialogElement;

	protected override update(changedProperties: PropertyValues): void {
		super.update(changedProperties);

		if (changedProperties.has('open')) {
			this.toggleVisibility();
		}
	}

	override render() {
		return html`
			<dialog part="base">
				<slot></slot>
			</dialog>
		`;
	}

	private toggleVisibility() {
		if (this.open) {
			if (this.dialog.open) {
				return;
			}
			if (this.modal) {
				this.dialog.showModal();
			} else {
				this.dialog.show();
			}
		} else if (this.dialog.open) {
			this.close();
		}
	}

	close() {
		this.open = false;
	}

	show() {
		this.open = true;
	}
}
