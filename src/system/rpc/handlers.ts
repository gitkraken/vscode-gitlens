/**
 * Supertalk handlers for custom type serialization.
 *
 * These handlers enable proper serialization/deserialization of common types
 * (Date, Map, Set) across the RPC boundary. They work identically on both
 * the extension host and webview sides.
 *
 * Usage:
 * ```typescript
 * import { rpcHandlers } from './handlers.js';
 *
 * // Extension side
 * expose(services, endpoint, { handlers: rpcHandlers });
 *
 * // Webview side
 * wrap<Services>(endpoint, { handlers: rpcHandlers });
 * ```
 */
import type { FromWireContext, Handler, ToWireContext } from '@eamodio/supertalk';

/** Wire type discriminator used by Supertalk */
const wireType = '__st__' as const;

// ============================================================
// Date Handler
// ============================================================

interface WireDate {
	[wireType]: 'date';
	value: number;
}

/**
 * Handler for Date objects.
 * Serializes to timestamp, reconstructs as Date on both sides.
 */
export const dateHandler: Handler<Date, WireDate> = {
	wireType: 'date',

	canHandle: function (value: unknown): value is Date {
		return value instanceof Date;
	},

	toWire: function (date: Date): WireDate {
		return {
			[wireType]: 'date',
			value: date.getTime(),
		};
	},

	fromWire: function (wire: WireDate): Date {
		return new Date(wire.value);
	},
};

// ============================================================
// Map Handler
// ============================================================

interface WireMap {
	[wireType]: 'map';
	entries: unknown[];
}

/**
 * Handler for Map objects.
 * Serializes entries, reconstructs as Map on both sides.
 * Nested values are recursively processed through toWire/fromWire.
 */
export const mapHandler: Handler<Map<unknown, unknown>, WireMap> = {
	wireType: 'map',

	canHandle: function (value: unknown): value is Map<unknown, unknown> {
		return value instanceof Map;
	},

	toWire: function (map: Map<unknown, unknown>, ctx: ToWireContext): WireMap {
		const entries: unknown[] = [];
		for (const [key, val] of map) {
			// Process both key and value through toWire for nested type support
			entries.push([ctx.toWire(key), ctx.toWire(val)]);
		}
		return {
			[wireType]: 'map',
			entries: entries,
		};
	},

	fromWire: function (wire: WireMap, ctx: FromWireContext): Map<unknown, unknown> {
		const map = new Map<unknown, unknown>();
		for (const entry of wire.entries) {
			const [key, val] = entry as [unknown, unknown];
			map.set(ctx.fromWire(key), ctx.fromWire(val));
		}
		return map;
	},
};

// ============================================================
// Set Handler
// ============================================================

interface WireSet {
	[wireType]: 'set';
	values: unknown[];
}

/**
 * Handler for Set objects.
 * Serializes values, reconstructs as Set on both sides.
 * Nested values are recursively processed through toWire/fromWire.
 */
export const setHandler: Handler<Set<unknown>, WireSet> = {
	wireType: 'set',

	canHandle: function (value: unknown): value is Set<unknown> {
		return value instanceof Set;
	},

	toWire: function (set: Set<unknown>, ctx: ToWireContext): WireSet {
		const values: unknown[] = [];
		for (const val of set) {
			values.push(ctx.toWire(val));
		}
		return {
			[wireType]: 'set',
			values: values,
		};
	},

	fromWire: function (wire: WireSet, ctx: FromWireContext): Set<unknown> {
		const set = new Set<unknown>();
		for (const val of wire.values) {
			set.add(ctx.fromWire(val));
		}
		return set;
	},
};

// ============================================================
// RegExp Handler
// ============================================================

interface WireRegExp {
	[wireType]: 'regexp';
	source: string;
	flags: string;
}

/**
 * Handler for RegExp objects.
 * Serializes source and flags, reconstructs as RegExp on both sides.
 */
export const regExpHandler: Handler<RegExp, WireRegExp> = {
	wireType: 'regexp',

	canHandle: function (value: unknown): value is RegExp {
		return value instanceof RegExp;
	},

	toWire: function (regexp: RegExp): WireRegExp {
		return {
			[wireType]: 'regexp',
			source: regexp.source,
			flags: regexp.flags,
		};
	},

	fromWire: function (wire: WireRegExp): RegExp {
		return new RegExp(wire.source, wire.flags);
	},
};

// ============================================================
// Export all handlers
// ============================================================

/**
 * Default set of RPC handlers for GitLens.
 * Includes: Date, Map, Set, RegExp
 *
 * Note: Uri is NOT included because it requires VS Code's Uri class
 * which is only available on the extension host. Uri objects should
 * be converted to UriComponents before sending across the boundary.
 */
export const rpcHandlers: Handler[] = [dateHandler, mapHandler, setHandler, regExpHandler];
