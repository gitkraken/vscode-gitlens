/// <reference lib="dom" />

import type { Disposable } from '../disposable.js';
import { createDisposable } from '../disposable.js';
import { matchesChord } from './chord.js';
import type {
	KeyBinding,
	KeyBindingDescriptor,
	KeyBindingOverrides,
	OverlayEntry,
	SheetDisplayEntry,
} from './keybinding.js';
import { registerBinding, resolveKeydown, resolveOverlayClose } from './keybinding.js';

/** Where a scope is "active": rooted at a specific element, or matched by a CSS selector against the
 *  keydown's composed path. */
export type ScopeRegistration = { root: Element } | { selector: string };

/** A row for a rendered shortcut sheet — one binding's group/label/keys, in display form. */
export type KeymapSheetRow = {
	group: string;
	label: string;
	order?: number;
	keys: readonly SheetDisplayEntry[];
	subline?: readonly SheetDisplayEntry[];
	/** The row's own id (if any) followed by each contributing partner's id — for the row tooltip.
	 *  Absent (rather than empty) when the row has no ids at all — a fixed/residual row. */
	ids?: readonly string[];
};

type ScopeEntry = {
	registration: ScopeRegistration | 'always';
	guards: readonly ((e: KeyboardEvent) => boolean)[];
};

/** Owns a document-level keydown listener and dispatches it to registered bindings by scope, honoring
 *  an overlay-close stack (Escape) ahead of any binding match. Framework-agnostic — consumers register
 *  scopes/bindings/overlays and call {@link KeymapDispatcher.attach} once. */
export class KeymapDispatcher<TScope extends string> {
	private readonly isMac: boolean;
	private readonly onWarn: ((message: string) => void) | undefined;
	private readonly scopes = new Map<TScope, ScopeEntry>();
	private alwaysOrder: TScope[] = [];
	/** Registered descriptor groups, in registration order — kept so bindings can be rebuilt whenever
	 *  a group is added/removed or the overrides change. */
	private registrationGroups: (readonly KeyBindingDescriptor<TScope, KeyboardEvent>[])[] = [];
	private overrides: KeyBindingOverrides | undefined;
	private bindings: KeyBinding<TScope, KeyboardEvent>[] = [];
	/** Every registered descriptor's outcome, `undefined` when disabled by an override — lets
	 *  {@link sheetEntries} walk descriptors in registration order (not just the survivors) so a
	 *  disabled owner's row can still surface via a registered `with` partner. */
	private bindingByDescriptor = new Map<
		KeyBindingDescriptor<TScope, KeyboardEvent>,
		KeyBinding<TScope, KeyboardEvent> | undefined
	>();
	private overlayStack: OverlayEntry[] = [];
	private attached = false;

	constructor(options: { isMac: boolean; onWarn?: (message: string) => void }) {
		this.isMac = options.isMac;
		this.onWarn = options.onWarn;
	}

	registerScope(
		id: TScope,
		registration: ScopeRegistration | 'always',
		guards: readonly ((e: KeyboardEvent) => boolean)[] = [],
	): Disposable {
		const entry: ScopeEntry = { registration: registration, guards: guards };
		this.scopes.set(id, entry);
		if (registration === 'always') {
			this.alwaysOrder.push(id);
		}

		return createDisposable(() => {
			if (this.scopes.get(id) === entry) {
				this.scopes.delete(id);
			}

			this.alwaysOrder = this.alwaysOrder.filter(scopeId => scopeId !== id);
		});
	}

	registerBindings(descriptors: readonly KeyBindingDescriptor<TScope, KeyboardEvent>[]): Disposable {
		this.registrationGroups.push(descriptors);
		this.rebuildBindings();

		return createDisposable(() => {
			const index = this.registrationGroups.indexOf(descriptors);
			if (index === -1) return;

			this.registrationGroups.splice(index, 1);
			this.rebuildBindings();
		});
	}

	/** Replaces the active override map and rebuilds the effective binding list. Cheap enough to call
	 *  on every config push. */
	setOverrides(overrides: KeyBindingOverrides | undefined): void {
		this.overrides = overrides;
		this.warnIgnoredWildcards(overrides);
		this.rebuildBindings();
	}

	/** Wildcards can only disable (see `resolveOverride`) — warns once per offending wildcard key so
	 *  a user who tried to rebind via `'panels.*'`/`'*'` learns why it didn't take. */
	private warnIgnoredWildcards(overrides: KeyBindingOverrides | undefined): void {
		if (!overrides || this.onWarn == null) return;

		for (const key of Object.keys(overrides)) {
			if (key !== '*' && !key.endsWith('.*')) continue;

			const value = overrides[key];
			if (value === false || value.length === 0) continue;

			this.onWarn(`Ignoring shortcut override '${key}': a wildcard can only disable (false), not rebind`);
		}
	}

