import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatDate, fromNow } from '../../../../system/date';
import { dateConverter } from './converters/date-converter';
import './overlays/tooltip';

@customElement('formatted-date')
export class FormattedDate extends LitElement {
	@property()
	format?: string;

	@property({ attribute: 'date-style' })
	dateStyle: 'relative' | 'absolute' = 'relative';

	@property({ converter: dateConverter(), reflect: true })
	date = new Date();

	@property()
	tooltip = '';

	override render() {
		const formattedDate = formatDate(this.date, this.format ?? 'MMMM Do, YYYY h:mma');
		return html`<gl-tooltip content="${this.tooltip} ${formattedDate}"
			><time datetime="${this.date.toISOString()}"
				>${this.dateStyle === 'relative' ? fromNow(this.date) : formattedDate}</time
			></gl-tooltip
		>`;
	}
}
