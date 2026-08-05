import * as assert from 'assert';
import { signalObjectState, signalState } from '../signal-utils.js';

suite('signal-utils', () => {
	test('signalState hands afterChange the instance, not the prototype', () => {
		const seen: unknown[] = [];

		class Host {
			readonly marker = 'instance';

			@signalState<number | undefined>(undefined, { afterChange: (target, value) => seen.push([target, value]) })
			accessor value: number | undefined;
		}

		const host = new Host();
		host.value = 7;

		assert.strictEqual(host.value, 7);
		// A hook reaching for instance state — or calling a method that does — sees `undefined` when it's
		// handed the prototype, which is how the row-marker reconcile started throwing
		assert.deepStrictEqual(seen, [[host, 7]]);
		assert.strictEqual((seen[0] as [Host, number])[0].marker, 'instance');
	});

	test('signalObjectState hands afterChange the instance, not the prototype', () => {
		const seen: unknown[] = [];

		class Host {
			readonly marker = 'instance';

			@signalObjectState<{ count: number }>(
				{ count: 0 },
				{ afterChange: (target, value) => seen.push([target, value]) },
			)
			accessor value!: { count: number };
		}

		const host = new Host();
		host.value = { count: 3 };

		assert.strictEqual(host.value.count, 3);
		assert.deepStrictEqual(seen, [[host, { count: 3 }]]);
	});
});
