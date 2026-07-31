import * as assert from 'assert';
import { anthropicProviderDescriptor, openAIProviderDescriptor } from '../../constants.js';
import type { AIModel } from '../../models/model.js';
import type { AIChatMessage, AIChatMessageRole, AIToolDefinition } from '../../models/provider.js';
import { AnthropicProvider } from '../anthropicProvider.js';
import type { AIProviderContext } from '../context.js';
import { OpenAIProvider } from '../openaiProvider.js';

/**
 * End-to-end wire contract for tool calls.
 *
 * The other suites exercise the serialization hooks in isolation, which proves each hook in a vacuum
 * but never asserts what actually reaches the network — so a composition bug (a `fetchCore` override
 * that rewrites the request and drops `tools`, a `system` field that doesn't survive alongside them,
 * a multi-turn replay that only works for a single message) passes everything and fails in the wild.
 *
 * These drive the real providers through the real `sendRequest` → `fetchCore` path against an injected
 * transport, asserting the exact bytes sent and parsing a real-shaped response back. `context.fetch`
 * is the seam, so this needs no API key and runs in CI.
 *
 * What it deliberately cannot prove: that the vendor *accepts* the payload. These encode our belief
 * about each API's rules; only the live endpoint adjudicates.
 */

/** Captures each outgoing request and replays queued responses in order. */
function createTransport(responses: unknown[]) {
	const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
	let call = 0;

	const context: AIProviderContext = {
		fetch: (url: string | URL, init?: RequestInit) => {
			sent.push({
				url: String(url),
				headers: (init?.headers ?? {}) as Record<string, string>,
				body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
			});
			const body = responses[Math.min(call++, responses.length - 1)];
			return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
		},
		getApiKey: () => Promise.resolve('test-key'),
		getProviderConfig: () => ({ enabled: true }),
		getOrPromptUrl: () => Promise.resolve(undefined),
	};

	return { context: context, sent: sent };
}

const tools: AIToolDefinition[] = [
	{
		name: 'grep',
		description: 'Search the repository',
		parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
	},
];

/** A full agentic turn: system + user, an assistant tool call, and the result answering it. */
const conversation: AIChatMessage<AIChatMessageRole>[] = [
	{ role: 'system', content: 'You resolve conflicts.' },
	{ role: 'user', content: 'Resolve jobs.py' },
	{ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'grep', args: { pattern: 'useTimeout' } }] },
	{ role: 'tool', content: 'src/a.ts:1:useTimeout()', toolCallId: 'call-1', toolName: 'grep' },
];

function send(
	provider: AnthropicProvider | OpenAIProvider,
	model: AIModel<never>,
	messages: AIChatMessage<AIChatMessageRole>[],
) {
	return provider.sendRequest('conflict-resolution', model as never, 'test-key', () => Promise.resolve(messages), {
		signal: new AbortController().signal,
		modelOptions: { outputTokens: 4096 },
		tools: tools,
	});
}

const anthropicModel = {
	id: 'claude-sonnet-5',
	name: 'Sonnet 5',
	maxTokens: { input: 200000, output: 8192 },
	provider: anthropicProviderDescriptor,
} as unknown as AIModel<never>;

const openaiModel = {
	id: 'gpt-4o',
	name: 'GPT-4o',
	maxTokens: { input: 128000, output: 8192 },
	provider: openAIProviderDescriptor,
} as unknown as AIModel<never>;

