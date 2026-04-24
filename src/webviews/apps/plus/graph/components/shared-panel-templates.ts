import type { TemplateResult } from 'lit';
import { html } from 'lit';
import '../../../shared/components/code-icon.js';

export function renderLoadingState(text: string): TemplateResult {
	return html`<div class="review-loading" aria-busy="true" aria-live="polite">
		<div class="review-loading__spinner">
			<code-icon icon="loading" modifier="spin"></code-icon>
		</div>
		<span class="review-loading__text">${text}</span>
	</div>`;
}

export function renderErrorState(
	errorMessage: string | undefined,
	defaultMessage: string,
	retryEventName: string,
): TemplateResult {
	return html`<div class="review-error" role="alert">
		<code-icon icon="error"></code-icon>
		<span>${errorMessage ?? defaultMessage}</span>
		<button
			class="review-error__retry"
			@click=${(e: Event) => {
				(e.currentTarget as HTMLElement).dispatchEvent(
					new CustomEvent(retryEventName, { bubbles: true, composed: true }),
				);
			}}
		>
			Retry
		</button>
	</div>`;
}
