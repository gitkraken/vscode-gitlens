import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { State } from '../../../home/protocol';
import { TogglePreviewEnabledCommand } from '../../../home/protocol';
import { focusOutline } from '../../shared/components/styles/lit/a11y.css';
import { linkBase } from '../../shared/components/styles/lit/base.css';
import { ipcContext } from '../../shared/context';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import '../../shared/components/button-container';
import '../../shared/components/overlays/tooltip';

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
			:host {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4rem;
			}

			:host(:hover),
			:host(:focus-within) {
				background-color: var(--gl-card-background);
			}

			.text-button,
			.feedback {
				padding: 0.4rem 0.8rem;
			}

			gl-tooltip {
				flex: 1;
			}
			.text-button {
				appearance: none;
				background: none;
				border: none;
				color: inherit;
				text-align: start;
				cursor: pointer;
				width: 100%;
			}
			.text-button:focus-visible {
				${focusOutline}
			}
			.text-button--end {
				text-align: end;
			}

			.info {
				opacity: 0.5;
			}

			.feedback {
				display: inline-block;
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

	override render() {
		if (this._state.previewEnabled === true) {
			return html`
				<gl-tooltip placement="bottom">
					<button class="text-button" @click=${() => this.togglePreview()}>
						<code-icon icon="arrow-left"></code-icon> Old Home View
						<code-icon class="info" icon="info"></code-icon>
					</button>
					<p slot="content">
						<strong>Preview</strong> the new Home view with a fresh look and improved performance.
					</p>
				</gl-tooltip>
				<a class="feedback" href="https://github.com/gitkraken/vscode-gitlens/discussions/3721"
					><code-icon icon="megaphone"></code-icon> Feedback</a
				>
			`;
		}

		return html`
			<gl-tooltip placement="bottom">
				<button class="text-button text-button--end" @click=${() => this.togglePreview()}>
					<code-icon class="info" icon="info"></code-icon> New Home View
					<code-icon icon="arrow-right"></code-icon>
				</button>
				<p slot="content">
					<strong>Preview</strong> the new Home view with a fresh look and improved performance.
				</p>
			</gl-tooltip>
		`;
	}

	private togglePreview() {
		this._ipc.sendCommand(TogglePreviewEnabledCommand);
	}

	override focus() {
		this._button.focus();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[previewBannerTagName]: GlPreviewBanner;
	}
}
