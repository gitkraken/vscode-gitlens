import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { State } from '../../../home/protocol.js';
import { TogglePreviewEnabledCommand } from '../../../home/protocol.js';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css.js';
import { linkBase } from '../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { HostIpc } from '../../shared/ipc.js';
import { stateContext } from '../context.js';
import '../../shared/components/button-container.js';
import '../../shared/components/overlays/tooltip.js';

export const previewBannerTagName = 'gl-preview-banner';

@customElement(previewBannerTagName)
export class GlPreviewBanner extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		linkBase,
		css`
			.text-button {
				padding: 0.4rem 0.8rem;
			}

			.text-button {
				appearance: none;
				background: none;
				border: none;
				color: inherit;
				text-align: end;
				cursor: pointer;
				width: 100%;
			}
			.text-button:hover,
			.text-button:focus-within {
				background-color: var(--gl-card-background);
			}
			.text-button:focus-visible {
				${focusOutline}
			}

			p {
				margin-block: 0;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume<HostIpc>({ context: ipcContext, subscribe: true })
	@state()
	private _ipc!: HostIpc;

	@query('button')
	private _button!: HTMLButtonElement;

	override render(): unknown {
		if (this._state.previewEnabled !== true) {
			return html`
				<gl-tooltip placement="bottom">
					<button class="text-button text-button--end" @click=${() => this.togglePreview()}>
						New Home View <code-icon icon="arrow-right"></code-icon>
					</button>
					<p slot="content">
						<strong>Switch to the new Home View!</strong><br />
						We've reimagined GitLens' Home to be a more helpful daily workflow tool. We're continuing to
						refine this experience and welcome your feedback.
					</p>
				</gl-tooltip>
			`;
		}

		return nothing;
	}

	private togglePreview() {
		this._ipc.sendCommand(TogglePreviewEnabledCommand);
	}

	override focus(): void {
		this._button?.focus();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[previewBannerTagName]: GlPreviewBanner;
	}
}
