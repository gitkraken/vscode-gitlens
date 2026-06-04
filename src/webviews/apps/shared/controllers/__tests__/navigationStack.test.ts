import * as assert from 'assert';
import { NavigationStack } from '../navigationStack.js';

type Item = { sha: string; repoPath: string };

function item(sha: string): Item {
	return { sha: sha, repoPath: '/repo' };
}

const a = item('a'.repeat(40));
const b = item('b'.repeat(40));
const c = item('c'.repeat(40));
const d = item('d'.repeat(40));

suite('NavigationStack', () => {
	test('starts empty with nav disabled', () => {
		const nav = new NavigationStack<Item>();
		assert.deepStrictEqual(nav.state, { count: 0, position: 0, canBack: false, canForward: false });
		assert.strictEqual(nav.back(), undefined);
		assert.strictEqual(nav.forward(), undefined);
	});

	test('single record cannot navigate', () => {
		const nav = new NavigationStack<Item>();
		nav.record(a);

		const s = nav.state;
		assert.strictEqual(s.count, 1);
		assert.strictEqual(s.position, 0);
		assert.strictEqual(s.canBack, false);
		assert.strictEqual(s.canForward, false);
	});

	test('records enable back, not forward', () => {
		const nav = new NavigationStack<Item>();
		nav.record(a);
		nav.record(b);

		const s = nav.state;
		assert.strictEqual(s.count, 2);
		assert.strictEqual(s.position, 0);
		assert.strictEqual(s.canBack, true);
		assert.strictEqual(s.canForward, false);
	});

	test('back/forward traverse history', () => {
		const nav = new NavigationStack<Item>();
		nav.record(a);
		nav.record(b);
		nav.record(c);

		// At newest (c): back→b
		assert.strictEqual(nav.back()?.sha, b.sha);
		let s = nav.state;
		assert.strictEqual(s.position, 1);
		assert.strictEqual(s.canBack, true);
		assert.strictEqual(s.canForward, true);

		// back again → a (oldest)
		assert.strictEqual(nav.back()?.sha, a.sha);
		s = nav.state;
		assert.strictEqual(s.position, 2);
		assert.strictEqual(s.canBack, false);
		assert.strictEqual(s.canForward, true);

		// can't go past the oldest
		assert.strictEqual(nav.back(), undefined);
		assert.strictEqual(nav.state.position, 2);

		// forward → b
		assert.strictEqual(nav.forward()?.sha, b.sha);
		assert.strictEqual(nav.state.position, 1);
	});

	test('recording after going back truncates forward history', () => {
		const nav = new NavigationStack<Item>();
		nav.record(a);
		nav.record(b);
		nav.record(c);
		nav.back(); // now at b, forward = c

		nav.record(d); // new branch from b — drops c
		const s = nav.state;
		assert.strictEqual(nav.current()?.sha, d.sha);
		assert.strictEqual(s.position, 0);
		assert.strictEqual(s.canForward, false);
		assert.strictEqual(s.canBack, true);
	});

	test('revisiting an entry dedupes (moves to front)', () => {
		const nav = new NavigationStack<Item>();
		nav.record(a);
		nav.record(b);
		nav.record(a); // revisit a

		const s = nav.state;
		assert.strictEqual(s.count, 2);
		assert.strictEqual(nav.current()?.sha, a.sha);
	});

	test('reset clears history', () => {
		const nav = new NavigationStack<Item>();
		nav.record(a);
		nav.record(b);
		nav.reset();

		assert.strictEqual(nav.state.count, 0);
		assert.strictEqual(nav.current(), undefined);
	});

	test('onChange fires for record/navigate/reset, not no-op navigation', () => {
		const states: number[] = [];
		const nav = new NavigationStack<Item>(10, undefined, s => states.push(s.count));
		nav.record(a); // 1
		nav.record(b); // 2
		nav.back(); // 2 (position change)
		nav.forward(); // 2
		const calls = states.length;
		nav.forward(); // no-op at newest — should not fire
		assert.strictEqual(states.length, calls);

		nav.reset(); // 0
		assert.strictEqual(states.at(-1), 0);
	});

	test('re-recording the current item is suppressed (jitter guard); a new commit emits', () => {
		const counts: number[] = [];
		const nav = new NavigationStack<Item>(10, undefined, s => counts.push(s.count));
		nav.record(a);
		nav.record(b);
		const calls = counts.length;

		// Already-current item → identical derived state → must NOT emit. This is what kills the
		// row-switch jitter: the graph re-fires the same selection several times per click.
		nav.record(b);
		assert.strictEqual(counts.length, calls, 're-recording the current item should not emit');

		// A genuinely new commit changes the derived state (count) → emits.
		nav.record(c);
		assert.strictEqual(counts.length, calls + 1, 'recording a new commit should emit');
	});
});
