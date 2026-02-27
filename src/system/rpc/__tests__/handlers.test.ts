import * as assert from 'assert';
import type { FromWireContext, ToWireContext } from '@eamodio/supertalk';
import { dateHandler, mapHandler, regExpHandler, rpcHandlers, setHandler } from '../handlers.js';

// ============================================================
// Helpers
// ============================================================

/** Identity ToWireContext: returns value unchanged (no nesting). */
const toWireCtx: ToWireContext = { toWire: (v: unknown) => v };
/** Identity FromWireContext: returns value unchanged (no nesting). */
const fromWireCtx: FromWireContext = { fromWire: (v: unknown) => v };

/**
 * Round-trip helper: toWire → fromWire. Uses `any` to bridge the
 * WireValue ↔ WireType gap in Supertalk's Handler type signature.
 */

function roundTrip(handler: any, value: unknown): unknown {
	const wire = handler.toWire(value, toWireCtx);
	return handler.fromWire(wire, fromWireCtx);
}

// ============================================================
// Tests
// ============================================================

suite('RPC Handlers Test Suite', () => {
	suite('dateHandler', () => {
		test('canHandle should return true for Date instances', () => {
			assert.strictEqual(dateHandler.canHandle(new Date()), true);
			assert.strictEqual(dateHandler.canHandle(new Date(0)), true);
			assert.strictEqual(dateHandler.canHandle(new Date('2024-01-01')), true);
		});

		test('canHandle should return false for non-Date values', () => {
			assert.strictEqual(dateHandler.canHandle(123), false);
			assert.strictEqual(dateHandler.canHandle('2024-01-01'), false);
			assert.strictEqual(dateHandler.canHandle(null), false);
			assert.strictEqual(dateHandler.canHandle(undefined), false);
			assert.strictEqual(dateHandler.canHandle({}), false);
		});

		test('should round-trip a Date', () => {
			const date = new Date('2024-06-15T12:30:00Z');
			const result = roundTrip(dateHandler, date) as Date;
			assert.ok(result instanceof Date);
			assert.strictEqual(result.getTime(), date.getTime());
		});

		test('should preserve the epoch (Date(0))', () => {
			const result = roundTrip(dateHandler, new Date(0)) as Date;
			assert.ok(result instanceof Date);
			assert.strictEqual(result.getTime(), 0);
		});

		test('wire format should contain timestamp number', () => {
			const date = new Date('2024-01-01T00:00:00Z');

			const wire = dateHandler.toWire(date, toWireCtx) as any;
			assert.strictEqual(typeof wire.value, 'number');
			assert.strictEqual(wire.value, date.getTime());
		});
	});

	suite('mapHandler', () => {
		test('canHandle should return true for Map instances', () => {
			assert.strictEqual(mapHandler.canHandle(new Map()), true);
			assert.strictEqual(
				mapHandler.canHandle(
					new Map([
						['a', 1],
						['b', 2],
					]),
				),
				true,
			);
		});

		test('canHandle should return false for non-Map values', () => {
			assert.strictEqual(mapHandler.canHandle({}), false);
			assert.strictEqual(mapHandler.canHandle([]), false);
			assert.strictEqual(mapHandler.canHandle(null), false);
			assert.strictEqual(mapHandler.canHandle(new Set()), false);
		});

		test('should round-trip an empty Map', () => {
			const result = roundTrip(mapHandler, new Map()) as Map<unknown, unknown>;
			assert.ok(result instanceof Map);
			assert.strictEqual(result.size, 0);
		});

		test('should round-trip a Map with string keys and number values', () => {
			const map = new Map<string, number>([
				['a', 1],
				['b', 2],
				['c', 3],
			]);
			const result = roundTrip(mapHandler, map) as Map<string, number>;
			assert.ok(result instanceof Map);
			assert.strictEqual(result.size, 3);
			assert.strictEqual(result.get('a'), 1);
			assert.strictEqual(result.get('b'), 2);
			assert.strictEqual(result.get('c'), 3);
		});

		test('wire format should contain entries array', () => {
			const map = new Map([['key', 'value']]);

			const wire = mapHandler.toWire(map, toWireCtx) as any;
			assert.ok(Array.isArray(wire.entries));
			assert.strictEqual(wire.entries.length, 1);
		});
	});

	suite('setHandler', () => {
		test('canHandle should return true for Set instances', () => {
			assert.strictEqual(setHandler.canHandle(new Set()), true);
			assert.strictEqual(setHandler.canHandle(new Set([1, 2, 3])), true);
		});

		test('canHandle should return false for non-Set values', () => {
			assert.strictEqual(setHandler.canHandle([]), false);
			assert.strictEqual(setHandler.canHandle({}), false);
			assert.strictEqual(setHandler.canHandle(null), false);
			assert.strictEqual(setHandler.canHandle(new Map()), false);
		});

		test('should round-trip an empty Set', () => {
			const result = roundTrip(setHandler, new Set()) as Set<unknown>;
			assert.ok(result instanceof Set);
			assert.strictEqual(result.size, 0);
		});

		test('should round-trip a Set with mixed values', () => {
			const set = new Set([1, 'two', true]);
			const result = roundTrip(setHandler, set) as Set<unknown>;
			assert.ok(result instanceof Set);
			assert.strictEqual(result.size, 3);
			assert.ok(result.has(1));
			assert.ok(result.has('two'));
			assert.ok(result.has(true));
		});

		test('wire format should contain values array', () => {
			const set = new Set(['a', 'b']);

			const wire = setHandler.toWire(set, toWireCtx) as any;
			assert.ok(Array.isArray(wire.values));
			assert.strictEqual(wire.values.length, 2);
		});
	});

	suite('regExpHandler', () => {
		test('canHandle should return true for RegExp instances', () => {
			assert.strictEqual(regExpHandler.canHandle(/test/), true);
			assert.strictEqual(regExpHandler.canHandle(new RegExp('test', 'gi')), true);
		});

		test('canHandle should return false for non-RegExp values', () => {
			assert.strictEqual(regExpHandler.canHandle('test'), false);
			assert.strictEqual(regExpHandler.canHandle({}), false);
			assert.strictEqual(regExpHandler.canHandle(null), false);
		});

		test('should round-trip a simple RegExp', () => {
			const regex = /hello/;
			const result = roundTrip(regExpHandler, regex) as RegExp;
			assert.ok(result instanceof RegExp);
			assert.strictEqual(result.source, 'hello');
			assert.strictEqual(result.flags, '');
		});

		test('should preserve flags', () => {
			const regex = /test/gim;
			const result = roundTrip(regExpHandler, regex) as RegExp;
			assert.strictEqual(result.source, 'test');
			assert.strictEqual(result.flags, 'gim');
		});

		test('should handle complex patterns', () => {
			const regex = /^[a-z]+\d{2,4}$/i;
			const result = roundTrip(regExpHandler, regex) as RegExp;
			assert.strictEqual(result.source, regex.source);
			assert.strictEqual(result.flags, regex.flags);
			// Verify the round-tripped regex works
			assert.ok(result.test('abc12'));
			assert.ok(!result.test('ABC'));
		});

		test('wire format should contain source and flags', () => {
			const regex = /test/gi;

			const wire = regExpHandler.toWire(regex, toWireCtx) as any;
			assert.strictEqual(wire.source, 'test');
			assert.strictEqual(wire.flags, 'gi');
		});
	});

	suite('rpcHandlers', () => {
		test('should export all four handlers', () => {
			assert.strictEqual(rpcHandlers.length, 4);
		});

		test('should include dateHandler', () => {
			assert.ok(rpcHandlers.includes(dateHandler));
		});

		test('should include mapHandler', () => {
			assert.ok(rpcHandlers.includes(mapHandler));
		});

		test('should include setHandler', () => {
			assert.ok(rpcHandlers.includes(setHandler));
		});

		test('should include regExpHandler', () => {
			assert.ok(rpcHandlers.includes(regExpHandler));
		});
	});
});