	private rebuildBindings(): void {
		const bindings: KeyBinding<TScope, KeyboardEvent>[] = [];
		const byDescriptor = new Map<
			KeyBindingDescriptor<TScope, KeyboardEvent>,
			KeyBinding<TScope, KeyboardEvent> | undefined
		>();

		for (const group of this.registrationGroups) {
			for (const descriptor of group) {
				const binding = registerBinding(descriptor, this.isMac, this.overrides, this.onWarn);
				byDescriptor.set(descriptor, binding);
				if (binding == null) continue;

				bindings.push(binding);
			}
		}

		this.bindings = bindings;
		this.bindingByDescriptor = byDescriptor;
	}

	/** Closes the topmost overlay willing to close, exactly as an Escape keydown would — for hosts whose
	 *  widgets consume Esc locally but still want the stack to outrank their own fallback action. */
	closeTopOverlay(): boolean {
		const candidates = resolveOverlayClose(this.overlayStack);
		for (const entry of candidates) {
			if (!entry.onClose()) continue;

			const index = this.overlayStack.indexOf(entry);
			if (index !== -1) {
				this.overlayStack.splice(index, 1);
			}

			return true;
		}

		return false;
	}

	pushOverlay(entry: OverlayEntry): Disposable {
		this.overlayStack.push(entry);

		return createDisposable(() => {
			const index = this.overlayStack.indexOf(entry);
			if (index === -1) return;

			this.overlayStack.splice(index, 1);
		});
	}

	attach(): void {
		if (this.attached) return;

		document.addEventListener('keydown', this._onKeydown, false);
		this.attached = true;
	}

	dispose(): void {
		if (this.attached) {
			document.removeEventListener('keydown', this._onKeydown, false);
			this.attached = false;
		}

		this.scopes.clear();
		this.alwaysOrder = [];
		this.registrationGroups = [];
		this.overrides = undefined;
		this.bindings = [];
		this.bindingByDescriptor = new Map();
		this.overlayStack = [];
	}

	sheetEntries(): readonly KeymapSheetRow[] {
		const byId = new Map<string, KeyBinding<TScope, KeyboardEvent>>();
		for (const binding of this.bindings) {
			if (binding.id == null) continue;

			byId.set(binding.id, binding);
		}

		// A partner's display segment — its live effective keys once overridden, otherwise the
		// `with` entry's own default display (falling back to the partner's own keys).
		const partnerSegment = (
			partnerBinding: KeyBinding<TScope, KeyboardEvent>,
			partner: { keys?: readonly SheetDisplayEntry[] },
		): readonly SheetDisplayEntry[] =>
			partnerBinding.overridden ? partnerBinding.keys : (partner.keys ?? partnerBinding.keys);

		const rows: KeymapSheetRow[] = [];
		// Walk descriptors (not just `this.bindings`) so a visible descriptor disabled by an override
		// can still surface a row when one of its `with` partners is still registered.
		for (const group of this.registrationGroups) {
			for (const descriptor of group) {
				if (descriptor.sheet === 'hidden') continue;

				const sheet = descriptor.sheet;
				const binding = this.bindingByDescriptor.get(descriptor);

				const keys: SheetDisplayEntry[] = [];
				const ids: string[] = [];

				if (binding != null) {
					const self = binding.overridden ? binding.keys : (sheet.keysOverride ?? binding.keys);
					keys.push(...self);
					if (binding.id != null) {
						ids.push(binding.id);
					}
				}

				for (const partner of sheet.with ?? []) {
					const partnerBinding = byId.get(partner.id);
					if (partnerBinding == null) continue; // disabled (or unregistered) partner contributes nothing

					if (keys.length > 0) {
						keys.push('sep:/');
					}
					keys.push(...partnerSegment(partnerBinding, partner));
					ids.push(partner.id);
				}

				// The owner is disabled AND no `with` partner survived — nothing left to show.
				if (binding == null && ids.length === 0) continue;

				rows.push({
					group: sheet.group,
					label: sheet.label,
					order: sheet.order,
					keys: keys,
					subline: sheet.subline,
					ids: ids.length > 0 ? ids : undefined,
				});
			}
		}

		return rows;
	}

	private readonly _onKeydown = (e: KeyboardEvent): void => {
		if (e.defaultPrevented) return;

		if (e.key === 'Escape' && this.overlayStack.length > 0 && this.closeTopOverlay()) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		const chain: TScope[] = [];
		for (const element of e.composedPath()) {
			for (const [id, entry] of this.scopes) {
				if (entry.registration === 'always') continue;
				if (chain.includes(id)) continue;

				const registration = entry.registration;
				const matches =
					('root' in registration && registration.root === element) ||
					('selector' in registration &&
						element instanceof Element &&
						element.matches(registration.selector));
				if (matches) {
					chain.push(id);
				}
			}
		}

		for (const id of this.alwaysOrder) {
			if (!chain.includes(id)) {
				chain.push(id);
			}
		}

		const candidates = resolveKeydown(this.bindings, chain, e);
		for (const candidate of candidates) {
			const guards = this.scopes.get(candidate.scope)?.guards ?? [];
			if (guards.some(guard => !guard(e))) continue;

			if (candidate.when?.some(when => !when(e))) continue;

			const chordIndex = candidate.chords.findIndex(chord => matchesChord(chord, e));
			if (!candidate.run(e, chordIndex)) continue;

			e.preventDefault();
			e.stopPropagation();
			return;
		}
	};
}
