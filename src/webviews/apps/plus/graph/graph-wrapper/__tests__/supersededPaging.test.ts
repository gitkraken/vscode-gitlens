import * as assert from 'assert';
import { GlGraphWrapper } from '../graph-wrapper.js';

/**
 * The CLIENT end of the paging contract, and the layer that terminates it.
 *
 * The session refuses a page whose window was replaced while it was queued, and the host reports that
 * refusal rather than absorbing it — but neither can decide what to do about it. Paging here is
 * edge-triggered: rows are asked for when the graph reaches the boundary that wants them, so a refused
 * request is simply lost unless something re-asks, and only this layer knows whether the user is still at
 * that boundary.
 *
 * THE INVARIANT IS "at most one re-ask per DELIVERED window" — the re-ask is armed by the refusal and
 * fired by the next rows delivery. Delivery, not a delay, because a refusal does not imply a replacement
 * is coming: a stale-generation refusal has its replacement already queued, while a TAINTED window (a
 * rebind that failed part-way through re-stamping rows in place) refuses every page until a repair walk
 * rebuilds it, with nothing arriving in between. Re-asking on a timer would spin refused RPCs through the
 * whole repair — and forever if the repair itself failed, which is exactly the case a wedged repo
 * produces.
 */
suite('GlGraphWrapper — superseded page re-ask', () => {
	const proto = GlGraphWrapper.prototype;

	function priv(t: GlGraphWrapper): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	/**
	 * A wrapper stubbed down to the paging path. `deliverRows()` is the seam under test: it swaps the row
	 * array's identity (what a real rows push does) and runs the consume the render cycle would run.
	 */
	function createFakeThis(options: {
		outcomes: (string | undefined)[];
		needsMoreRows: () => boolean;
		repoFamily?: () => string | undefined;
	}): {
		t: GlGraphWrapper;
		asks: { id: string | undefined; limit: number | undefined }[];
		deliverRows: () => Promise<void>;
	} {
		const asks: { id: string | undefined; limit: number | undefined }[] = [];
		let call = 0;
		const fake = Object.create(proto) as GlGraphWrapper;

		priv(fake).graphState = { loading: false, rows: [] };
		priv(fake).services = {
			rows: Promise.resolve({
				getMoreRows: (id?: string, limit?: number) => {
					asks.push({ id: id, limit: limit });
					return Promise.resolve(options.outcomes[Math.min(call++, options.outcomes.length - 1)]);
				},
			}),
		};
		const graph = {
			updateComplete: Promise.resolve(true),
			needsMoreRows: options.needsMoreRows,
			isConnected: true,
		};
		Object.defineProperty(fake, 'graph', { get: () => graph, configurable: true });
		priv(fake).getRepoFamily = options.repoFamily ?? (() => '/repo');

		const deliverRows = async (): Promise<void> => {
			// A rows push replaces the array — the identity change IS the delivery signal.
			(priv(fake).graphState as { rows: unknown[] }).rows = [];
			proto['consumeSupersededPageRetry'].call(fake);
			// The consume defers its re-check behind the graph's own update.
			await new Promise(resolve => setTimeout(resolve, 0));
		};

		return { t: fake, asks: asks, deliverRows: deliverRows };
	}

	test('a superseded page is re-asked once the replacing window is DELIVERED', async () => {
		const { t, asks, deliverRows } = createFakeThis({
			outcomes: ['superseded', 'added'],
			needsMoreRows: () => true,
		});

		await proto['requestMoreRowsFromHost'].call(t, undefined, 25);
		assert.strictEqual(asks.length, 1, 'armed, not fired — nothing has been delivered yet');

		await deliverRows();

		assert.strictEqual(asks.length, 2, 'the delivery fires the re-ask');
		assert.deepStrictEqual(asks[1], { id: undefined, limit: 25 }, 'and re-asks for the same page');
	});

	test('a delivery that RACES the refusal is caught immediately, not stranded until the next render', async () => {
		// The replacing window can land WHILE the RPC above is still in flight — the host flushes a
		// concurrent rebuild's rows independently of this call's reply. If the latch's baseline were read
		// only after the await, it would already see the replacement and never fire.
		const asks: { id: string | undefined; limit: number | undefined }[] = [];
		const fake = Object.create(proto) as GlGraphWrapper;

		priv(fake).graphState = { loading: false, rows: [] };
		priv(fake).services = {
			rows: Promise.resolve({
				getMoreRows: (id?: string, limit?: number) => {
					asks.push({ id: id, limit: limit });
					// The delivery happens DURING this call, before the 'superseded' outcome it's racing
					// even resolves — let alone before there is a latch to consume it.
					(priv(fake).graphState as { rows: unknown[] }).rows = [];
					return Promise.resolve(asks.length === 1 ? 'superseded' : 'added');
				},
			}),
		};
		const graph = {
			updateComplete: Promise.resolve(true),
			needsMoreRows: () => true,
			isConnected: true,
		};
		Object.defineProperty(fake, 'graph', { get: () => graph, configurable: true });
		priv(fake).getRepoFamily = () => '/repo';

		await proto['requestMoreRowsFromHost'].call(fake, undefined, 25);
		// The immediate consume still defers its re-check behind the graph's own update — no further
		// delivery is involved, this is only waiting out that microtask.
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.strictEqual(asks.length, 2, 'armed and consumed in the same request, with no delivery to wait for');
		assert.deepStrictEqual(asks[1], { id: undefined, limit: 25 }, 'and re-asks for the same page');
	});

	test('a refusal with NO delivery never re-asks — the taint case, and why a timer would spin', async () => {
		// A tainted window refuses every page until a repair rebuild lands. Nothing is delivered in the
		// meantime, so nothing may fire: this is the case that turns "re-ask shortly" into a hot loop of
		// refused RPCs for the length of the repair — unbounded if the repair walk itself fails.
		const { t, asks } = createFakeThis({ outcomes: ['superseded'], needsMoreRows: () => true });

		await proto['requestMoreRowsFromHost'].call(t, undefined, 25);
		// Several render cycles pass with no rows delivered.
		for (let i = 0; i < 5; i++) {
			proto['consumeSupersededPageRetry'].call(t);
			await new Promise(resolve => setTimeout(resolve, 0));
		}

		assert.strictEqual(asks.length, 1, 'exactly one ask, zero re-asks — the latch waits for a window');
	});

	test('N consecutive replacements are each recovered, one re-ask per delivered window', async () => {
		const { t, asks, deliverRows } = createFakeThis({
			outcomes: ['superseded', 'superseded', 'superseded', 'added'],
			needsMoreRows: () => true,
		});

		await proto['requestMoreRowsFromHost'].call(t, undefined, 25);
		await deliverRows();
		await deliverRows();
		await deliverRows();

		assert.strictEqual(asks.length, 4, 'three refusals, three deliveries, three re-asks, then it lands');
	});

	test('a user who scrolled away is NOT re-asked, even when a window is delivered', async () => {
		const { t, asks, deliverRows } = createFakeThis({ outcomes: ['superseded'], needsMoreRows: () => false });

		await proto['requestMoreRowsFromHost'].call(t, undefined, 25);
		await deliverRows();

		assert.strictEqual(asks.length, 1, 'the boundary check at consume time is what clears the latch');
	});

	test('a repo switch before the delivery drops the page', async () => {
		let repoFamily = '/repo';
		const { t, asks, deliverRows } = createFakeThis({
			outcomes: ['superseded'],
			needsMoreRows: () => true,
			repoFamily: () => repoFamily,
		});

		await proto['requestMoreRowsFromHost'].call(t, undefined, 25);
		repoFamily = '/other';
		await deliverRows();

		assert.strictEqual(
			asks.length,
			1,
			'the rows it was asked against are gone — re-asking would page the wrong repo',
		);
	});

	test('an added page arms nothing', async () => {
		const { t, asks, deliverRows } = createFakeThis({ outcomes: ['added'], needsMoreRows: () => true });

		await proto['requestMoreRowsFromHost'].call(t, undefined, 25);
		await deliverRows();

		assert.strictEqual(asks.length, 1);
	});

	test('a TARGETED page arms nothing — its own caller owns the retry', async () => {
		// `needsMoreRows()` is a statement about the scroll boundary and says nothing about whether a
		// specific row was reached, so it could never decide a targeted page's fate.
		const { t, asks, deliverRows } = createFakeThis({ outcomes: ['superseded'], needsMoreRows: () => true });

		await proto['requestMoreRowsFromHost'].call(t, 'a'.repeat(40), 0);
		await deliverRows();

		assert.strictEqual(asks.length, 1);
	});
});
