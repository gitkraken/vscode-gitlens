import type { LitElement, PropertyValues } from 'lit';

type Constructor<T = object> = new (...args: any[]) => T;

/** Tag names of every sheet chrome converted onto {@link SheetWrapper}. Add a new sheet kind's tag
 *  here too — it feeds {@link sheetWrapperSelector}. */
export const sheetWrapperTags = [
	'gl-graph-branch-sheet',
	'gl-graph-compare-sheet',
	'gl-wip-conflict-sheet',
	'gl-rebase-summary-sheet',
	'gl-graph-pr-sheet',
] as const;

/** Selector for the sheet-stack router's mounted-sheet query — every converted wrapper tag, plus the
 *  bare `gl-detail-sheet` fallback for an unconverted/host-owned sheet. */
export const sheetWrapperSelector = `${sheetWrapperTags.join(', ')}, gl-detail-sheet`;

export interface SheetWrapperApi {
	skipFocusRestore: boolean;
	handleInnerClose: (e: Event) => void;
}

/**
 * Mixin for the sheet chrome wrappers (`gl-graph-branch-sheet`, `gl-graph-compare-sheet`, etc.) —
 * every one owns an inner `gl-detail-sheet` inside its own shadow root and needs the same
 * `skipFocusRestore` mirroring.
 *
 * WHY skipFocusRestore is mirrored: the sheet-stack router in `gl-graph-details-panel.ts`'s
 * `openSheet` queries the HOST element for `skipFocusRestore`, and shadow DOM hides the wrapper's
 * inner `gl-detail-sheet` from that query, so the host must mirror the flag through.
 *
 * WHY `handleInnerClose` stops propagation: the inner `gl-detail-sheet-close` event is composed and
 * would otherwise escape the shadow boundary and double-fire alongside the host's own re-emit.
 */
export function SheetWrapper<T extends Constructor<LitElement>>(Base: T): T & Constructor<SheetWrapperApi> {
	class SheetWrapperMixin extends Base implements SheetWrapperApi {
		private _skipFocusRestore = false;

		set skipFocusRestore(value: boolean) {
			this._skipFocusRestore = value;
			const sheet = this.shadowRoot?.querySelector('gl-detail-sheet');
			if (sheet != null) {
				sheet.skipFocusRestore = value;
			}
		}
		get skipFocusRestore(): boolean {
			return this._skipFocusRestore;
		}

		override firstUpdated(changedProperties: PropertyValues): void {
			super.firstUpdated(changedProperties);

			if (!this._skipFocusRestore) return;

			const sheet = this.shadowRoot?.querySelector('gl-detail-sheet');
			if (sheet != null) {
				sheet.skipFocusRestore = true;
			}
		}

		/** Both the inner sheet's own dismissal and any subclass close-request surface as ONE close
		 *  from this host — the sheet stack pops on it. Public (not protected): a subclass's own
		 *  `render()` template binds `@gl-detail-sheet-close=${this.handleInnerClose}` directly, and
		 *  the mixin's return type is explicitly annotated ({@link SheetWrapperApi}), so only members
		 *  declared there are visible to subclasses regardless of this class's own modifiers. */
		handleInnerClose = (e: Event): void => {
			e.stopPropagation();
			this.dispatchEvent(new CustomEvent('gl-detail-sheet-close', { bubbles: true, composed: true }));
		};
	}

	return SheetWrapperMixin;
}
