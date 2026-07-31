import * as assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Container } from '../../../../container.js';
import type { GitRepositoryService } from '../../../../git/gitRepositoryService.js';
import { ConflictToolsIntegration } from '../integration.js';
import type { Resolution, ResolvedChunk } from '../types.js';

/** The working-tree shape of a one-marker conflict in a file git otherwise merged cleanly. */
const conflicted = [
	'keep-above',
	'<<<<<<< HEAD',
	'timeout = 30',
	'=======',
	'timeout = 60',
	'>>>>>>> incoming',
	'keep-below',
	'',
].join('\n');
/** What the library computes for "take theirs" on that marker — the merged regions survive. */
const merged = ['keep-above', 'timeout = 60', 'keep-below', ''].join('\n');

function resolution(overrides: Partial<Resolution> & Pick<Resolution, 'filePath' | 'strategy'>): Resolution {
	return { content: '', confidence: 0.95, description: 'why', ...overrides };
}

const oneChunk: ResolvedChunk[] = [{ markerIndex: 0, strategy: 'theirs' }];

/**
 * A repo rooted at a temp dir with a recording git runner — enough for `applyBatch` to drive the
 * real `@gitkraken/conflict-tools` apply loop through our port, so the assertions cover what
 * actually lands on disk (and which git commands were reached for).
 */
function makeFakes(repoPath: string) {
	const execs: string[][] = [];
	const svc = {
		path: repoPath,
		createUnsafeGit: () => ({
			run: (args: string[]) => {
				execs.push(args);
				return Promise.resolve({ stdout: '' });
			},
		}),
	} as unknown as GitRepositoryService;

	return { integration: new ConflictToolsIntegration({} as Container), svc: svc, execs: execs };
}

suite('coretools/conflict/ConflictToolsIntegration applyBatch', () => {
	let dir: string;

	setup(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gitlens-conflict-apply-'));
	});

	teardown(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('writes a chunked take-theirs resolution instead of checking out the whole stage blob', async () => {
		// The library classifies a single-marker "take theirs" as a FILE-level take and applies it with
		// `checkoutFile` — which would replace the file with the incoming blob and revert everything git
		// merged cleanly outside the marker. What's applied must equal the `content` we record as the
		// summary's "AI-resolved" side.
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'server.conf'), conflicted);

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'server.conf', content: merged, strategy: 'take-theirs', chunks: oneChunk }),
			],
		});

		assert.strictEqual(await readFile(join(dir, 'server.conf'), 'utf8'), merged);
		assert.strictEqual(
			execs.some(a => a[0] === 'checkout'),
			false,
		);
		// Still staged, so the step can be continued
		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'add'),
			[['add', '--', 'server.conf']],
		);
	});

	test('preserves the file’s CRLF line endings when substituting content', async () => {
		const { integration, svc } = makeFakes(dir);
		await writeFile(join(dir, 'server.conf'), conflicted.replace(/\n/g, '\r\n'));

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'server.conf', content: merged, strategy: 'take-theirs', chunks: oneChunk }),
			],
		});

		assert.strictEqual(await readFile(join(dir, 'server.conf'), 'utf8'), merged.replace(/\n/g, '\r\n'));
	});

	test('keeps the real checkout for a marker-less take (binary / delete-modify)', async () => {
		// No chunks means the library produced `content: ''` — substituting it would truncate the file,
		// so the stage-blob checkout is the only correct apply.
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'icon.bin'), 'original');

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'icon.bin', strategy: 'take-ours', confidence: 1, chunks: [] }),
				resolution({ filePath: 'notes.md', strategy: 'take-theirs', confidence: 1 }),
			],
		});

		assert.strictEqual(await readFile(join(dir, 'icon.bin'), 'utf8'), 'original');
		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'checkout'),
			[
				['checkout', '--ours', '--', 'icon.bin'],
				['checkout', '--theirs', '--', 'notes.md'],
			],
		);
	});

	test('never substitutes a deleted resolution — the file is removed, not emptied', async () => {
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'gone.txt'), 'original');

		await integration.applyBatch({
			svc: svc,
			resolutions: [resolution({ filePath: 'gone.txt', strategy: 'deleted', confidence: 1, chunks: oneChunk })],
		});

		await assert.rejects(() => readFile(join(dir, 'gone.txt'), 'utf8'));
		assert.deepStrictEqual(execs, []);
	});

	test('never substitutes a skipped resolution — nothing is written or staged', async () => {
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'a.txt'), conflicted);

		await integration.applyBatch({
			svc: svc,
			resolutions: [resolution({ filePath: 'a.txt', content: merged, strategy: 'skipped', chunks: [] })],
		});

		assert.strictEqual(await readFile(join(dir, 'a.txt'), 'utf8'), conflicted);
		assert.deepStrictEqual(execs, []);
	});

	test('substitution is scoped to the batch it was built from', async () => {
		// The map lives on the per-call port, so a later batch that takes the same path without chunks
		// must fall back to the real checkout rather than reusing the earlier content.
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'server.conf'), conflicted);

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'server.conf', content: merged, strategy: 'take-theirs', chunks: oneChunk }),
			],
		});
		await integration.applyBatch({
			svc: svc,
			resolutions: [resolution({ filePath: 'server.conf', strategy: 'take-theirs', confidence: 1 })],
		});

		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'checkout'),
			[['checkout', '--theirs', '--', 'server.conf']],
		);
	});
});

