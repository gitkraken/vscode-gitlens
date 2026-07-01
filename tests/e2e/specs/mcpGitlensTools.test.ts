/**
 * MCP E2E — GitLens Tools (IPC round-trip)
 *
 * Exercises the `gitlens_*` MCP tools, which are the boundary GitLens actually
 * owns: unlike the `git_*` tools (pure gk CLI logic over an explicit directory),
 * these dispatch over the local IPC channel into the live VS Code extension host
 * and run real GitLens command handlers.
 *
 * Source of truth verified by source (GitLens `commands.ts` + gkCliService, and the
 * gk proxy's `internal/mcp/internal/tools/gitlens.go`) plus a live JSON-RPC probe:
 * - The `gitlens_*` IPC handlers register only when GitLens' AI features are enabled
 *   (gkCliService `onReady` → `startIpc` → `CliCommandHandlers`). With AI off, every
 *   call returns `-32603 "GitLens '<tool>' server not found"`. `gitlens.ai.enabled`
 *   defaults true and no E2E setting disables it, so this suite relies on that default
 *   (the same one mcp.test.ts leans on — `gitlens_*` tools only appear in tools/list
 *   once GitLens' `/ping` IPC handler is up, which requires the handlers to be registered).
 * - A successful call wraps its payload in `{ data: ... }` inside `result.content[0].text`
 *   (no `data.output` wrapper — unlike the git tools). `gitlens_commit_composer` is
 *   fire-and-forget and returns `{ data: "" }`; `gitlens_launchpad` returns either a
 *   `{ data: { message, error } }` no-op or `{ data: { items } }`.
 *
 * These tools act on the live instance, so the calls target the VS Code workspace
 * directory (the worker's temp repo), not a throwaway repo.
 */
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

type GitlensToolResult = { content?: { text?: string }[]; isError?: boolean };

/**
 * Unwraps the `data` payload from a successful `gitlens_*` response.
 *
 * Fails loudly on a JSON-RPC error — in particular the `-32603 "server not
 * found"` that indicates the IPC handlers never registered (AI disabled) or the
 * proxy didn't forward the call — so a round-trip regression reads clearly.
 */
function gitlensToolData(response: McpMessage): unknown {
	expect(response.error, `unexpected JSON-RPC error: ${JSON.stringify(response.error)}`).toBeUndefined();

	const result = response.result as GitlensToolResult | undefined;
	expect(result?.isError, `expected a success result; text=${result?.content?.[0]?.text}`).toBeFalsy();

	const text = result?.content?.[0]?.text;
	expect(text, 'tool response should carry text content').toBeTruthy();

	let parsed: { data?: unknown };
	try {
		parsed = JSON.parse(text!) as { data?: unknown };
	} catch (ex) {
		throw new Error(`tool response text was not valid JSON: ${text!.slice(0, 200)}`, { cause: ex });
	}
	expect(parsed).toHaveProperty('data');
	return parsed.data;
}

test.describe('MCP — GitLens Tools', () => {
	test.describe.configure({ mode: 'serial' });

	test('gitlens_commit_composer opens the Commit Composer webview', async ({ mcpClient, vscode }) => {
		const directory = vscode.electron.workspacePath;

		// Round-trip succeeds (no `-32603 server not found`); the tool is fire-and-forget → `{ data: "" }`.
		const data = gitlensToolData(await mcpClient.callTool('gitlens_commit_composer', { directory: directory }));
		expect(data).toBe('');

		// Verify the real effect: the command dispatched into the live instance and opened the webview.
		// The IPC call returns before the panel finishes rendering, and webview bootstrap can lag under
		// parallel CI load, so allow a generous timeout (the graph specs use 30s for the same reason).
		const webview = await vscode.gitlens.getCommitComposerWebview(30_000);
		expect(webview, 'Commit Composer webview should open after the MCP call').not.toBeNull();
	});

	test('gitlens_launchpad round-trips into the live instance', async ({ mcpClient, vscode }) => {
		const directory = vscode.electron.workspacePath;

		// gitlensToolData proves the round-trip reached the live launchpad handler — a missing server
		// would surface as `-32603 "server not found"` and throw here. The concrete payload is the
		// external gk-proxy contract and varies with integration state: the disconnected/empty path
		// (the deterministic case here — the fresh test instance has no connected integration) yields a
		// `{ message }` no-op; a connected account with actionable PRs would yield `{ items }`. Accept
		// either, rather than coupling to the account-dependent message text.
		const data = gitlensToolData(await mcpClient.callTool('gitlens_launchpad', { directory: directory })) as {
			message?: string;
			items?: unknown[];
		};

		expect(
			Array.isArray(data.items) || /no open pull requests|no connected integrations/i.test(data.message ?? ''),
			`unexpected launchpad payload: ${JSON.stringify(data)}`,
		).toBeTruthy();
	});
});
