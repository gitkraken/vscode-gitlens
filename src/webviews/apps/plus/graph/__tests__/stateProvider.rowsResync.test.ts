import * as assert from 'assert';
import type { ChannelGap } from '@eamodio/supertalk-core/handlers/channel.js';
import * as sinon from 'sinon';
import { GraphStateProvider } from '../stateProvider.js';

// Exercises the `resyncRows` in-flight guard directly against a fake `this` — same fake-this +
// call-through-the-prototype approach as `graphProducersService.upstreamMetadata.test.ts` and the
// WIP-stats supersession suite above in `stateProvider.test.ts`. A real provider needs a live webview
// host to construct, and neither `resyncRows` nor `onRowsGap` reach outside the fields below.

type FakeThis = {
	_rowsService: { resyncRows: sinon.SinonStub } | undefined;
	_resyncInFlight: boolean;
	_resyncRetryTimer: ReturnType<typeof setTimeout> | undefined;
	_rowsGapCount: number;
	logger: { info: sinon.SinonStub };
	resyncRows: (retry?: boolean) => void;
	onRowsGap: (gap: ChannelGap) => void;
};

const proto = GraphStateProvider.prototype as unknown as {
	resyncRows: (this: FakeThis, retry?: boolean) => void;
	onRowsGap: (this: FakeThis, gap: ChannelGap) => void;
};

function createFakeThis(resyncStub: sinon.SinonStub): FakeThis {
	const fakeThis: FakeThis = {
		_rowsService: { resyncRows: resyncStub },
		_resyncInFlight: false,
		_resyncRetryTimer: undefined,
		_rowsGapCount: 0,
		logger: { info: sinon.stub() },
		resyncRows: function (retry?: boolean): void {
			proto.resyncRows.call(fakeThis, retry);
		},
		onRowsGap: function (gap: ChannelGap): void {
			proto.onRowsGap.call(fakeThis, gap);
		},
	};
	return fakeThis;
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

suite('GraphStateProvider.resyncRows in-flight guard Test Suite', () => {
	test('overlapping resync triggers produce one RPC call', async () => {
		let resolveRpc!: () => void;
		const resyncStub = sinon.stub().returns(
			new Promise<void>(resolve => {
				resolveRpc = resolve;
			}),
		);
		const fakeThis = createFakeThis(resyncStub);

		// A channel gap and a splice-guard failure (or a second gap) can fire in the same tick;
		// every resync re-snapshots, so the duplicates must be dropped, not queued.
		fakeThis.resyncRows();
		fakeThis.resyncRows();
		fakeThis.resyncRows();

		assert.strictEqual(resyncStub.callCount, 1, 'a resync already in flight must not fire another RPC call');

		resolveRpc();
		await flushMicrotasks();
	});

	test('a failed resync arms one retry, and a subsequent success clears it', async () => {
		const sandbox = sinon.createSandbox();
		const clock = sandbox.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			const resyncStub = sinon.stub();
			resyncStub.onCall(0).rejects(new Error('boom'));
			resyncStub.onCall(1).resolves();
			const fakeThis = createFakeThis(resyncStub);

			fakeThis.resyncRows();
			await flushMicrotasks();

			assert.strictEqual(fakeThis._resyncInFlight, false, 'the guard must clear on failure too');
			assert.notStrictEqual(fakeThis._resyncRetryTimer, undefined, 'a failed resync arms a retry timer');

			clock.tick(2000);
			await flushMicrotasks();

			assert.strictEqual(resyncStub.callCount, 2, 'the retry fires exactly once');
			assert.strictEqual(fakeThis._resyncRetryTimer, undefined, 'a successful resync clears the retry timer');
			assert.strictEqual(fakeThis._resyncInFlight, false);
		} finally {
			sandbox.restore();
		}
	});

	test('onRowsGap routes to resync', () => {
		const resyncStub = sinon.stub().returns(new Promise<void>(() => {}));
		const fakeThis = createFakeThis(resyncStub);

		fakeThis.onRowsGap({ generation: 1, expected: 2, received: 4 });

		assert.strictEqual(fakeThis._rowsGapCount, 1);
		assert.strictEqual(resyncStub.callCount, 1);
	});
});
