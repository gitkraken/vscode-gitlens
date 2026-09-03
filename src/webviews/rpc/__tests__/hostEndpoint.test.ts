import * as assert from 'assert';
import type { Disposable, Webview } from 'vscode';
import type { RpcMessageWrapper } from '../constants.js';
import { decodeRpcPayload, inflateRpcPayload, isRpcMessage } from '../constants.js';
import { createHostEndpoint } from '../hostEndpoint.js';

/** A single unbatched Supertalk message as buffered by {@link createHostEndpoint}. */
interface TestMessage {
	type: string;
	wireType?: string;
	payload?: unknown;
}

/** Supertalk's `type: 'batch'` envelope, as posted by {@link createHostEndpoint}'s flush. */
interface TestBatchMessage {
	type: 'batch';
	messages: TestMessage[];
}

/**
 * Mock `Webview` that records every posted message and decodes it back to the
 * flat list of individual Supertalk messages it contains (unwrapping the RPC
 * namespace and, if present, the `type: 'batch'` envelope).
 */
function createRecordingWebview(): { webview: Webview; flushes: TestMessage[][]; posted: RpcMessageWrapper[] } {
	const flushes: TestMessage[][] = [];
	const posted: RpcMessageWrapper[] = [];

	const webview: Pick<Webview, 'postMessage' | 'onDidReceiveMessage'> = {
		postMessage: function (message: unknown): Thenable<boolean> {
			if (!isRpcMessage(message)) return Promise.resolve(false);

			posted.push(message);

			// Compressed payloads need an async inflate the recording can't do synchronously here;
			// compression tests decode from `posted` directly instead.
			if (message.compressed != null) return Promise.resolve(true);

			const payload = message.payload;
			const data =
				payload instanceof Uint8Array || payload instanceof ArrayBuffer ? decodeRpcPayload(payload) : payload;

			const decoded = data as TestMessage | TestBatchMessage;
			flushes.push(isBatchMessage(decoded) ? decoded.messages : [decoded]);
			return Promise.resolve(true);
		},
		onDidReceiveMessage: function (): Disposable {
			return { dispose: () => {} };
		},
	};

	return { webview: webview as Webview, flushes: flushes, posted: posted };
}

function isBatchMessage(msg: TestMessage | TestBatchMessage): msg is TestBatchMessage {
	return msg.type === 'batch';
}

suite('createHostEndpoint Test Suite', () => {
	suite('hidden-webview buffering', () => {
		test('delivers st:ch: handler messages in order and count while other handler wireTypes stay deduped', () => {
			const { webview, flushes } = createRecordingWebview();
			const endpoint = createHostEndpoint(webview);

			endpoint.setVisible(false);

			const channelCount = 5;
			for (let i = 0; i < channelCount; i++) {
				endpoint.postMessage({ type: 'handler', wireType: 'st:ch:test', payload: i });
			}

			const otherCount = 3;
			for (let i = 0; i < otherCount; i++) {
				endpoint.postMessage({ type: 'handler', wireType: 'other', payload: i });
			}

			assert.strictEqual(flushes.length, 0, 'nothing should post while hidden');

			endpoint.setVisible(true);

			assert.strictEqual(flushes.length, 1, 'visibility restore should flush exactly one batch');
			const messages = flushes[0];

			// FIFO queue (the channel messages) flushes before the deduped handler map (the "other" wireType).
			const channelMessages = messages.filter(m => m.wireType === 'st:ch:test');
			const otherMessages = messages.filter(m => m.wireType === 'other');

			assert.strictEqual(channelMessages.length, channelCount, 'all channel messages must survive, in order');
			assert.deepStrictEqual(
				channelMessages.map(m => m.payload),
				[0, 1, 2, 3, 4],
			);

			assert.strictEqual(otherMessages.length, 1, 'non-channel handler wireTypes stay last-write-wins deduped');
			assert.strictEqual(otherMessages[0].payload, otherCount - 1);

			// FIFO-before-handlerMap: the channel messages (FIFO) precede the deduped "other" message.
			assert.strictEqual(messages.at(-1)?.wireType, 'other');

			endpoint.dispose();
		});

		test('dedupes non-channel handler messages by wireType while hidden (existing behavior unchanged)', () => {
			const { webview, flushes } = createRecordingWebview();
			const endpoint = createHostEndpoint(webview);

			endpoint.setVisible(false);
			endpoint.postMessage({ type: 'handler', wireType: 'signal', payload: 'first' });
			endpoint.postMessage({ type: 'handler', wireType: 'signal', payload: 'second' });
			endpoint.postMessage({ type: 'handler', wireType: 'signal', payload: 'third' });
			endpoint.setVisible(true);

			assert.strictEqual(flushes.length, 1);
			const messages = flushes[0];
			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].payload, 'third');

			endpoint.dispose();
		});
	});

	suite('compression', () => {
		test('compresses a large message when compress is forced on', async () => {
			const { webview, posted } = createRecordingWebview();
			const endpoint = createHostEndpoint(webview, { compress: true });

			const message = { type: 'call', payload: 'x'.repeat(4096) };
			endpoint.postMessage(message);

			assert.strictEqual(posted.length, 1);
			const wrapped = posted[0];
			assert.strictEqual(wrapped.compressed, 'deflate-raw');
			assert.ok(wrapped.payload instanceof Uint8Array);

			const encoded = new TextEncoder().encode(JSON.stringify(message));
			assert.ok(wrapped.payload.byteLength < encoded.byteLength);
			assert.strictEqual(wrapped.byteLength, wrapped.payload.byteLength);

			const inflated = await inflateRpcPayload(wrapped.payload);
			assert.deepStrictEqual(inflated, message);

			endpoint.dispose();
		});

		test('does not compress a small message even when compress is forced on', () => {
			const { webview, posted } = createRecordingWebview();
			const endpoint = createHostEndpoint(webview, { compress: true });

			endpoint.postMessage({ type: 'call', payload: 'tiny' });

			assert.strictEqual(posted.length, 1);
			assert.strictEqual(posted[0].compressed, undefined);
			assert.ok(posted[0].payload instanceof Uint8Array);
			assert.strictEqual(posted[0].byteLength, posted[0].payload.byteLength);

			endpoint.dispose();
		});

		test('does not compress a large message with default options (no remote host)', () => {
			const { webview, posted } = createRecordingWebview();
			const endpoint = createHostEndpoint(webview);

			endpoint.postMessage({ type: 'call', payload: 'x'.repeat(4096) });

			assert.strictEqual(posted.length, 1);
			assert.strictEqual(posted[0].compressed, undefined);
			assert.ok(posted[0].payload instanceof Uint8Array);
			assert.strictEqual(posted[0].byteLength, posted[0].payload.byteLength);

			endpoint.dispose();
		});
	});
});
