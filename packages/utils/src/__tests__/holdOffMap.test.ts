import * as assert from 'assert';
import { HoldOffMap } from '../holdOffMap.js';

suite('HoldOffMap Test Suite', () => {
	const wait = 1000;
	let now: number;
	const clock = { now: (): number => now };

	setup(() => {
		now = 10_000;
	});

	test('holds a key for the wait, with its value, and releases it after', () => {
		const map = new HoldOffMap<string, number>(wait, 10, clock);
		map.hold('a', 7);

		now += wait - 1;
		assert.strictEqual(map.get('a'), 7);
		assert.strictEqual(map.isHeld('a'), true);

		now += 1;
		assert.strictEqual(map.get('a'), undefined);
		assert.strictEqual(map.isHeld('a'), false);

		now -= 1;
		assert.strictEqual(map.isHeld('a'), false, 'a key whose wait was found over stays released');
	});

	test('holds nothing it was not asked to', () => {
		const map = new HoldOffMap<string, true>(wait, 10, clock);
		map.hold('a', true);

		assert.strictEqual(map.isHeld('b'), false);
	});

	test('a key held again waits from then', () => {
		const map = new HoldOffMap<string, true>(wait, 10, clock);
		map.hold('a', true);

		now += wait - 1;
		map.hold('a', true);
		now += wait - 1;
		assert.strictEqual(map.isHeld('a'), true);
	});

	test('release ends a wait early', () => {
		const map = new HoldOffMap<string, true>(wait, 10, clock);
		map.hold('a', true);
		map.hold('b', true);

		map.release('a');
		assert.strictEqual(map.isHeld('a'), false);
		assert.strictEqual(map.isHeld('b'), true);
	});

	test('a clock that went back ends the wait rather than stretching it', () => {
		const map = new HoldOffMap<string, true>(wait, 10, clock);
		map.hold('a', true);

		now -= 1;
		assert.strictEqual(map.isHeld('a'), false);
	});

	test('past its capacity, the key held longest ago is dropped', () => {
		const map = new HoldOffMap<string, true>(wait, 2, clock);
		map.hold('a', true);
		map.hold('b', true);
		map.hold('c', true);

		assert.strictEqual(map.isHeld('a'), false);
		assert.strictEqual(map.isHeld('b'), true);
		assert.strictEqual(map.isHeld('c'), true);
	});

	test('reads the clock it was given on every call', () => {
		const moving = { now: (): number => 0 };
		const map = new HoldOffMap<string, true>(wait, 10, moving);
		map.hold('a', true);

		moving.now = () => wait;
		assert.strictEqual(map.isHeld('a'), false);
	});
});
