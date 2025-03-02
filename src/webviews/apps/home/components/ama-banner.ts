import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { State } from '../../../home/protocol';
import { CollapseSectionCommand } from '../../../home/protocol';
import { linkBase } from '../../shared/components/styles/lit/base.css';
import { ipcContext } from '../../shared/contexts/ipc';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import '../../shared/components/button';
import '../../shared/components/code-icon';
import '../../shared/components/card/card';

@customElement('gl-ama-banner')
export class GlAmaBanner extends LitElement {
	static override styles = [
		linkBase,
		css`
			:host {
				margin-inline: 1.2rem;
			}
			h4 {
				font-weight: normal;
				margin-block-end: 0.4em;
			}

			p {
				margin-block: 0;
				color: var(--vscode-descriptionForeground);
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

	override render() {
		if (this.closed || this._state.amaBannerCollapsed === true) return nothing;

		const url =
			'https://www.gitkraken.com/lp/gitlensama?utm_source=githubdiscussion&utm_medium=hyperlink&utm_campaign=GLAMA&utm_id=GLAMA';
		return html`
			<gl-card indicator="info">
				<h4>Live AMA w/ the creator of GitLens</h4>
				<p>Feb 13 @ 1pm EST &mdash; <a href="${url}">Register now</a></p>
				<gl-button slot="actions" appearance="toolbar" tooltip="Dismiss" @click=${() => this.onClose()}
					><code-icon icon="close"></code-icon
				></gl-button>
			</gl-card>
		`;
	}

	private onClose() {
		this.closed = true;
		this._state.amaBannerCollapsed = true;

		this._ipc.sendCommand(CollapseSectionCommand, {
			section: 'feb2025AmaBanner',
			collapsed: true,
		});
	}
}
