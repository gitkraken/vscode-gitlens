import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { dateConverter } from './converters/date-converter.js';
import './overlays/tooltip.js';

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

	@property({ type: Boolean })
	short = false;

	get absoluteDate(): string {
		return formatDate(this.date, this.format ?? 'MMMM Do, YYYY h:mma');
	}

	get dateLabel(): string {
		return this.dateStyle === 'relative' ? fromNow(this.date, this.short) : this.absoluteDate;
	}

	override render(): unknown {
		return html`<gl-tooltip content="${this.tooltip} ${this.absoluteDate}"
			><time part="base" datetime="${this.date.toISOString()}">${this.dateLabel}</time></gl-tooltip
		>`;
	}
}
