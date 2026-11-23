/** Where a key binding is live: the only scope names the graph registers on a host's keymap. */
export type GraphKeymapScope = 'rows' | 'rowControl' | 'pillMenu';

/** A bare chord (`'mod+KeyC'`), or `'raw:X'` / `'mod:X'` / `'text:X'` / `'sep:X'` for a key chip, modifier chip, inline
 *  text or separator. */
export type GraphKeySheetDisplayEntry = string;

/** How a binding appears in a host's shortcut sheet; a host with no sheet can ignore it. */
export type GraphKeySheetEntry = {
	group: string;
	label: string;
	order?: number;
	/** The binding's own keys as shown, when they differ from `keys`. */
	keysOverride?: readonly GraphKeySheetDisplayEntry[];
	subline?: readonly GraphKeySheetDisplayEntry[];
	/** Whole localized subline; takes precedence over `subline`. */
	sublineText?: {
		message: string;
		keys: Readonly<Record<string, readonly GraphKeySheetDisplayEntry[]>>;
	};
	/** Other bindings (by `id`) whose keys this row also presents. */
	with?: readonly { id: string; keys?: readonly GraphKeySheetDisplayEntry[] }[];
};

export type GraphKeyBinding = {
	/** Stable dotted id of a customizable binding, e.g. `'rows.stepPrevious'`; absent for a fixed key. */
	id?: string;
	/** Chords that trigger the binding, in the host dispatcher's chord grammar. */
	keys: readonly string[];
	scope: GraphKeymapScope;
	/** Resolution order among bindings of the same scope, ascending. */
	order?: number;
	/** Every guard must pass for the binding to run. */
	when?: readonly ((e: KeyboardEvent) => boolean)[];
	/** Returns whether it handled the keydown; `chordIndex` is the index into `keys` of the chord that matched. */
	run: (e: KeyboardEvent, chordIndex: number) => boolean;
	sheet: GraphKeySheetEntry | 'hidden';
};

/** A surface the graph opens over itself that Escape must close before any binding runs; the latest pushed is offered
 *  Escape first. */
export type GraphKeymapOverlay = {
	id: string;
	/** Closes the surface and returns true, or returns false when it isn't open so Escape moves on. */
	onClose: () => boolean;
};

/** What `gl-commit-graph` needs from a host's page-wide key dispatcher, passed as `keymap`; several graphs can share
 *  one. A host that passes none gets a private dispatcher inside the element. */
export type GraphKeymap = {
	/** One registrar per graph element; `root` is that element. Disposing it removes everything it registered. */
	attach(root: HTMLElement): GraphKeymapRegistrar;
};

/** One graph's registrations on a {@link GraphKeymap}; scope names are private to the registrar. */
export type GraphKeymapRegistrar = {
	/** Declares where a scope is live: when the `selector` matches an element on the keydown's composed path and every
	 *  guard passes. */
	registerScope(
		id: GraphKeymapScope,
		registration: { selector: string },
		guards: readonly ((e: KeyboardEvent) => boolean)[],
	): { dispose: () => void };
	registerBindings(descriptors: readonly GraphKeyBinding[]): { dispose: () => void };
	pushOverlay(entry: GraphKeymapOverlay): { dispose: () => void };
	dispose(): void;
};
