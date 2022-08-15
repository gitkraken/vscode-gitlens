import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatDate, fromNow } from '../../../../system/date';
import { dateConverter } from './converters/date-converter';

@customElement('formatted-date')
export class FormattedDate extends LitElement {
	@property()
	format = 'MMMM Do, YYYY h:mma';

	@property({ converter: dateConverter(), reflect: true })
	date = new Date();

	override render() {
		return html`<time datetime="${this.date}" title="${formatDate(this.date, this.format ?? 'MMMM Do, YYYY h:mma')}"
			>${fromNow(this.date)}</time
		>`;
	}
}
