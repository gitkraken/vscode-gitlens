import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see the same import in `runPromptInAgent.test.ts`
import '../../container.js';
import * as sinon from 'sinon';
import { commands, Uri } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { Container } from '../../container.js';
import { openExplainDocument } from '../explainBase.js';

// #5781: an explain request's AI failure arrives as a rejected `aiPromise` (`throwAIErrors`), and a cancel as
// 'cancelled'. The document that opened as "Generating…" must land on the matching ending, never stay loading.
suite('openExplainDocument — how the loading document ends', () => {
	const model = { id: 'm', name: 'Model', provider: { id: 'gitkraken', name: 'GitKraken AI' } } as unknown as AIModel;
	const metadata = { header: { title: 'Explain', subtitle: 'sub' } };

	setup(() => {
		// Keeps the preview open from reaching VS Code; its own outcome isn't what these tests are about
		sinon.stub(commands, 'executeCommand').resolves(undefined);
	});
	teardown(() => {
		sinon.restore();
	});

	function open(aiPromise: Promise<never>) {
		const updates: string[] = [];
		const documentUri = Uri.parse('gitlens-markdown:explain');
		const container = {
			telemetry: { enabled: false },
			markdown: {
				openDocument: () => documentUri,
				updateDocument: (_uri: Uri, content: string) => {
					updates.push(content);
				},
			},
			aiFeedback: { setMarkdownDocument: () => {} },
		} as unknown as Container;

		openExplainDocument(container, aiPromise, '/explain/path', model, 'explain-commit', metadata);
		return updates;
	}

	const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	test('leaves the loading document alone while the request is in flight', async () => {
		const updates = open(new Promise(() => {}));
		await settle();

		assert.deepStrictEqual(updates, [], 'nothing replaces the loading document until the request ends');
	});

	test('a rejected request (an AI failure) ends as Generation Failed', async () => {
		const failed = Promise.reject(new Error('Rate limit exceeded.'));
		const updates = open(failed);
		await settle();

		assert.strictEqual(updates.length, 1);
		assert.match(updates[0], /Generation Failed/);
		assert.doesNotMatch(updates[0], /Generation Cancelled/);
	});

	test('a cancelled request ends as Generation Cancelled', async () => {
		const updates = open(Promise.resolve('cancelled') as Promise<never>);
		await settle();

		assert.strictEqual(updates.length, 1);
		assert.match(updates[0], /Generation Cancelled/);
		assert.doesNotMatch(updates[0], /Generation Failed/);
	});

	test('an undefined result ends as Generation Failed', async () => {
		const updates = open(Promise.resolve(undefined) as Promise<never>);
		await settle();

		assert.strictEqual(updates.length, 1);
		assert.match(updates[0], /Generation Failed/);
	});
});
