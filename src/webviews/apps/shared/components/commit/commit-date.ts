import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { dateConverter } from '../converters/date-converter';
import type { FormattedDate } from '../formatted-date';
import '../code-icon';
import '../overlays/tooltip';

@customElement('gl-commit-date')
export class GlCommitDate extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			gap: 0.2rem;
			vertical-align: middle;
			font-size: inherit;
		}

		formatted-date::part(base) {
			white-space: nowrap;
		}
	`;

	@property({ converter: dateConverter(), reflect: true })
	date: Date | undefined;

	@property()
	dateFormat = 'MMMM Do, YYYY h:mma';

	@property()
	dateStyle: 'relative' | 'absolute' = 'relative';

	@property({ type: Boolean })
	committer = false;

	@property()
	actionLabel?: string;

	@query('formatted-date')
	dateElement!: FormattedDate;

	get absoluteDate(): string {
		return this.dateElement.absoluteDate;
	}

	get dateLabel(): string {
		return this.dateElement.dateLabel;
	}

	override render(): unknown {
		return html`<code-icon icon="git-commit"></code-icon>
			<formatted-date
				.date=${this.date}
				.format=${this.dateFormat}
				.dateStyle=${this.dateStyle}
				.tooltip=${this.actionLabel ?? nothing}
			></formatted-date>`;
	}
}
