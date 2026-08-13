import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately: `system/-webview/command.ts` (pulled in by
// the service) imports `container.ts` as a value, and container's own import fan-out reaches the
// command classes whose `@command()` decorator reads a registry that module is still initializing.
// Letting container initialize first breaks the cycle; without it the bundle throws on load.
import '../../container.js';
import { EventEmitter } from 'vscode';
import type { Storage, StorageChangeEvent } from '../../system/-webview/storage.js';
import type { OnboardingStorage } from '../models/onboarding.js';
import type { OnboardingChangeEvent } from '../onboardingService.js';
import { OnboardingService } from '../onboardingService.js';

/**
 * Minimal in-memory fake of {@link Storage}. Two backing Maps (global/workspace) can be shared
 * across fakes to model multiple windows reading/writing the same underlying VS Code storage.
 * Each fake gets its own `onDidChange` emitter — separate windows run separate extension host
 * processes and never observe each other's storage-change events, only each other's persisted
 * writes (picked up on the next fresh read).
 */
function createFakeStorage(
	globalMap: Map<string, unknown>,
	workspaceMap: Map<string, unknown>,
	onStore?: () => void,
	options?: { revertFirstStoreOf?: string },
): Storage {
	const emitter = new EventEmitter<StorageChangeEvent>();
	let reverted = false;
	// Deep snapshot of the last committed value for the revert simulation — the service mutates the
	// object it read in place, so restoring the live `prior` reference would be a no-op
	const committed =
		options?.revertFirstStoreOf != null ? structuredClone(globalMap.get(options.revertFirstStoreOf)) : undefined;

	const fake = {
		get: (key: string) => globalMap.get(key),
		store: (key: string, value: unknown) => {
			if (value === undefined) {
				globalMap.delete(key);
			} else {
				globalMap.set(key, value);
			}

			// Simulates the churn revert: the update "resolves" but a stale broadcast clobbers the
			// value back to the previously-committed snapshot before the caller's verify read
			if (key === options?.revertFirstStoreOf && !reverted) {
				reverted = true;
				if (committed === undefined) {
					globalMap.delete(key);
				} else {
					globalMap.set(key, committed);
				}
			}

			onStore?.();
			emitter.fire({ keys: [key], type: 'global' } as unknown as StorageChangeEvent);
			return Promise.resolve();
		},
		getWorkspace: (key: string) => workspaceMap.get(key),
		storeWorkspace: (key: string, value: unknown) => {
			if (value === undefined) {
				workspaceMap.delete(key);
			} else {
				workspaceMap.set(key, value);
			}

			emitter.fire({ keys: [key], type: 'workspace' } as unknown as StorageChangeEvent);
			return Promise.resolve();
		},
		delete: (key: string) => {
			globalMap.delete(key);
			emitter.fire({ keys: [key], type: 'global' } as unknown as StorageChangeEvent);
			return Promise.resolve();
		},
		onDidChange: emitter.event,
	};

	return fake as unknown as Storage;
}

suite('OnboardingService Test Suite', () => {
	test('cross-window dismissal survives a stale window writing a different item', async () => {
		const globalMap = new Map<string, unknown>();
		const workspaceMap = new Map<string, unknown>();

		const serviceA = new OnboardingService(createFakeStorage(globalMap, workspaceMap), '19.0.0', {
			registerCommands: false,
		});
		await serviceA.ready;

		const serviceB = new OnboardingService(createFakeStorage(globalMap, workspaceMap), '19.0.0', {
			registerCommands: false,
		});
		await serviceB.ready;

		await serviceA.dismiss('graph:intro');

		// B never saw A's dismiss (no cache, no cross-window event) — this writes its own item to a
		// fresh read of the same blob, which must not clobber A's dismissal
		await serviceB.setItemState('graph:coachMarks', { seen: { details: true } });

		const stored = globalMap.get('onboarding:state') as OnboardingStorage;
		assert.ok(stored.items['graph:intro']?.dismissedAt != null, 'graph:intro dismissal should survive');
		assert.strictEqual(serviceB.isDismissed('graph:intro'), true);

		serviceA.dispose();
		serviceB.dispose();
	});

	test('does not write on activation when already migrated', async () => {
		const migratedState: OnboardingStorage = { items: {}, migratedVersion: '17.9.0' };
		const globalMap = new Map<string, unknown>([['onboarding:state', migratedState]]);
		const workspaceMap = new Map<string, unknown>();

		let storeCount = 0;
		const service = new OnboardingService(
			createFakeStorage(globalMap, workspaceMap, () => storeCount++),
			'19.0.0',
			{ registerCommands: false },
		);
		await service.ready;

		assert.strictEqual(storeCount, 0, 'store should not be called when nothing needs migrating');

		service.dispose();
	});

	test('dismiss fires onDidChange once and flips isDismissed', async () => {
		const globalMap = new Map<string, unknown>();
		const workspaceMap = new Map<string, unknown>();

		const service = new OnboardingService(createFakeStorage(globalMap, workspaceMap), '19.0.0', {
			registerCommands: false,
		});
		await service.ready;

		assert.strictEqual(service.isDismissed('graph:intro'), false);

		const events: OnboardingChangeEvent[] = [];
		service.onDidChange(e => events.push(e));

		await service.dismiss('graph:intro');

		assert.strictEqual(events.length, 1, 'onDidChange should fire exactly once');
		assert.deepStrictEqual(events[0], { key: 'graph:intro', dismissed: true });
		assert.strictEqual(service.isDismissed('graph:intro'), true);

		service.dispose();
	});

	test('dismiss survives a write that gets reverted before the verify read', async () => {
		// Seeded as already-migrated so construction writes nothing and the one-shot revert hits the dismiss
		const migratedState: OnboardingStorage = { items: {}, migratedVersion: '17.9.0' };
		const globalMap = new Map<string, unknown>([['onboarding:state', migratedState]]);
		const workspaceMap = new Map<string, unknown>();

		let storeCount = 0;
		const service = new OnboardingService(
			createFakeStorage(globalMap, workspaceMap, () => storeCount++, { revertFirstStoreOf: 'onboarding:state' }),
			'19.0.0',
			{ registerCommands: false },
		);
		await service.ready;

		const storesBefore = storeCount;
		await service.dismiss('graph:intro');

		assert.strictEqual(storeCount, storesBefore + 2, 'the reverted write should be retried exactly once');
		const stored = globalMap.get('onboarding:state') as OnboardingStorage;
		assert.ok(stored.items['graph:intro']?.dismissedAt != null, 'the retried write should persist the dismissal');
		assert.strictEqual(service.isDismissed('graph:intro'), true);

		service.dispose();
	});

	test('reset fires onDidChange with dismissed: false and flips isDismissed back', async () => {
		const globalMap = new Map<string, unknown>();
		const workspaceMap = new Map<string, unknown>();

		const service = new OnboardingService(createFakeStorage(globalMap, workspaceMap), '19.0.0', {
			registerCommands: false,
		});
		await service.ready;

		await service.dismiss('graph:intro');
		assert.strictEqual(service.isDismissed('graph:intro'), true);

		const events: OnboardingChangeEvent[] = [];
		service.onDidChange(e => events.push(e));

		await service.reset('graph:intro');

		assert.strictEqual(events.length, 1, 'onDidChange should fire exactly once');
		assert.deepStrictEqual(events[0], { key: 'graph:intro', dismissed: false });
		assert.strictEqual(service.isDismissed('graph:intro'), false);

		service.dispose();
	});
});
