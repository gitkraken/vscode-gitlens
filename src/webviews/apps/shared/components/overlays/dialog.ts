import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { focusableBaseStyles } from '../styles/lit/a11y.css';

// #0000004d - light

@customElement('gl-dialog')
export class GlDialog extends LitElement {
	static override styles = [
		focusableBaseStyles,
		css`
			:host {
				display: contents;
			}

			dialog::backdrop {
				background-color: #0000004d;
				backdrop-filter: blur(0.4rem);
			}

			dialog {
				padding: 2rem;
				background: var(--vscode-editorWidget-background);
				border: 0.1rem solid var(--vscode-widget-border);
				border-radius: 0.3rem;
				color: var(--vscode-editorWidget-foreground);
				box-shadow: 0 0 0.8rem 0 var(--vscode-widget-shadow);
				width: min-content;
				min-width: 40rem;
				max-width: 50rem;
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
			this.dialog.close();
		}
	}

	close() {
		this.open = false;
	}

	show() {
		this.open = true;
	}
}
