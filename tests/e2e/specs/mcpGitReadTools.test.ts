/**
 * MCP E2E — Git Read Tools
 *
 * Exercises the read-only git MCP tools (git_status, git_branch list,
 * git_log_or_diff, git_blame) against a purpose-built repo with known state.
 *
 * Source of truth verified by probing the tools over JSON-RPC directly:
 * - A successful call wraps the raw git CLI output in `{ data: { output } }`
 *   inside `result.content[0].text`.
 * - A bad directory or missing file, like an invalid enum argument (e.g. an
 *   unknown `action`), returns a result with `isError: true` and a plain-text
 *   message (no `data.output` wrapper).
 *
 * The git tools operate on the explicit `directory` argument, so this suite
 * builds its own repo rather than relying on the VS Code workspace.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTmpDir, GitFixture } from '../baseTest.js';
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

let repoDir: string;

type ToolResult = { content?: { text?: string }[]; isError?: boolean };

/** Unwrap the `data.output` payload from a successful git tool response. */
function toolOutput(response: McpMessage): string {
	// Surface a genuine tool failure (JSON-RPC error) directly, rather than letting it fall
	// through and fail later as a confusing "missing text" assertion.
	expect(response.error, `unexpected JSON-RPC error: ${JSON.stringify(response.error)}`).toBeUndefined();

	const result = response.result as ToolResult | undefined;
	expect(result?.isError, `expected a success result; text=${result?.content?.[0]?.text}`).toBeFalsy();

	const text = result?.content?.[0]?.text;
	expect(text, 'tool response should carry text content').toBeTruthy();

	let parsed: { data?: { output?: string } };
	try {
		parsed = JSON.parse(text!) as { data?: { output?: string } };
	} catch (ex) {
		throw new Error(`tool response text was not valid JSON: ${text!.slice(0, 200)}`, { cause: ex });
	}
	expect(parsed.data?.output, 'tool response should carry data.output').toBeDefined();
	return parsed.data!.output!;
}

/**
 * Asserts a tool-level failure and returns the message the caller sees.
 *
 * The gk CLI reports every handler failure on one channel: a result with `isError: true` carrying
 * plain text, with no `data` envelope. It answered these cases with a JSON-RPC `-32603` and no
 * result until `a9585eb9` ("report every MCP tool failure on one channel with isError set"), first
 * shipped in CLI v3.1.76 — so pinning the channel here makes a flip back read as exactly that,
 * rather than as a confusing "missing text" assertion further down.
 */
