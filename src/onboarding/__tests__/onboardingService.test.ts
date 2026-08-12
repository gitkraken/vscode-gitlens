import * as assert from 'assert';
import '../../container.js';
import type { Storage } from '../../system/-webview/storage.js';
import { OnboardingService } from '../onboardingService.js';

type Backing = Map<string, unknown>;

function createFakeStorage(backing: Backing, onStore?: () => void): Storage {
	const clone = <T>(value: T): T => (value == null ? value : structuredClone(value));
	const fake = {
		onDidChange: () => ({ dispose: () => {} }),
		get: (key: string): unknown => clone(backing.get(`global|${key}`)),
		getWorkspace: (key: string): unknown => clone(backing.get(`workspace|${key}`)),
		store: (key: string, value: unknown): Promise<void> => {
			onStore?.();
			if (value === undefined) {
				backing.delete(`global|${key}`);
			} else {
				backing.set(`global|${key}`, clone(value));
			}

			return Promise.resolve();
		},
		storeWorkspace: (key: string, value: unknown): Promise<void> => {
			onStore?.();
			if (value === undefined) {
				backing.delete(`workspace|${key}`);
			} else {
				backing.set(`workspace|${key}`, clone(value));
			}

			return Promise.resolve();
		},
		delete: (key: string): Promise<void> => {
			backing.delete(`global|${key}`);

			return Promise.resolve();
		},
	};
	return fake as unknown as Storage;
}

suite('OnboardingService Test Suite', () => {
	test('dismissal persists across service instances (window reload)', async () => {
		const backing: Backing = new Map();

		const first = new OnboardingService(createFakeStorage(backing), '19.0.0');
		await first.ready;
		await first.dismiss('graph:intro');
		first.dispose();

		const second = new OnboardingService(createFakeStorage(backing), '19.0.0');
		await second.ready;
		try {
			assert.strictEqual(second.isDismissed('graph:intro'), true);
		} finally {
			second.dispose();
		}
	});

	test('a write from a window activated before a dismissal must not resurrect it', async () => {
		const backing: Backing = new Map();

		const windowA = new OnboardingService(createFakeStorage(backing), '19.0.0');
		await windowA.ready;
		windowA.dispose();

		const windowB = new OnboardingService(createFakeStorage(backing), '19.0.0');
		await windowB.ready;
		await windowB.dismiss('graph:intro');
		windowB.dispose();

		await windowA.dismiss('graph:coachMark:details');

		const windowC = new OnboardingService(createFakeStorage(backing), '19.0.0');
		await windowC.ready;
		try {
			assert.strictEqual(
				windowC.isDismissed('graph:intro'),
				true,
				"window A's stale write resurrected graph:intro",
			);
			assert.strictEqual(windowC.isDismissed('graph:coachMark:details'), true);
		} finally {
			windowC.dispose();
		}
	});

	test('activation of an already-migrated state does not write', async () => {
		const backing: Backing = new Map();
		let stores = 0;

		const first = new OnboardingService(
			createFakeStorage(backing, () => stores++),
			'19.0.0',
		);
		await first.ready;
		first.dispose();
		assert.ok(stores > 0, 'the initial migration should persist its completion marker');

		stores = 0;
		const second = new OnboardingService(
			createFakeStorage(backing, () => stores++),
			'19.0.0',
		);
		await second.ready;
		second.dispose();
		assert.strictEqual(stores, 0, 'an already-migrated activation should not rewrite the state');
	});
});
