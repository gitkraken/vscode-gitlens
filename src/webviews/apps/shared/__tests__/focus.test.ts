import * as assert from 'assert';
import * as sinon from 'sinon';
import { createFocusTracker } from '../focus.js';

suite('createFocusTracker', () => {
	let clock: sinon.SinonFakeTimers;
	let hasFocus: boolean;
	const globals = globalThis as unknown as { document?: unknown };
	let previousDocument: unknown;

	setup(() => {
		clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		previousDocument = globals.document;
		hasFocus = true;
		globals.document = { hasFocus: () => hasFocus };
	});

	teardown(() => {
		clock.restore();
		globals.document = previousDocument;
	});

	const focusEvent = { composedPath: () => [] } as unknown as FocusEvent;

	test('focus coming back after a blur is sent again', () => {
		const sent: boolean[] = [];
		const focus = createFocusTracker(params => sent.push(params.focused));

		focus.onFocusIn(focusEvent);
		clock.tick(200);

		hasFocus = false;
		focus.onFocusOut(focusEvent);
		clock.tick(200);

		hasFocus = true;
		focus.onFocusIn(focusEvent);
		clock.tick(200);

		hasFocus = false;
		focus.onFocusOut(focusEvent);
		clock.tick(200);

		assert.deepStrictEqual(sent, [true, false, true, false]);
	});

	test('a focusout inside the webview that keeps the document focused is not a blur', () => {
		const sent: boolean[] = [];
		const focus = createFocusTracker(params => sent.push(params.focused));

		focus.onFocusIn(focusEvent);
		clock.tick(200);
		focus.onFocusOut(focusEvent);
		clock.tick(200);
		focus.onFocusIn(focusEvent);
		clock.tick(200);

		assert.deepStrictEqual(sent, [true, true]);
	});
});