/** A scripted AI response for {@link makeAiFakes}. */
interface ScriptedResponse {
	text?: string;
	toolCalls?: { id: string; name: string; args: Record<string, unknown>; providerSignature?: string }[];
	toolsRejected?: boolean;
	/** Retry count to request messages at, mimicking a provider shrinking its input budget */
	retries?: number;
}

/** The JSON shape `parseModelResponse` expects for a single-marker resolution. */
const takeTheirsResponse = JSON.stringify({
	description: 'Incoming raises the timeout; kept it.',
	chunks: [{ markerIndex: 0, strategy: 'theirs', confidence: 0.95, reason: 'newer value' }],
});

/**
 * A `Container` whose `ai.sendRequest` replays `responses` in order, recording the messages and tool
 * definitions each call received. Drives the real `@gitkraken/conflict-tools` resolver loop through
 * our model port, so the assertions cover the actual tool round-trip rather than a mock of it.
 */
function makeAiFakes(responses: ScriptedResponse[], options?: { supportsTools?: boolean }) {
	const model = {
		id: 'test-model',
		name: 'Test Model',
		maxTokens: { input: 100000, output: 8192 },
		provider: { id: 'gitkraken', name: 'GitKraken' },
	};

	const seenMessages: { role: string; content: string; toolCallId?: string; toolCalls?: unknown[] }[][] = [];
	const seenTools: (readonly { name: string }[] | undefined)[] = [];
	let call = 0;

	const ai = {
		sendRequest: async (
			_action: unknown,
			_model: unknown,
			// biome-ignore lint/suspicious/noExplicitAny: test double for the AIRequestProvider shape
			provider: any,
			_source: unknown,
			// biome-ignore lint/suspicious/noExplicitAny: test double for the sendRequest options
			opts: any,
		) => {
			const scriptedRetries = responses[call]?.retries ?? 0;
			const messages = await provider.getMessages(model, {}, {}, model.maxTokens.input, scriptedRetries);
			seenMessages.push(messages);
			// Mirror the service's own capability gate: tools are dropped for providers that can't carry them
			seenTools.push(options?.supportsTools === false ? undefined : opts?.tools);

			const scripted = responses[call++] ?? { text: takeTheirsResponse };
			return {
				model: model,
				promise: Promise.resolve({
					id: `rsp-${call}`,
					content: scripted.text ?? '',
					model: model,
					toolCalls: options?.supportsTools === false ? undefined : scripted.toolCalls,
					toolsRejected: scripted.toolsRejected,
					result: undefined,
				}),
			};
		},
	};

	return {
		container: { ai: ai } as unknown as Container,
		seenMessages: seenMessages,
		seenTools: seenTools,
		callCount: () => call,
	};
}

/** A `GitError`-shaped rejection: the fields {@link isNoMatchExit} and the port's error handling read. */
function gitFailure(exitCode: number, stderr = ''): Promise<never> {
	return Promise.reject(
		Object.assign(new Error(stderr || `Command failed with exit code ${exitCode}`), {
			exitCode: exitCode,
			stdout: '',
			stderr: stderr,
		}),
	);
}

/**
 * A repo-rooted fake whose git runner answers the read commands the resolver's tools issue.
 *
 * `run` overrides the default answers per command (returning `undefined` falls through), so a test can
 * script a git failure or an oversized payload for one op without restating the rest.
 */
