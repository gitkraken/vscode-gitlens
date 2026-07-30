import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import { ModifierKeysController } from '../modifier-keys.js';

type Listener = (e: unknown) => void;

class FakeEventTarget {
	private readonly listeners = new Map<string, Set<Listener>>();

	addEventListener(type: string, listener: Listener): void {
		let listeners = this.listeners.get(type);
		if (listeners == null) {
			listeners = new Set();
			this.listeners.set(type, listeners);
		}
		listeners.add(listener);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}

	count(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}

	dispatch(type: string, e?: unknown): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			listener(e ?? { type: type });
		}
	}
}

class FakeDocument extends FakeEventTarget {
	visibilityState = 'visible';
	focused = true;
	hasFocusCalls = 0;

	hasFocus = (): boolean => {
		this.hasFocusCalls++;
		return this.focused;
	};
}

/** Captures deferred callbacks so tests flush them explicitly, instead of racing a real timer. */
class FakeTimers {
	private readonly pending = new Map<number, () => void>();
	private nextId = 1;

	get pendingCount(): number {
		return this.pending.size;
	}

	readonly setTimeout = (callback: () => void): number => {
		const id = this.nextId++;
		this.pending.set(id, callback);
		return id;
	};

	readonly clearTimeout = (id: number): void => {
		this.pending.delete(id);
	};

	flush(): void {
		const callbacks = [...this.pending.values()];
		this.pending.clear();
		for (const callback of callbacks) {
			callback();
		}
	}
}

interface Harness {
	window: FakeEventTarget;
	document: FakeDocument;
	timers: FakeTimers;
	modifiers: ModifierKeysController;
	updates: number;
	altDown: () => void;
	dispose: () => void;
}

interface Globals {
	window?: unknown;
	document?: unknown;
	setTimeout?: unknown;
	clearTimeout?: unknown;
}

/**
 * Installs fake `window`/`document`/timer globals, then connects a controller against them. The
 * tracker only reaches for those globals from `_start()`/`_stop()` and its handlers, so swapping
 * them around `hostConnected()` is enough to drive it from a Node context with no DOM.
 */
function setup(): Harness {
	const globals = globalThis as unknown as Globals;
	const prior: Globals = {
		window: globals.window,
		document: globals.document,
		setTimeout: globals.setTimeout,
		clearTimeout: globals.clearTimeout,
	};

	const fakeWindow = new FakeEventTarget();
	const fakeDocument = new FakeDocument();
	const fakeTimers = new FakeTimers();
	globals.window = fakeWindow;
	globals.document = fakeDocument;
	globals.setTimeout = fakeTimers.setTimeout;
	globals.clearTimeout = fakeTimers.clearTimeout;

	const harness: Harness = {
		window: fakeWindow,
		document: fakeDocument,
		timers: fakeTimers,
		modifiers: undefined!,
		updates: 0,
		altDown: () =>
			fakeWindow.dispatch('keydown', {
				type: 'keydown',
				key: 'Alt',
				altKey: false,
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
			}),
		dispose: () => {
			harness.modifiers.hostDisconnected();
			globals.window = prior.window;
			globals.document = prior.document;
			globals.setTimeout = prior.setTimeout;
			globals.clearTimeout = prior.clearTimeout;
		},
	};

	const host: ReactiveControllerHost = {
		addController: () => undefined,
		removeController: () => undefined,
		requestUpdate: () => harness.updates++,
		updateComplete: Promise.resolve(true),
	};
	harness.modifiers = new ModifierKeysController(host);
	harness.modifiers.hostConnected();

	return harness;
}

suite('ModifierKeysController', () => {
	test('clears the modifiers when focus leaves the document', () => {
		const h = setup();
		try {
			assert.strictEqual(h.document.count('focusout'), 1, 'focusout listener should be attached');

			h.altDown();
			assert.strictEqual(h.modifiers.altKey, true);
			const updatesBefore = h.updates;

			h.document.focused = false;
			h.document.dispatch('focusout');
			h.timers.flush();

			assert.strictEqual(h.modifiers.altKey, false, 'alt should be released once focus left');
			assert.ok(h.updates > updatesBefore, 'hosts should be asked to update');
		} finally {
			h.dispose();
		}
	});

	test('keeps the modifiers when focus moves within the webview', () => {
		const h = setup();
		try {
			h.altDown();
			const updatesBefore = h.updates;

			// `focusout` fires for in-webview focus moves too (and with a null `relatedTarget` when a
			// non-focusable element is clicked) — the document still has focus, so nothing should reset.
			h.document.dispatch('focusout');
			h.timers.flush();

			assert.strictEqual(h.document.hasFocusCalls, 1, 'focus should have been re-verified');
			assert.strictEqual(h.modifiers.altKey, true, 'alt should survive an in-webview focus move');
			assert.strictEqual(h.updates, updatesBefore, 'no update should be requested');
		} finally {
			h.dispose();
		}
	});

	test('coalesces a burst of focusout events into a single check', () => {
		const h = setup();
		try {
			h.altDown();
			h.document.focused = false;
			h.document.dispatch('focusout');
			h.document.dispatch('focusout');
			h.document.dispatch('focusout');

			assert.strictEqual(h.timers.pendingCount, 1, 'only one deferred check should be scheduled');

			h.timers.flush();
			assert.strictEqual(h.document.hasFocusCalls, 1);
			assert.strictEqual(h.modifiers.altKey, false);
		} finally {
			h.dispose();
		}
	});

	test('stops listening and cancels a pending check once the last host disconnects', () => {
		const h = setup();
		h.altDown();
		h.document.focused = false;
		h.document.dispatch('focusout');
		assert.strictEqual(h.timers.pendingCount, 1);

		h.dispose();

		assert.strictEqual(h.timers.pendingCount, 0, 'the pending check should have been cancelled');
		assert.strictEqual(h.document.count('focusout'), 0, 'the listener should have been removed');
		assert.strictEqual(h.modifiers.altKey, false);
	});

	test('still clears on backgrounding', () => {
		const h = setup();
		try {
			h.altDown();
			h.document.visibilityState = 'hidden';
			h.document.dispatch('visibilitychange');

			assert.strictEqual(h.modifiers.altKey, false);
		} finally {
			h.dispose();
		}
	});
});
