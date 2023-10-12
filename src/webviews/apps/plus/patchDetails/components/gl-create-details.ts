import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlDetailsBase } from './gl-details-base';

@customElement('gl-create-details')
export class GlCreateDetails extends GlDetailsBase {
	override render() {
		return html`${this.renderRepoChangedPane()}`;
	}
}
