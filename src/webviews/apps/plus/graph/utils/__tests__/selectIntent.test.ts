import * as assert from 'assert';
import { GraphSelectIntent } from '../selectIntent.js';

const always = () => true;
const never = () => false;

suite('GraphSelectIntent', () => {
	test('a deferred ask is taken once its row becomes renderable', () => {
		const i = new GraphSelectIntent();
		i.defer('abc', i.begin());

		assert.strictEqual(i.take(never), undefined, 'not renderable yet — stays queued');
		assert.strictEqual(i.pending, 'abc');
		assert.strictEqual(i.take(always), 'abc');
		assert.strictEqual(i.pending, undefined, 'taking clears it');
		assert.strictEqual(i.take(always), undefined, 'and it only fires once');
	});

	test('a newer ask supersedes one still waiting', () => {
		const i = new GraphSelectIntent();
		i.defer('old', i.begin());
		i.defer('new', i.begin());

		assert.strictEqual(i.take(always), 'new');
		assert.strictEqual(i.pending, undefined, 'the superseded ask never fires');
	});

	test('a stale generation cannot queue — an async caller loses to the ask that replaced it', () => {
		const i = new GraphSelectIntent();
		const stale = i.begin();
		i.begin(); // a newer ask arrives while the first was awaiting a host round-trip

		i.defer('from-stale-request', stale);

		assert.strictEqual(i.pending, undefined);
		assert.strictEqual(i.take(always), undefined);
	});

	test('user intent cancels a queued ask', () => {
		const i = new GraphSelectIntent();
		i.defer('queued', i.begin());

		i.cancel(); // the user clicked a different row while the jump waited

		assert.strictEqual(i.pending, undefined);
		assert.strictEqual(i.take(always), undefined, 'the queued jump must not move the user off their click');
	});

	test('cancel also invalidates an in-flight generation', () => {
		const i = new GraphSelectIntent();
		const g = i.begin();
		i.cancel();

		i.defer('late', g); // the host request settles after the user already clicked

		assert.strictEqual(i.pending, undefined);
	});

	test('an ask that outlives its retention is abandoned, not fired later', () => {
		const i = new GraphSelectIntent(0); // zero retention — expired the instant it is deferred
		i.defer('filtered-out', i.begin());

		assert.strictEqual(i.pending, undefined, 'an expired ask no longer reads as queued');
		assert.strictEqual(i.take(always), undefined, 'and never lands, even once its row becomes renderable');
		assert.strictEqual(i.take(always), undefined);
	});

	test('an ask inside its retention keeps waiting across failed takes', () => {
		const i = new GraphSelectIntent();
		i.defer('paging-in', i.begin());

		assert.strictEqual(i.take(never), undefined);
		assert.strictEqual(i.take(never), undefined);
		assert.strictEqual(i.pending, 'paging-in', 'the window is time-based, not a per-take budget');
		assert.strictEqual(i.take(always), 'paging-in');
	});

	test('begin() clears without needing a take — an ask whose row is already present leaves nothing queued', () => {
		const i = new GraphSelectIntent();
		i.defer('first', i.begin());
		i.begin(); // second ask resolves immediately via the fast path, so it never defers

		assert.strictEqual(i.pending, undefined);
	});
});
