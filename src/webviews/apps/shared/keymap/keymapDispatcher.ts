import type { Disposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type {
	KeyBinding,
	KeyBindingDescriptor,
	OverlayEntry,
	SheetDisplayEntry,
} from '@gitlens/utils/keys/keybinding.js';
import { registerBinding, resolveKeydown, resolveOverlayClose } from '@gitlens/utils/keys/keybinding.js';

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
	private readonly scopes = new Map<TScope, ScopeEntry>();
	private alwaysOrder: TScope[] = [];
	private bindings: KeyBinding<TScope, KeyboardEvent>[] = [];
	private overlayStack: OverlayEntry[] = [];
	private attached = false;

	constructor(options: { isMac: boolean }) {
		this.isMac = options.isMac;
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
		const registered = descriptors.map(descriptor => registerBinding(descriptor, this.isMac));
		this.bindings.push(...registered);

		return createDisposable(() => {
			this.bindings = this.bindings.filter(binding => !registered.includes(binding));
		});
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
		this.bindings = [];
		this.overlayStack = [];
	}

	sheetEntries(): readonly KeymapSheetRow[] {
		const rows: KeymapSheetRow[] = [];
		for (const binding of this.bindings) {
			if (binding.sheet === 'hidden') continue;

			rows.push({
				group: binding.sheet.group,
				label: binding.sheet.label,
				order: binding.sheet.order,
				keys: binding.sheet.keysOverride ?? binding.keys,
				subline: binding.sheet.subline,
			});
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

			if (!candidate.run(e)) continue;

			e.preventDefault();
			e.stopPropagation();
			return;
		}
	};
}