function expectToolFailure(response: McpMessage): string {
	expect(
		response.error,
		`tool failures arrive as an isError result, not a JSON-RPC error: ${JSON.stringify(response.error)}`,
	).toBeUndefined();

	const result = response.result as ToolResult | undefined;
	expect(result?.isError, `expected the tool result error flag to be set; result=${JSON.stringify(result)}`).toBe(
		true,
	);

	const text = result?.content?.[0]?.text;
	expect(text, 'tool failure should carry text content').toBeTruthy();

	// The message IS the content here — a git tool's failure carries no `{ data }` envelope, unlike its
	// success and unlike the CLI's own validation refusals. Asserted rather than left to the callers,
	// which only match substrings a wrapped message would satisfy just as well.
	expect(text, `tool failure text should be the message itself, not an envelope: ${text}`).not.toMatch(/^\s*\{/);

	return text!;
}

test.describe('MCP — Git Read Tools', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		repoDir = await createTmpDir();
		const git = new GitFixture(repoDir);
		// init() creates an "Initial commit" on `main`, authored by "Your Name".
		await git.init();
		await git.commit('Add app module', 'app.ts', 'line one\nline two\nline three\n');
		await git.commit('Add util module', 'util.ts', 'export const x = 1;\n');
		await git.branch('feature-a');
		await git.branch('feature-b');
		// Leave an unstaged modification (for status/diff) and an untracked file (for status).
		await git.createFile('app.ts', 'line one\nline two\nline three\nline four\n');
		await git.createFile('untracked.ts', 'pending change\n');
	});

	test.afterAll(async () => {
		// Teardown cleanup must not fail the suite (e.g. transient EPERM/EBUSY on Windows),
		// matching the swallow-on-cleanup pattern used by the shared fixtures.
		if (repoDir) {
			await rm(repoDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	// ── git_status ───────────────────────────────────────────────────────────

	test('git_status reports the branch, modified, and untracked files', async ({ mcpClient }) => {
		const output = toolOutput(await mcpClient.callTool('git_status', { directory: repoDir }));

		expect(output).toContain('On branch main');
		expect(output).toContain('modified:'); // long-format status section
		expect(output).toContain('app.ts'); // the tracked + modified file
		expect(output).toContain('Untracked files:');
		expect(output).toContain('untracked.ts');
	});

	test('git_status returns an error for a non-existent directory', async ({ mcpClient }) => {
		// A path under the (existing) repo that is guaranteed not to exist — deterministic across
		// platforms, unlike a hard-coded absolute path that an unusual filesystem layout might have.
		const missingDir = join(repoDir, 'no', 'such', 'directory');
		const response = await mcpClient.callTool('git_status', { directory: missingDir });

		// The directory is rejected before git runs, and the CLI echoes the argument verbatim into its
		// message, so both halves are asserted; the platform's own "cannot find the path" wording
		// follows them and is not.
		const message = expectToolFailure(response);
		expect(message).toContain('directory does not exist');
		expect(message).toContain(missingDir);
	});

	// ── git_branch ───────────────────────────────────────────────────────────

	test('git_branch list returns all branches and marks the current one', async ({ mcpClient }) => {
		const output = toolOutput(await mcpClient.callTool('git_branch', { directory: repoDir, action: 'list' }));

		expect(output).toContain('feature-a');
		expect(output).toContain('feature-b');
		expect(output).toContain('* main'); // `git branch` marks the current branch with `*`
	});

	// ── git_log_or_diff ──────────────────────────────────────────────────────

	test('git_log_or_diff log lists commits newest-first', async ({ mcpClient }) => {
		const output = toolOutput(await mcpClient.callTool('git_log_or_diff', { directory: repoDir, action: 'log' }));

		expect(output).toContain('Add app module');
		expect(output).toContain('Add util module');
		// The newest commit must appear before the older one.
		expect(output.indexOf('Add util module')).toBeLessThan(output.indexOf('Add app module'));
	});

	test('git_log_or_diff diff shows the unstaged working-tree change', async ({ mcpClient }) => {
		const output = toolOutput(await mcpClient.callTool('git_log_or_diff', { directory: repoDir, action: 'diff' }));

		expect(output).toContain('diff --git');
		expect(output).toContain('app.ts');
		expect(output).toContain('+line four');
	});

	test('git_log_or_diff returns isError for an invalid action', async ({ mcpClient }) => {
		const response = await mcpClient.callTool('git_log_or_diff', { directory: repoDir, action: 'bogus' });

		const result = response.result as ToolResult | undefined;
		expect(result?.isError).toBe(true);
		expect(result?.content?.[0]?.text ?? '').toMatch(/invalid action/i);
	});

	// ── git_blame ────────────────────────────────────────────────────────────

	test('git_blame attributes lines to their author and content', async ({ mcpClient }) => {
		const output = toolOutput(await mcpClient.callTool('git_blame', { directory: repoDir, file: 'util.ts' }));

		expect(output).toContain('export const x = 1;');
		expect(output).toContain('Your Name'); // author configured by GitFixture.init()
	});

	test('git_blame returns an error for a non-existent file', async ({ mcpClient }) => {
		const response = await mcpClient.callTool('git_blame', { directory: repoDir, file: 'does-not-exist.ts' });

		// Here git itself refuses, so the message carries git's own wording along with the path asked for.
		const message = expectToolFailure(response);
		expect(message).toContain('does-not-exist.ts');
		expect(message).toMatch(/no such path/i);
	});
});
