import type { TemplateResult } from 'lit';
import { html } from 'lit';
import { ref } from 'lit/directives/ref.js';
import '../../../shared/components/button.js';
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
	backEventName: string,
): TemplateResult {
	const dispatch = (target: HTMLElement, name: string): void => {
		target.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
	};

	// Esc on the error banner triggers the same Back action the button does — matches the
	// "back out of the current step" gesture users expect from any modal-ish surface.
	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape') return;

		e.stopPropagation();
		e.preventDefault();
		dispatch(e.currentTarget as HTMLElement, backEventName);
	};

	// Auto-focus the panel on connect so the Esc keydown handler is reachable without
	// requiring the user to click into it first. The `tabindex="-1"` makes it
	// programmatically focusable; without this `el.focus()` the keydown listener is dead for
	// keyboard-only users until they tab in. Microtask-defer so Lit finishes the current
	// commit before we focus, and re-check `isConnected` because a rapid status flip
	// (error → loading → error) could detach the element between scheduling and firing.
	const focusOnConnect = (el: Element | undefined): void => {
		if (el == null) return;

		queueMicrotask(() => {
			const target = el as HTMLElement;
			if (!target.isConnected) return;

			target.focus({ preventScroll: true });
		});
	};

	return html`<div class="panel-error" role="alert" tabindex="-1" @keydown=${handleKeyDown} ${ref(focusOnConnect)}>
		<div class="panel-error__header">
			<code-icon class="panel-error__icon" icon="error"></code-icon>
			<span class="panel-error__title">Something went wrong</span>
		</div>
		<div class="panel-error__message">${errorMessage ?? defaultMessage}</div>
		<div class="panel-error__actions">
			<gl-button
				appearance="secondary"
				@click=${(e: Event) => dispatch(e.currentTarget as HTMLElement, backEventName)}
				>Go Back</gl-button
			>
			<gl-button @click=${(e: Event) => dispatch(e.currentTarget as HTMLElement, retryEventName)}
				>Retry</gl-button
			>
		</div>
	</div>`;
}

/**
 * Vertical chrome (padding + border) of the `.scope-split__picker` wrapper that hosts the scope
 * pane in review/compose mode. `GlCommitsScopePane.contentHeight` only measures the inner scroll
 * pane, so the `.scope-split` snap function adds this to size the fit-content track to the
 * picker's true height — otherwise the track clamps short and clips the content / desyncs the
 * divider. Pass the `gl-commits-scope-pane` element; returns 0 if it isn't inside a picker.
 */
export function getScopeSplitPickerChrome(scopeEl: Element): number {
	const picker = scopeEl.closest<HTMLElement>('.scope-split__picker');
	if (picker == null) return 0;

	const style = getComputedStyle(picker);
	return (
		parseFloat(style.paddingTop) +
		parseFloat(style.paddingBottom) +
		parseFloat(style.borderTopWidth) +
		parseFloat(style.borderBottomWidth)
	);
}
