import * as assert from 'assert';
import type { FeatureAccess } from '../../../../../features.js';
import type { RepositoryShape } from '../../../../../git/models/repositoryShape.js';
import type { TimelineDatasetResult, TimelineScopeSerialized } from '../../../../plus/timeline/protocol.js';
import { InMemoryStorage } from '../../../shared/host/storage.js';
import { TimelineActions } from '../actions.js';
import { createTimelineState } from '../state.js';

function createSignal<T>(initial: T): { get: () => T; set: (value: T) => void } {
	let value = initial;
	return {
		get: () => value,
		set: next => {
			value = next;
		},
	};
}

function createDatasetResource(
	state: ReturnType<typeof createTimelineState>,
	onFetch: (scope: TimelineScopeSerialized | undefined) => TimelineDatasetResult | undefined,
) {
	const status = createSignal<'idle' | 'success' | 'error'>('idle');
	const value = createSignal<TimelineDatasetResult | undefined>(undefined);
	const error = createSignal<string | undefined>(undefined);

	return {
		status: status,
		value: value,
		error: error,
		loading: createSignal(false),
		generationId: createSignal(0),
		cancel: () => {},
		mutate: (next: TimelineDatasetResult | undefined) => value.set(next),
		fetch: async () => {
			value.set(onFetch(state.scope.get()));
			status.set('success');
			error.set(undefined);
		},
	};
}

suite('TimelineActions', () => {
	test('should prefer the host scope over the persisted scope on initial load', async () => {
		const state = createTimelineState(new InMemoryStorage());
		const persistedScope: TimelineScopeSerialized = {
			type: 'file',
			uri: 'file:///persisted.ts',
			relativePath: 'persisted.ts',
		};
		const hostScope: TimelineScopeSerialized = {
			type: 'file',
			uri: 'file:///active.ts',
			relativePath: 'active.ts',
		};
		state.scope.set(persistedScope);

		let fetchedScope: TimelineScopeSerialized | undefined;
		const resource = createDatasetResource(state, scope => {
			fetchedScope = scope;
			return {
				dataset: [],
				scope: scope!,
				repository: undefined as unknown as RepositoryShape & { ref: undefined },
				access: { allowed: true } as unknown as FeatureAccess,
			};
		});

		const actions = new TimelineActions(
			state,
			{
				telemetry: { updateContext: () => Promise.resolve(), sendEvent: () => Promise.resolve() },
				repositories: {
					getRepositoriesState: async () => ({ count: 1, openCount: 1 }),
				},
			} as any,
			{
				getInitialContext: async () => ({
					scope: hostScope,
					configOverrides: undefined,
					displayConfig: {
						abbreviatedShaLength: 7,
						dateFormat: '',
						shortDateFormat: '',
						currentUserNameStyle: 'nameAndYou' as const,
					},
				}),
			} as any,
			{ onRepositoryWorkingChanged: () => () => {} } as any,
			resource as any,
		);

		await actions.populateInitialState();

		assert.deepStrictEqual(fetchedScope, hostScope);
		assert.deepStrictEqual(state.scope.get(), hostScope);
	});

	test('should fall back to the persisted scope when the host has no scope', async () => {
		const state = createTimelineState(new InMemoryStorage());
		const persistedScope: TimelineScopeSerialized = {
			type: 'repo',
			uri: 'file:///repo',
			relativePath: '',
		};
		state.scope.set(persistedScope);

		let fetchedScope: TimelineScopeSerialized | undefined;
		const resource = createDatasetResource(state, scope => {
			fetchedScope = scope;
			return {
				dataset: [],
				scope: scope!,
				repository: undefined as unknown as RepositoryShape & { ref: undefined },
				access: { allowed: true } as unknown as FeatureAccess,
			};
		});

		const actions = new TimelineActions(
			state,
			{
				telemetry: { updateContext: () => Promise.resolve(), sendEvent: () => Promise.resolve() },
				repositories: {
					getRepositoriesState: async () => ({ count: 1, openCount: 1 }),
				},
			} as any,
			{
				getInitialContext: async () => ({
					scope: undefined,
					configOverrides: undefined,
					displayConfig: {
						abbreviatedShaLength: 7,
						dateFormat: '',
						shortDateFormat: '',
						currentUserNameStyle: 'nameAndYou' as const,
					},
				}),
			} as any,
			{ onRepositoryWorkingChanged: () => () => {} } as any,
			resource as any,
		);

		await actions.populateInitialState();

		assert.deepStrictEqual(fetchedScope, persistedScope);
		assert.deepStrictEqual(state.scope.get(), persistedScope);
	});

	test('should send config telemetry with the effective timeline config', async () => {
		const state = createTimelineState(new InMemoryStorage());
		state.scope.set({
			type: 'repo',
			uri: 'file:///repo',
			relativePath: '',
		});

		const telemetryEvents: Array<{ name: string; data: Record<string, unknown> | undefined }> = [];
		const actions = new TimelineActions(
			state,
			{
				telemetry: Promise.resolve({
					updateContext: () => Promise.resolve(),
					sendEvent: (name: string, data?: Record<string, unknown>) => {
						telemetryEvents.push({ name: name, data: data });
						return Promise.resolve();
					},
				}),
				repositories: {
					getRepositoriesState: async () => ({ count: 1, openCount: 1 }),
				},
			} as any,
			{} as any,
			{ onRepositoryWorkingChanged: () => () => {} } as any,
			createDatasetResource(state, () => undefined) as any,
		);

		actions.changeSliceBy('branch');
		await Promise.resolve();

		assert.deepStrictEqual(telemetryEvents, [
			{
				name: 'timeline/config/changed',
				data: { period: state.period.get(), showAllBranches: true, sliceBy: 'branch' },
			},
		]);
		assert.strictEqual(state.showAllBranches.get(), true);
	});
});
