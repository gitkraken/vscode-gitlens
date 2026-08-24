import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import { JumpToastController } from '../jumpToastController.js';
import { OverviewBarController } from '../overviewBarController.js';

/**
 * The app shell wires several controller methods directly as Lit event listeners
 * (`@gl-graph-navigation-failed=${this.jumpToast.onNavigationFailed}` and friends). Lit invokes a
 * plain-function listener with the HOST element as its receiver, so any handler that isn't bound —
 * i.e. any prototype method rather than an arrow-field — throws the moment its event fires. These
 * handlers were prototype methods once; this locks in the bound-ness so the next extraction can't
 * silently reintroduce it.
 *
 * A handler is "bound" iff it's an OWN property of the instance (arrow class field). A prototype
 * method resolves off the prototype and would be invoked with the wrong receiver.
 */
function assertListenerBound(instance: object, method: string): void {
	assert.ok(
		Object.hasOwn(instance, method),
		`${method} must be a bound (own, arrow-field) property — a prototype method would be invoked by Lit with the host element as its receiver`,
	);
}

suite('graph app controller listeners', () => {
	test('binds every controller method the shell wires as a Lit listener', () => {
		const fakeHost = {
			addController: () => {},
			removeController: () => {},
			requestUpdate: () => {},
			updateComplete: Promise.resolve(true),
		};
		// Minimal stand-ins: only construction runs here — the bound-ness contract is what's under
		// test, not handler behavior.
		const jumpToast = new JumpToastController(
			fakeHost as unknown as ReactiveControllerHost & EventTarget,
			{ graph: () => undefined } as unknown as never,
		);
		const overviewBar = new OverviewBarController(fakeHost, {
			graphState: () => undefined,
			graph: () => undefined,
			scopeToBranchByName: () => Promise.resolve(),
			fetchSelectedWorktreeWipStats: () => Promise.resolve(),
		} as unknown as never);

		for (const method of ['onNavigationLoading', 'onNavigationFailed', 'onEdgeSearch']) {
			assertListenerBound(jumpToast, method);
		}
		for (const method of ['onJump', 'onSelect', 'onFocus', 'onStatsNeeded']) {
			assertListenerBound(overviewBar, method);
		}
	});
});