suite('wire contract — Anthropic tool calls', () => {
	// Anthropic is the only provider with a bespoke tool encoding, and the GitKraken proxy never
	// exercises it: proxied `anthropic:*` models are sent in OpenAI shape and translated server-side.
	// So this path only ever runs for a BYOK key, which is exactly where coverage was thinnest.

	test('sends tools as input_schema, without the OpenAI function envelope', async () => {
		const { context, sent } = createTransport([{ content: [{ type: 'text', text: 'done' }] }]);
		await send(new AnthropicProvider(context), anthropicModel, conversation);

		assert.deepStrictEqual(sent[0].body.tools, [
			{
				name: 'grep',
				description: 'Search the repository',
				input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
			},
		]);
	});

	test('keeps tools alongside the hoisted system prompt and the rewritten token limit', async () => {
		// Three transformations meet on one request: `extractSystemPrompt` hoists `system` out of
		// `messages`, `fetchCore` rewrites `max_completion_tokens` → `max_tokens`, and `tools` is added.
		// Each is covered alone; nothing asserted they coexist.
		const { context, sent } = createTransport([{ content: [{ type: 'text', text: 'done' }] }]);
		await send(new AnthropicProvider(context), anthropicModel, conversation);

		const body = sent[0].body;
		assert.strictEqual(body.system, 'You resolve conflicts.');
		assert.strictEqual(body.max_tokens, 4096, 'Anthropic rejects max_completion_tokens');
		assert.strictEqual('max_completion_tokens' in body, false, 'the rewritten field must not linger');
		assert.ok(Array.isArray(body.tools), 'tools must survive the fetchCore rewrite');
		assert.strictEqual(
			(body.messages as { role: string }[]).some(m => m.role === 'system'),
			false,
			'the system message must not also remain inline',
		);
	});

	test('replays a full tool round-trip as content blocks', async () => {
		const { context, sent } = createTransport([{ content: [{ type: 'text', text: 'done' }] }]);
		await send(new AnthropicProvider(context), anthropicModel, conversation);

		assert.deepStrictEqual(sent[0].body.messages, [
			{ role: 'user', content: 'Resolve jobs.py' },
			{
				role: 'assistant',
				content: [{ type: 'tool_use', id: 'call-1', name: 'grep', input: { pattern: 'useTimeout' } }],
			},
			{
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'src/a.ts:1:useTimeout()' }],
			},
		]);
	});

	test('parses tool_use content blocks back out of a response', async () => {
		const { context } = createTransport([
			{
				content: [
					{ type: 'thinking', thinking: 'hmm' },
					{ type: 'text', text: 'looking' },
					{ type: 'tool_use', id: 'call-2', name: 'grep', input: { pattern: 'x' } },
				],
			},
		]);
		const rsp = await send(new AnthropicProvider(context), anthropicModel, conversation);

		assert.deepStrictEqual(rsp?.toolCalls, [{ id: 'call-2', name: 'grep', args: { pattern: 'x' } }]);
		// A thinking block precedes the text on reasoning models — the text must be selected by type,
		// never by position, or the reply becomes the thinking trace.
		assert.strictEqual(rsp?.content, 'looking');
	});
});

suite('wire contract — OpenAI tool calls', () => {
	// The control: the shared base path every other tool-enabled provider uses.

	test('sends tools in the function envelope and replays the round-trip inline', async () => {
		const { context, sent } = createTransport([{ choices: [{ message: { content: 'done' } }] }]);
		await send(new OpenAIProvider(context), openaiModel, conversation);

		const body = sent[0].body;
		assert.deepStrictEqual(body.tools, [
			{
				type: 'function',
				function: {
					name: 'grep',
					description: 'Search the repository',
					parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
				},
			},
		]);
		assert.deepStrictEqual(body.messages, [
			{ role: 'system', content: 'You resolve conflicts.' },
			{ role: 'user', content: 'Resolve jobs.py' },
			{
				role: 'assistant',
				content: null,
				tool_calls: [
					{
						id: 'call-1',
						type: 'function',
						function: { name: 'grep', arguments: '{"pattern":"useTimeout"}' },
					},
				],
			},
			{ role: 'tool', tool_call_id: 'call-1', content: 'src/a.ts:1:useTimeout()' },
		]);
		// Unlike Anthropic, the system prompt stays inline and there is no top-level `system`.
		assert.strictEqual('system' in body, false);
	});

	test('parses tool_calls back out of a response', async () => {
		const { context } = createTransport([
			{
				choices: [
					{
						message: {
							content: null,
							tool_calls: [
								{
									id: 'call-3',
									type: 'function',
									function: { name: 'grep', arguments: '{"pattern":"y"}' },
								},
							],
						},
					},
				],
			},
		]);
		const rsp = await send(new OpenAIProvider(context), openaiModel, conversation);

		assert.deepStrictEqual(rsp?.toolCalls, [{ id: 'call-3', name: 'grep', args: { pattern: 'y' } }]);
		assert.strictEqual(rsp?.content, '', 'a tool-call-only turn carries no text');
	});
});
