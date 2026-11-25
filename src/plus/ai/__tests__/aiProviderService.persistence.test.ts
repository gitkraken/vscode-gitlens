import * as assert from 'assert';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { Container } from '../../../container.js';
import { AIProviderService } from '../aiProviderService.js';

suite('AIProviderService — scoped model persistence', () => {
	function makeModel(id: string): AIModel {
		return { id: id, name: id, provider: { id: 'openai', name: 'OpenAI' } } as unknown as AIModel;
	}

	function makeFakes(options: { stored?: Record<string, string>; current?: AIModel }) {
		const storage = new Map<string, unknown>(Object.entries(options.stored ?? {}));
		const stores: { key: string; value: unknown }[] = [];
		const events: { model: AIModel | undefined; scope: string | undefined }[] = [];

		const fakeThis = Object.assign(Object.create(AIProviderService.prototype) as object, {
			container: {
				storage: {
					get: (key: string) => storage.get(key),
					store: (key: string, value: unknown) => {
						storage.set(key, value);
						stores.push({ key: key, value: value });
						return Promise.resolve();
					},
				},
			} as unknown as Container,
			// KEEP: same provider as the models, so getOrUpdateModel never constructs a real one
			_provider: { id: 'openai' },
			_model: options.current,
			_modelCache: new Map(),
			_onDidChangeModel: {
				fire: (e: { model: AIModel | undefined; scope: string | undefined }) => events.push(e),
			},
		});

		return { fakeThis: fakeThis, storage: storage, stores: stores, events: events };
	}

	function pick(fakeThis: object, model: AIModel, scope: string) {
		return (
			AIProviderService.prototype as unknown as {
				getOrUpdateModel: (model: AIModel, options: { scope: string; persist: boolean }) => Promise<unknown>;
			}
		).getOrUpdateModel.call(fakeThis, model, { scope: scope, persist: true });
	}

	test('persists a pick for a scope even when another scope just resolved the same model (#6332)', async () => {
		const modelB = makeModel('gpt-4o');
		const { fakeThis, storage, stores, events } = makeFakes({
			stored: { 'ai:scope:review:model': 'openai:gpt-4o' },
			current: modelB,
		});

		await pick(fakeThis, modelB, 'compose');

		assert.strictEqual(storage.get('ai:scope:compose:model'), 'openai:gpt-4o');
		assert.deepStrictEqual(
			stores.map(s => s.key),
			['ai:scope:compose:model'],
		);
		assert.strictEqual(storage.get('ai:scope:review:model'), 'openai:gpt-4o');
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].scope, 'compose');
	});

	test('re-picking the already-stored model neither writes nor fires', async () => {
		const modelB = makeModel('gpt-4o');
		const { fakeThis, stores, events } = makeFakes({
			stored: { 'ai:scope:compose:model': 'openai:gpt-4o' },
			current: modelB,
		});

		await pick(fakeThis, modelB, 'compose');

		assert.strictEqual(stores.length, 0);
		assert.strictEqual(events.length, 0);
	});

	test('re-picking the stored model does not write even when the singleton differs', async () => {
		const modelB = makeModel('gpt-4o');
		const { fakeThis, stores } = makeFakes({
			stored: { 'ai:scope:compose:model': 'openai:gpt-4o' },
			current: makeModel('gpt-4o-mini'),
		});

		await pick(fakeThis, modelB, 'compose');

		assert.strictEqual(stores.length, 0);
	});
});