function makeToolGitFakes(
	repoPath: string,
	container: Container,
	run?: (args: string[]) => Promise<{ stdout: string }> | undefined,
) {
	const execs: string[][] = [];
	const svc = {
		path: repoPath,
		createUnsafeGit: () => ({
			run: (args: string[]) => {
				execs.push(args);
				const scripted = run?.(args);
				if (scripted != null) return scripted;

				if (args[0] === 'grep') return Promise.resolve({ stdout: 'src/other.ts\x0012\x00useTimeout()\n' });
				return Promise.resolve({ stdout: '' });
			},
		}),
	} as unknown as GitRepositoryService;

	return { integration: new ConflictToolsIntegration(container), svc: svc, execs: execs };
}

suite('coretools/conflict repo-consultation tool loop', () => {
	let dir: string;

	setup(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gitlens-conflict-tools-'));
	});

	teardown(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function extractOne(integration: ConflictToolsIntegration, svc: GitRepositoryService) {
		await writeFile(join(dir, 'server.conf'), conflicted);
		const conflict = await integration.extract({ svc: svc, filePath: 'server.conf' });
		assert.notStrictEqual(conflict, null, 'expected the fixture to parse as a conflict');
		return conflict!;
	}

	test('advertises the six read-only tools and dispatches a tool call to git', async () => {
		// The whole point of the issue: the model must be offered tools, and a tool call must reach the
		// repository instead of being dropped on the floor.
		const ai = makeAiFakes([
			{ toolCalls: [{ id: 'c1', name: 'grep', args: { reason: 'is it still used?', pattern: 'useTimeout' } }] },
			{ text: takeTheirsResponse },
		]);
		const { integration, svc, execs } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		const resolution = await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		assert.deepStrictEqual(
			ai.seenTools[0]?.map(t => t.name).sort(),
			['blame', 'diff', 'grep', 'log', 'show', 'show_file_at_ref'],
			'all six read-only tools should be advertised',
		);
		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'grep'),
			[['grep', '-I', '-n', '-z', '--', 'useTimeout']],
			'the tool call should reach git as a read-only grep',
		);
		assert.strictEqual(resolution.metrics?.toolCallCount, 1);
		assert.strictEqual(resolution.strategy, 'take-theirs');
	});

	test('replays the assistant tool-call turn and the tool result with its id', async () => {
		// An assistant turn carrying only tool calls used to be dropped entirely, leaving a tool result
		// with no matching request — a 400 from both OpenAI and Anthropic.
		const ai = makeAiFakes([
			{ toolCalls: [{ id: 'c1', name: 'grep', args: { reason: 'why', pattern: 'useTimeout' } }] },
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const second = ai.seenMessages[1];
		const assistant = second.find(m => m.role === 'assistant');
		assert.strictEqual(assistant?.toolCalls?.length, 1, 'the tool-call turn must survive');
		const tool = second.find(m => m.role === 'tool');
		assert.strictEqual(tool?.toolCallId, 'c1', 'the tool result must reference the call it answers');
	});

	test('round-trips the provider signature onto the next assistant turn', async () => {
		// The GitKraken proxy's `thought_signature` has nowhere to live on the library's ToolCall, so we
		// stash it by id. Anthropic rejects a tool result whose preceding turn dropped it.
		const ai = makeAiFakes([
			{
				toolCalls: [
					{ id: 'c1', name: 'grep', args: { reason: 'why', pattern: 'x' }, providerSignature: 'sig-abc' },
				],
			},
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const assistant = ai.seenMessages[1].find(m => m.role === 'assistant');
		assert.deepStrictEqual(
			(assistant?.toolCalls as { providerSignature?: string }[])?.[0]?.providerSignature,
			'sig-abc',
		);
	});

	test('falls back to flattened text for a provider without tool support', async () => {
		// The pre-tool behavior must still resolve: no `tool` role reaches the provider, and the result
		// is carried as plain text.
		const ai = makeAiFakes([{ text: takeTheirsResponse }], { supportsTools: false });
		const { integration, svc } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		const resolution = await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		assert.strictEqual(resolution.strategy, 'take-theirs');
		assert.strictEqual(
			ai.seenMessages.flat().some(m => m.role === 'tool'),
			false,
			'no tool-role message should reach a provider that cannot carry one',
		);
	});

	test('stops offering tools for the rest of the session once a provider rejects them', async () => {
		const ai = makeAiFakes([{ text: '', toolsRejected: true }, { text: takeTheirsResponse }]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		assert.notStrictEqual(ai.seenTools[0], undefined, 'the first attempt should still offer tools');
		assert.strictEqual(ai.seenTools[1], undefined, 'the retry must not re-offer rejected tools');
	});

	test('drops the oldest tool round-trip as a unit when the context window is retried', async () => {
		// A provider retry means the previous attempt overflowed. Dropping a tool result without its
		// assistant turn would leave an orphaned tool_call_id — a 400 from both OpenAI and Anthropic.
		const ai = makeAiFakes([
			{ toolCalls: [{ id: 'c1', name: 'grep', args: { reason: 'why', pattern: 'x' } }] },
			{ text: takeTheirsResponse, retries: 1 },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const retried = ai.seenMessages[1];
		assert.strictEqual(
			retried.some(m => m.role === 'tool'),
			false,
			'the tool result must go with its assistant turn',
		);
		assert.strictEqual(
			retried.some(m => (m.toolCalls?.length ?? 0) > 0),
			false,
			'the assistant tool-call turn must be dropped too',
		);
		assert.strictEqual(
			retried.some(m => m.content.includes('Earlier tool results were omitted')),
			true,
			'the model should be told why its earlier findings are gone',
		);
	});

	test('blocks a tool read of an excluded path but not the file being resolved', async () => {
		// Exclusions must cover the extra context AI pulls in. The conflicted file itself stays in scope:
		// the library reads it internally (extraction, and the prompt's three-way diff), and blinding
		// those while still sending its markers would degrade the resolution without protecting anything.
		const ai = makeAiFakes([
			{
				toolCalls: [
					{ id: 'c1', name: 'show_file_at_ref', args: { reason: 'r', ref: 'HEAD', path: 'dist/bundle.js' } },
					{ id: 'c2', name: 'show_file_at_ref', args: { reason: 'r', ref: 'HEAD', path: 'server.conf' } },
				],
			},
			{ text: takeTheirsResponse },
		]);
		const { integration, svc, execs } = makeToolGitFakes(dir, ai.container);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const results = ai.seenMessages[1].filter(m => m.role === 'tool');
		const excluded = results.find(m => m.toolCallId === 'c1');
		assert.strictEqual(
			excluded?.content.includes('excluded by the AI file-exclusion rules'),
			true,
			'a default-excluded path (dist/**) must not be read',
		);
		assert.strictEqual(
			execs.some(a => a[0] === 'show' && a[1] === 'HEAD:dist/bundle.js'),
			false,
			'the excluded path must never reach git',
		);
		assert.strictEqual(
			execs.some(a => a[0] === 'show' && a[1] === 'HEAD:server.conf'),
			true,
			'the file being resolved stays readable',
		);
	});

	test('reports an empty grep as "no matches" rather than as a tool error', async () => {
		// `git grep` exits 1 with no output when nothing matched, and the port throws on any non-zero
		// exit — so without special handling the model gets an opaque command-failure string flagged as
		// an error. "This symbol is referenced nowhere else" is usually the most useful answer grep can
		// give; it must not be indistinguishable from a broken search.
		const ai = makeAiFakes([
			{ toolCalls: [{ id: 'c1', name: 'grep', args: { reason: 'still used?', pattern: 'useTimeout' } }] },
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container, args =>
			args[0] === 'grep' ? gitFailure(1) : undefined,
		);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const result = ai.seenMessages[1].find(m => m.role === 'tool');
		assert.strictEqual(
			result?.content,
			'[No matches. The pattern does not appear anywhere in the searched scope.]',
		);
	});

	test('still surfaces a genuine grep failure as an error', async () => {
		// Only a clean exit-1-with-no-output is an empty result. A bad ref exits 128 and writes to
		// stderr — that has to keep reaching the model as the failure it is, or it would read as proof
		// the symbol is absent.
		const ai = makeAiFakes([
			{
				toolCalls: [
					{ id: 'c1', name: 'grep', args: { reason: 'still used?', pattern: 'x', ref: 'no-such-ref' } },
				],
			},
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container, args =>
			args[0] === 'grep' ? gitFailure(128, "fatal: bad revision 'no-such-ref'") : undefined,
		);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const result = ai.seenMessages[1].find(m => m.role === 'tool');
		assert.strictEqual(result?.content, "fatal: bad revision 'no-such-ref'");
	});

	test('filters excluded paths out of grep results, including paths containing colons', async () => {
		// `grep` takes no path argument, so exclusions apply to its output — and that filter used to
		// split on `:`, so a path like `dist/a:b.js` parsed as `dist/a` and an excluded file's matched
		// line leaked to the provider. `-z` NUL-terminates the path and line number, making the parse
		// exact; the surviving lines are re-emitted in the conventional colon format.
		const ai = makeAiFakes([
			{ toolCalls: [{ id: 'c1', name: 'grep', args: { reason: 'still used?', pattern: 'useTimeout' } }] },
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container, args =>
			args[0] === 'grep'
				? Promise.resolve({
						stdout:
							'dist/a:b.js\x001\x00useTimeout() // excluded, colon path\n' +
							'src/uses:colons.ts\x0012\x00useTimeout()\n' +
							'src/plain.ts\x003\x00useTimeout()\n',
					})
				: undefined,
		);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const result = ai.seenMessages[1].find(m => m.role === 'tool');
		assert.strictEqual(
			result?.content.includes('dist/a:b.js'),
			false,
			'a default-excluded path (dist/**) must not leak through grep output, even with a colon in it',
		);
		assert.strictEqual(
			result?.content.includes('src/uses:colons.ts:12:useTimeout()'),
			true,
			'an allowed colon-containing path survives, re-emitted as path:line:text',
		);
		assert.strictEqual(result?.content.includes('src/plain.ts:3:useTimeout()'), true);
	});

	test('filters excluded paths out of a ref-scoped grep, splitting the ref off the first colon', async () => {
		// A ref search prefixes every result with `ref:` — ref names can never contain `:`, so the
		// first colon of the NUL-terminated prefix always separates ref from path.
		const ai = makeAiFakes([
			{
				toolCalls: [
					{ id: 'c1', name: 'grep', args: { reason: 'still used?', pattern: 'useTimeout', ref: 'HEAD' } },
				],
			},
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container, args =>
			args[0] === 'grep'
				? Promise.resolve({
						stdout:
							'HEAD:dist/a:b.js\x001\x00useTimeout()\n' +
							'HEAD:src/uses:colons.ts\x0012\x00useTimeout()\n',
					})
				: undefined,
		);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			{ svc: svc, conflict: conflict, conversationId: 'conv-1' },
			{ source: 'graph' },
		);

		const result = ai.seenMessages[1].find(m => m.role === 'tool');
		assert.strictEqual(result?.content.includes('dist/a:b.js'), false);
		assert.strictEqual(result?.content.includes('HEAD:src/uses:colons.ts:12:useTimeout()'), true);
	});

	test('caps a path-scoped diff from a tool call but not the prompt’s three-way diff', async () => {
		// `diff` is the one tool the library never caps, and it is also the op the library calls itself to
		// build the prompt's three-way diff. Exempting every path-scoped diff (the previous behavior) left
		// tool calls uncapped; the file being resolved is what separates the two callers.
		const huge = Array.from({ length: 2500 }, (_, i) => `+line ${i + 1}`).join('\n');
		const ai = makeAiFakes([
			{
				toolCalls: [
					{
						id: 'c1',
						name: 'diff',
						args: { reason: 'what changed', from: 'a', to: 'b', path: 'src/other.ts' },
					},
				],
			},
			{ text: takeTheirsResponse },
		]);
		const { integration, svc } = makeToolGitFakes(dir, ai.container, args =>
			args[0] === 'diff' ? Promise.resolve({ stdout: huge }) : undefined,
		);
		const conflict = await extractOne(integration, svc);

		await integration.resolveSingle(
			// `refs` is what makes the library build the prompt's three-way diff — without them it skips it,
			// and the internal `diff` call this test is about never happens.
			{
				svc: svc,
				conflict: conflict,
				context: { refs: { ours: 'HEAD', theirs: 'REBASE_HEAD' } },
				conversationId: 'conv-1',
			},
			{ source: 'graph' },
		);

		const result = ai.seenMessages[1].find(m => m.role === 'tool');
		assert.strictEqual(
			result?.content.startsWith('[Output capped at 1000 lines.'),
			true,
			'the tool call is capped',
		);
		assert.strictEqual(result?.content.includes('+line 2500'), false, 'the tail is dropped');

		// The three-way diff for the conflicted file rides the same op and must survive intact — it is the
		// prompt's primary evidence.
		const prompt = ai.seenMessages[0].map(m => m.content).join('\n');
		assert.strictEqual(prompt.includes('+line 2500'), true, 'the conflicted file’s diff must not be capped');
	});
});
