import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { State } from '../../../home/protocol';
import { CollapseSectionCommand, TogglePreviewEnabledCommand } from '../../../home/protocol';
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
			.title {
				margin-block-end: 0.4em;
			}

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

			gl-card::part(base) {
				margin-block-end: 1.2rem;
			}

			.feedback {
				white-space: nowrap;
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

	@state()
	private closed = false;

	@query('button')
	private _button!: HTMLButtonElement;

	get isNewInstall() {
		return this._state.newInstall;
	}

	override render() {
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

		if (this.closed || this._state.previewCollapsed === true) {
			return nothing;
		}

		return html`
			<gl-card>
				<h4 class="title">Welcome to the GitLens Home View</h4>
				<p>
					Streamline your workflow — effortlessly track, manage, and collaborate on your branches and pull
					requests, all in one intuitive hub.
					<a class="feedback" href="https://help.gitkraken.com/gitlens/home-view/">Learn more</a>
				</p>
				<gl-button slot="actions" appearance="toolbar" tooltip="Dismiss Welcome" @click=${() => this.onClose()}
					><code-icon icon="close"></code-icon
				></gl-button>
			</gl-card>
		`;
	}

	private togglePreview(dismiss = false) {
		this._ipc.sendCommand(TogglePreviewEnabledCommand);

		if (dismiss) {
			this.closed = true;
		}
	}

	private onClose() {
		this.closed = true;

		this._ipc.sendCommand(CollapseSectionCommand, {
			section: 'newHomePreview',
			collapsed: true,
		});
	}

	override focus() {
		this._button?.focus();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[previewBannerTagName]: GlPreviewBanner;
	}
}
