import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import '../chips/action-chip.js';

/**
 * Renders the details-panel maximize/restore toggle chip. Stateless: `maximized` drives the icon and
 * label; clicking dispatches a bubbling/composed `gl-toggle-details-maximized` event for the graph host
 * to handle. Pass `slotted: false` for toolbars that aren't a `gl-details-header` `actions` slot (e.g. the
 * compare bar). Pass `sheet: true` for a sheet's own chip — the event carries `{ sheet: true }` so the
 * host toggles the transient sheet-maximize instead of the panel's.
 */
export function renderDetailsMaximizeChip(maximized: boolean, slotted = true, sheet = false): TemplateResult {
	return html`<gl-action-chip
		slot=${slotted ? 'actions' : nothing}
		icon=${maximized ? 'screen-normal' : 'screen-full'}
		label=${maximized ? 'Restore' : 'Maximize'}
		overlay="tooltip"
		@click=${(e: Event) =>
			(e.currentTarget as HTMLElement).dispatchEvent(
				new CustomEvent('gl-toggle-details-maximized', {
					detail: sheet ? { sheet: true } : undefined,
					bubbles: true,
					composed: true,
				}),
			)}
	></gl-action-chip>`;
}
