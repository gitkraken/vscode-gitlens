import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatDate, fromNow } from '../../../../system/date';
import { dateConverter } from './converters/date-converter';

@customElement('formatted-date')
export class FormattedDate extends LitElement {
	@property()
	format?: string;

	@property({ attribute: 'date-style' })
	dateStyle: 'relative' | 'absolute' = 'relative';

	@property({ converter: dateConverter(), reflect: true })
	date = new Date();

	override render() {
		const formattedDate = formatDate(this.date, this.format ?? 'MMMM Do, YYYY h:mma');
		return html`<time datetime="${this.date.toISOString()}" title="${formattedDate}"
			>${this.dateStyle === 'relative' ? fromNow(this.date) : formattedDate}</time
		>`;
	}
}
