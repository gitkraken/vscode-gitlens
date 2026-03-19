/* eslint-disable @typescript-eslint/no-unsafe-function-type */

/**
 * Class decorator that adds a `toJSON()` method materializing all prototype getters into the
 * serialized output. This ensures that computed properties survive `JSON.stringify` and
 * structured-clone boundaries (e.g. IPC between extension host and webviews).
 *
 * The prototype chain is walked **once at decoration time** — the resulting getter key list is
 * captured in a closure, so per-instance `toJSON()` is just a fast array loop with no reflection.
 *
 * If the class has no prototype getters the decorator returns immediately without modifying the
 * class — zero cost for pure-data models.
 */
export function serializable(target: Function): void {
	// Walk the prototype chain once at module-load time to find all getter keys
	const getterKeys = new Set<string>();
	let proto = target.prototype as object | null;
	while (proto != null && proto !== Object.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (key === 'constructor') continue;
			const desc = Object.getOwnPropertyDescriptor(proto, key);
			if (desc?.get != null) {
				getterKeys.add(key);
			}
		}
		proto = Object.getPrototypeOf(proto) as object | null;
	}

	// No getters — leave the class untouched
	if (!getterKeys.size) return;

	// Mutate the prototype directly (same pattern as @loggable)
	(target.prototype as Record<string, unknown>).toJSON = function (this: object): Record<string, unknown> {
		const result: Record<string, unknown> = { ...(this as Record<string, unknown>) };
		for (const key of getterKeys) {
			if (!Object.hasOwn(result, key)) {
				result[key] = (this as Record<string, unknown>)[key];
			}
		}
		return result;
	};
}
