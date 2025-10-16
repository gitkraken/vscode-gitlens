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

	@property({ converter: dateConverter(), reflect: true, attribute: false })
	date = new Date();

	@property()
	tooltip = '';

	get absoluteDate(): string {
		return formatDate(this.date, this.format ?? 'MMMM Do, YYYY h:mma');
	}

	get dateLabel(): string {
		return this.dateStyle === 'relative' ? fromNow(this.date) : this.absoluteDate;
	}

	override render(): unknown {
		return html`<gl-tooltip content="${this.tooltip} ${this.absoluteDate}"
			><time part="base" datetime="${this.date.toISOString()}">${this.dateLabel}</time></gl-tooltip
		>`;
	}
}
