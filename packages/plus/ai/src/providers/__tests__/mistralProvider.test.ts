import * as assert from 'assert';
import { mistralProviderDescriptor } from '../../constants.js';
import type { AIModel } from '../../models/model.js';
import { MistralProvider } from '../mistralProvider.js';
import { createStubProviderContext } from './fixtures.js';

const context = createStubProviderContext();

const model: AIModel<typeof mistralProviderDescriptor.id> = {
	id: 'test-model',
	name: 'Test Model',
	maxTokens: { input: 1024, output: undefined },
	provider: { id: mistralProviderDescriptor.id, name: mistralProviderDescriptor.name },
};

/** Exposes the protected failure handler so the Mistral error envelope can be asserted directly. */
class TestFailureProvider extends MistralProvider {
	fail(
		status: number,
		envelope: unknown,
		sentTools?: boolean,
	): Promise<{ retry: true; maxInputTokens: number; withoutTools?: boolean }> {
		return this.handleFetchFailure(
			new Response(JSON.stringify(envelope), { status: status }),
			'conflict-resolution',
			model,
			0,
			1024,
			undefined,
			sentTools,
		);
	}
}

/** Mistral's validation-error envelope: `message.detail` entries locate the offending request field. */
function validationError(msg: string, loc: string[]): unknown {
	return {
		object: 'error',
		type: 'invalid_request_error',
		message: { detail: [{ type: 'extra_forbidden', msg: msg, loc: loc, input: 0 }] },
	};
}

suite('MistralProvider tools fallback', () => {
	const provider = () => new TestFailureProvider(context);

	test('degrades to a no-tools retry when a 400 rejects the tools field', async () => {
		// This provider's `handleFetchFailure` throws for every non-404/429 status before delegating to
		// the base, so the base's retry-without-tools fallback was unreachable — a model rejecting
		// `tools` hard-failed the request instead of degrading to the single-shot text path.
		const result = await provider().fail(
			400,
			validationError('Extra inputs are not permitted', ['body', 'tools']),
			true,
		);

		assert.deepStrictEqual(result, { retry: true, maxInputTokens: 1024, withoutTools: true });
	});

	test('does not degrade when no tools were sent', async () => {
		// The identical response without `tools` on the request is a genuine failure — retrying the same
		// request would just burn another call.
		await assert.rejects(
			() => provider().fail(400, validationError('Extra inputs are not permitted', ['body', 'tools'])),
			/Extra inputs are not permitted/,
		);
	});

	test('still throws for a 400 unrelated to tools', async () => {
		await assert.rejects(
			() => provider().fail(400, validationError('Input should be a list', ['body', 'messages']), true),
			/Input should be a list/,
		);
	});
});
