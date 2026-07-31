import * as assert from 'assert';
import { GraphHostSelectionRequest } from '../hostSelectionRequest.js';

const retention = 30_000;

suite('GraphHostSelectionRequest', () => {
	test('arms on a host value and holds it until the anchor adopts it', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true });

		assert.deepStrictEqual(r.pending, { abc: true });
		assert.strictEqual(r.adopt(undefined), false, 'the anchor has not caught up — the request stays');
		assert.deepStrictEqual(r.pending, { abc: true });

		assert.strictEqual(r.adopt({ abc: true }), true);
		assert.strictEqual(r.pending, undefined, 'adopting drops it; the derived highlight owns it now');
	});

	test('a content-equal re-ship does not re-arm', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true });
		r.adopt({ abc: true });

		// The host re-ships an identical value as a NEW object on every full-state push.
		r.sync({ abc: true });

		assert.strictEqual(r.pending, undefined, 'a re-ship must not resurrect an adopted request');
	});

	test('a genuinely new host selection re-arms', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true });
		r.adopt({ abc: true });

		r.sync({ def: true });

		assert.deepStrictEqual(r.pending, { def: true });
	});

	test('an empty host selection clears rather than arming', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true });

		r.sync({});

		assert.strictEqual(r.pending, undefined);
	});

	test('a request whose row never renders is abandoned once it outlives its retention', () => {
		const r = new GraphHostSelectionRequest(0); // expired the moment it is checked
		r.sync({ 'filtered-out': true });

		r.expireIfWaiting(); // the caller could not project the row

		assert.strictEqual(r.pending, undefined, 'an expired request no longer reads as armed');
		assert.strictEqual(
			r.adopt({ 'filtered-out': true }),
			false,
			'and never lands, even once its row becomes renderable',
		);
	});

	test('age alone never expires a request — only going unsurfaced does', () => {
		const r = new GraphHostSelectionRequest(0); // any aged request would expire, if age were enough
		r.sync({ 'on-screen': true });

		// The graph can sit for minutes without re-rendering; that must not drop a highlight that is
		// on screen and renderable, or it would vanish on the next incidental render.
		assert.deepStrictEqual(r.pending, { 'on-screen': true });
	});

	test('a surfaced request restarts its window, so it survives a later unsurfaced frame', () => {
		const r = new GraphHostSelectionRequest(30_000);
		r.sync({ 'on-screen': true });

		r.touch(); // surfaced this render
		r.expireIfWaiting(); // and briefly unsurfaced the next (a rows push in flight)

		assert.deepStrictEqual(r.pending, { 'on-screen': true }, 'a transient gap must not drop it');
	});

	test('an expired request is not resurrected by a content-equal re-ship', () => {
		const r = new GraphHostSelectionRequest(0);
		r.sync({ 'never-renders': true });
		r.expireIfWaiting();
		assert.strictEqual(r.pending, undefined);

		// The host keeps re-shipping its unchanged selection on every full-state push.
		r.sync({ 'never-renders': true });

		assert.strictEqual(r.pending, undefined, 'expiry is permanent — a re-ship must not re-arm it');
	});

	test('a rejected request is not resurrected by a content-equal re-ship', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true });
		r.rejectFor('abc');

		r.sync({ abc: true });

		assert.strictEqual(r.pending, undefined, 'rejection is permanent against re-ships');
	});

	test('a not-found navigation drops a request naming exactly that sha', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true });

		r.rejectFor('abc');

		assert.strictEqual(r.pending, undefined);
	});

	test('a not-found navigation leaves a request armed by a different source alone', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ 'cold-start': true });

		// A search jump for an unrelated sha times out while cold-start's request is still waiting.
		r.rejectFor('search-target');

		assert.deepStrictEqual(r.pending, { 'cold-start': true }, 'one sha failing must not discard another');
	});

	test('a multi-row request is not dropped by a single-sha rejection', () => {
		const r = new GraphHostSelectionRequest(retention);
		r.sync({ abc: true, def: true });

		r.rejectFor('abc');

		assert.deepStrictEqual(r.pending, { abc: true, def: true });
	});
});
