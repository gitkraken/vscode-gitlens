import * as assert from 'node:assert';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { AIProviderResponse } from '@gitlens/ai/models/provider.js';
import { extractCommitsJson, validateCommitsResponse } from '../generateCommits.js';

const model: AIModel = {
	id: 'test-model',
	name: 'Test Model',
	maxTokens: { input: 100000, output: 8192 },
	provider: { id: 'openai', name: 'OpenAI' },
};

function response(content: string): AIProviderResponse<void> {
	return { id: '1', content: content, model: model, result: undefined };
}

function hunk(index: number) {
	return {
		index: index,
		fileName: 'src/a.ts',
		diffHeader: '',
		hunkHeader: `@@ ${index}`,
		content: '+x',
		source: 'wip',
	};
}

const commitsObject = JSON.stringify({
	commits: [{ message: 'Adds x', explanation: 'Adds x to a', hunks: [{ hunk: 0 }, { hunk: 1 }] }],
});

suite('extractCommitsJson', () => {
	test('parses a bare JSON object', () => {
		assert.deepStrictEqual(extractCommitsJson(commitsObject), JSON.parse(commitsObject));
	});

	test('strips code fences', () => {
		assert.deepStrictEqual(extractCommitsJson(`\`\`\`json\n${commitsObject}\n\`\`\``), JSON.parse(commitsObject));
	});

	test('unwraps the legacy <output> tag', () => {
		const legacy = `<output>\n${JSON.stringify(JSON.parse(commitsObject).commits)}\n</output>`;
		assert.deepStrictEqual(extractCommitsJson(legacy), JSON.parse(commitsObject));
	});

	test('does not mangle valid JSON whose strings mention the legacy <output> tag', () => {
		const mentioning = JSON.stringify({
			commits: [{ message: 'Replaces the <output> tag', explanation: 'Drops <output> wrapping', hunks: [] }],
		});
		assert.deepStrictEqual(extractCommitsJson(mentioning), JSON.parse(mentioning));
	});

	test('extracts JSON wrapped in surrounding prose', () => {
		const prose = `Here is the commit organization:\n${commitsObject}\nLet me know if you need changes.`;
		assert.deepStrictEqual(extractCommitsJson(prose), JSON.parse(commitsObject));
	});

	test('skips unbalanced prose braces and wrong-shape objects preceding the payload', () => {
		const prose = `The hunk_map { entry: {"note": "grouped by feature"}\n${commitsObject}`;
		assert.deepStrictEqual(extractCommitsJson(prose), JSON.parse(commitsObject));
	});

	test('normalizes the legacy bare-array shape into the commits object', () => {
		const array = JSON.stringify(JSON.parse(commitsObject).commits);
		assert.deepStrictEqual(extractCommitsJson(array), JSON.parse(commitsObject));
	});

	test('throws on malformed JSON', () => {
		assert.throws(() => extractCommitsJson('not json at all'));
	});
});

suite('validateCommitsResponse', () => {
	const inputHunks = [hunk(0), hunk(1)];

	test('accepts a complete, conservative assignment', () => {
		const result = validateCommitsResponse(response(commitsObject), inputHunks, []);
		assert.strictEqual(result.isValid, true);
		if (result.isValid) {
			assert.strictEqual(result.commits.length, 1);
		}
	});

	test('rejects when the commits array is missing', () => {
		const result = validateCommitsResponse(response('{"notCommits": []}'), inputHunks, []);
		assert.strictEqual(result.isValid, false);
		if (!result.isValid) {
			assert.ok(result.retryPrompt.includes('"commits"'));
		}
	});

	test('rejects malformed JSON with the structural retry prompt', () => {
		const result = validateCommitsResponse(response('not json'), inputHunks, []);
		assert.strictEqual(result.isValid, false);
		if (!result.isValid) {
			assert.strictEqual(result.errorMessage, 'Invalid response from the AI model');
			assert.ok(!result.retryPrompt.includes('<output>'));
		}
	});

	test('rejects duplicate hunk assignments', () => {
		const duplicated = JSON.stringify({
			commits: [{ message: 'm', explanation: 'e', hunks: [{ hunk: 0 }, { hunk: 0 }, { hunk: 1 }] }],
		});
		const result = validateCommitsResponse(response(duplicated), inputHunks, []);
		assert.strictEqual(result.isValid, false);
		if (!result.isValid) {
			assert.ok(result.errorMessage.startsWith('Duplicate hunks'));
		}
	});

	test('rejects missing hunks', () => {
		const missing = JSON.stringify({ commits: [{ message: 'm', explanation: 'e', hunks: [{ hunk: 0 }] }] });
		const result = validateCommitsResponse(response(missing), inputHunks, []);
		assert.strictEqual(result.isValid, false);
		if (!result.isValid) {
			assert.ok(result.errorMessage.startsWith('Missing hunks'));
		}
	});

	test('rejects out-of-range hunks', () => {
		const extra = JSON.stringify({
			commits: [{ message: 'm', explanation: 'e', hunks: [{ hunk: 0 }, { hunk: 1 }, { hunk: 99 }] }],
		});
		const result = validateCommitsResponse(response(extra), inputHunks, []);
		assert.strictEqual(result.isValid, false);
		if (!result.isValid) {
			assert.ok(result.errorMessage.startsWith('Extra hunks'));
		}
	});
});
