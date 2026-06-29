/**
 * MCP E2E — Git Read Tools
 *
 * Exercises the read-only git MCP tools (git_status, git_branch list,
 * git_log_or_diff, git_blame) against a purpose-built repo with known state.
 *
 * Source of truth verified by probing the tools over JSON-RPC directly:
 * - A successful call wraps the raw git CLI output in `{ data: { output } }`
 *   inside `result.content[0].text`.
 * - A bad directory or missing file surfaces as a JSON-RPC `error`.
 * - An invalid enum argument (e.g. an unknown `action`) returns a result with
 *   `isError: true` and a plain-text message (no `data.output` wrapper).
 *
 * The git tools operate on the explicit `directory` argument, so this suite
 * builds its own repo rather than relying on the VS Code workspace.
 */
import { rm } from 'node:fs/promises';
import { createTmpDir, GitFixture } from '../baseTest.js';
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

let repoDir: string;

type ToolResult = { content?: { text?: string }[]; isError?: boolean };

/** Unwrap the `data.output` payload from a successful git tool response. */
function toolOutput(response: McpMessage): string {
	const result = response.result as ToolResult | undefined;
	expect(result?.isError, `expected a success result; text=${result?.content?.[0]?.text}`).toBeFalsy();

	const text = result?.content?.[0]?.text;
	expect(text, 'tool response should carry text content').toBeTruthy();

	const parsed = JSON.parse(text!) as { data?: { output?: string } };
	expect(parsed.data?.output, 'tool response should carry data.output').toBeDefined();
	return parsed.data!.output!;
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
		if (repoDir) {
			await rm(repoDir, { recursive: true, force: true });
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
		const response = await mcpClient.callTool('git_status', { directory: '/no/such/path/here' });

		// A git failure surfaces as a JSON-RPC error (code -32603), not an isError result.
		expect(response.error?.code).toBe(-32603);
		expect(response.result).toBeUndefined();
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

		expect(response.error?.code).toBe(-32603);
		expect(response.result).toBeUndefined();
	});
});
