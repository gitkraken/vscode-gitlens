import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import { ref } from 'lit/directives/ref.js';
import type { Preferences } from '../../../../plus/graph/detailsProtocol.js';
import type { MergedAutolinks } from '../../../shared/components/chips/autolinks.js';
import { renderAutolinkChips, renderAutolinksPopover } from '../../../shared/components/chips/autolinks.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/chips/chip-overflow.js';
import { renderLearnAboutAutolinks } from '../../../shared/components/chips/learn-about-autolinks.js';
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

/** Pass `retryEventName: undefined` for non-retryable errors (e.g. invalid compose scope, where
 *  the same input fails identically) — only Go Back is offered. */
export function renderErrorState(
	errorMessage: string | undefined,
	defaultMessage: string,
	retryEventName: string | undefined,
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
			${
				retryEventName != null
					? html`<gl-button @click=${(e: Event) => dispatch(e.currentTarget as HTMLElement, retryEventName)}
							>Retry</gl-button
						>`
					: nothing
			}
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

/** State for {@link renderAutolinksStrip} — shared by the compare-mode and multicommit panels'
 *  autolinks strip + enrichment button. The two surfaces' hide/show policies differ only in how
 *  they report enrichment progress, so each passes its own flags and click handler. */
export interface AutolinksStripState {
	/** Merged autolink + enriched-item chips for the strip (see {@link AutolinkMerger.merge}). */
	merged: MergedAutolinks;
	/** True while the underlying comparison is still settling with no chips yet — renders the
	 *  spinner instead of the "Learn about autolinks" prompt. Only consulted when there are no
	 *  chips, so callers can pass their raw loading state without re-checking `merged`. */
	isLoadingEmpty: boolean;
	preferences?: Preferences;
	hasAccount: boolean;
	hasIntegrationsConnected: boolean;
	/** True once enrichment has been requested for this comparison and isn't running anymore —
	 *  the enrich chip then stays off so fresh enriched items appear inline as they resolve.
	 *  Compare-mode panel policy; leave undefined to opt out of this rule. */
	enrichmentRequested?: boolean;
	/** True when an enrichment result set has already arrived — drops the enrich chip entirely.
	 *  Multicommit panel policy; leave undefined to opt out of this rule. */
	enrichmentSettled?: boolean;
	/** True while an enrichment fetch is in flight — swaps the enrich chip for a disabled spinner. */
	enrichmentLoading?: boolean;
	/** True when enrichment completed with no additional results — shows an informational chip. */
	enrichmentNoneFound?: boolean;
	/** Dispatches the panel's enrichment request event (`request-enrichment` / `enrich-autolinks`). */
	onRequestEnrichment: () => void;
}

function renderEnrichChip(state: AutolinksStripState): TemplateResult | typeof nothing {
	if (!state.hasIntegrationsConnected) return nothing;

	if (state.enrichmentNoneFound) {
		return html`<gl-action-chip
			slot="suffix"
			icon="info"
			label="No Additional Issues or Pull Requests Found"
			overlay="tooltip"
		></gl-action-chip>`;
	}

	if ((state.enrichmentRequested && !state.enrichmentLoading) || state.enrichmentSettled) return nothing;

	if (state.enrichmentLoading) {
		return html`<gl-action-chip
			slot="suffix"
			icon="loading"
			label="Loading Issues and Pull Requests..."
			overlay="tooltip"
			disabled
		></gl-action-chip>`;
	}

	return html`<gl-action-chip
		slot="suffix"
		icon="sync"
		label="Load Associated Issues and Pull Requests"
		overlay="tooltip"
		@click=${state.onRequestEnrichment}
	></gl-action-chip>`;
}

/**
 * The autolinks chip strip + enrich button shared by the compare-mode and multicommit panels.
 * Single-row layout — excess autolinks collapse into `gl-chip-overflow`'s "+N" overflow
 * affordance instead of wrapping onto multiple rows.
 */
export function renderAutolinksStrip(state: AutolinksStripState): TemplateResult {
	const hasChips = state.merged.autolinks.length > 0 || state.merged.enriched.length > 0;

	return html`<div class="compare-enrichment">
		<gl-chip-overflow>
			${
				hasChips
					? nothing
					: state.isLoadingEmpty
						? html`<span slot="prefix" class="compare-enrichment__loading" aria-busy="true">
								<code-icon icon="loading" modifier="spin"></code-icon>
								<span>Loading autolinks…</span>
							</span>`
						: renderLearnAboutAutolinks({
								hasIntegrationsConnected: state.hasIntegrationsConnected,
								hasAccount: state.hasAccount,
								showLabel: true,
								slotName: 'prefix',
							})
			}
			${renderAutolinkChips(state.merged, state.preferences, true)} ${renderAutolinksPopover(state.merged)}
			${renderEnrichChip(state)}
			${
				hasChips
					? renderLearnAboutAutolinks({
							hasIntegrationsConnected: state.hasIntegrationsConnected,
							hasAccount: state.hasAccount,
							slotName: 'suffix',
						})
					: nothing
			}
		</gl-chip-overflow>
	</div>`;
}
