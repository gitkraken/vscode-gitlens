/**
 * MCP E2E — GitLens write-path tools, failure and validation paths
 *
 * `gitlens_start_work` and `gitlens_start_review` are the two mutating GitLens tools: they create a
 * branch (and, for review, a worktree) through the live extension host. Their happy paths need a
 * connected hosting integration and live issue/PR URLs, so they are covered separately and skip
 * without credentials. What is coverable hermetically — and what breaks most often — is everything
 * before that: argument validation, and what a caller sees when the request cannot be honoured.
 *
 * Where each failure is decided, read from source on both sides:
 * - **Missing `directory` / `issue_url` / `pr_url`** never leaves the CLI. `startWorkHandler` and
 *   `startReviewHandler` return `textResponse(..., true)`, which is the `{ data: { message, error } }`
 *   envelope with the protocol-level error flag left unset — the same shape `gitlens_open_graph` uses
 *   for its own validation refusals.
 * - **A GitLens-side refusal** does leave the CLI: `runLaunchpadWorkflow` POSTs `{ cwd, args }` to the
 *   route (unlike `/graph`, these tools really do forward their arguments), and
 *   `parseGitlensCommandResponse` turns any `stderr` the extension returns into a JSON-RPC error
 *   carrying that text verbatim.
 * - **Not hanging is the point.** The extension's handlers `await` a deferred the Start Work / Start
 *   Review wizard settles, and the wizard cancels it in a `finally`. A caller that never gets an
 *   answer means that path was escaped without settling — which from the agent's side is
 *   indistinguishable from a dead extension, so it is asserted explicitly rather than left to a
 *   timeout.
 *
 * Note what is NOT reachable here: GitLens' own `No issue identifier provided` / `No Pull Request
 * provided` guards fire only on empty `args`, and the CLI rejects an empty URL before it ever builds
 * a request — so those strings cannot be observed through MCP, and the CLI's own wording is what a
 * client sees.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MaxTimeout } from '../baseTest.js';
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

type ToolResult = { content?: { text?: string }[]; isError?: boolean };
type RefusalPayload = { message?: string; error?: boolean };

const startWork = 'gitlens_start_work';
const startReview = 'gitlens_start_review';

/** Not a URL any provider can resolve, and not empty — so it reaches the extension. */
const malformedUrl = 'not-a-url';

/**
 * Asserts a CLI-side validation refusal and returns its payload.
 *
 * These arrive as a normal result: the CLI reports them through the `{ data }` envelope and leaves
 * `isError` unset, so a client that switches on the protocol flag would read them as success. That
 * is worth pinning precisely because it is the surprising half of the contract.
 */
function expectValidationRefusal(response: McpMessage): RefusalPayload {
	expect(
		response.error,
		`expected a payload refusal, got a JSON-RPC error: ${JSON.stringify(response.error)}`,
	).toBeUndefined();

	const result = response.result as ToolResult | undefined;
	expect(result?.isError, 'the CLI reports validation refusals in the payload, not via isError').toBeFalsy();

	const text = result?.content?.[0]?.text;
	expect(text, 'refusal should carry text content').toBeTruthy();

	const parsed = JSON.parse(text!) as { data?: RefusalPayload };
	expect(parsed).toHaveProperty('data');

	return parsed.data ?? {};
}

/** Local branches in the worker's workspace repository — the invariant a failed call must not move. */
function localBranches(workspacePath: string): string[] {
	const headsDir = path.join(workspacePath, '.git', 'refs', 'heads');
	return existsSync(headsDir) ? readdirSync(headsDir) : [];
}

test.describe('MCP — GitLens write path (validation and failure)', () => {
	test.describe.configure({ mode: 'serial' });

	// These tools drive a wizard that can surface a quick pick. Leaving one open would poison every
	// later spec in this worker, so each case starts and ends from a clean UI.
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('gitlens_start_work refuses a missing issue_url in the payload', async ({ mcpClient, vscode }) => {
		const payload = expectValidationRefusal(
			await mcpClient.callTool(startWork, { directory: vscode.electron.workspacePath }),
		);

		expect(payload).toEqual({ message: "missing 'issue_url' parameter", error: true });
	});

	test('gitlens_start_review refuses a missing pr_url in the payload', async ({ mcpClient, vscode }) => {
		const payload = expectValidationRefusal(
			await mcpClient.callTool(startReview, { directory: vscode.electron.workspacePath }),
		);

		expect(payload).toEqual({ message: "missing 'pr_url' parameter", error: true });
	});

	test('gitlens_start_work refuses a missing directory in the payload', async ({ mcpClient }) => {
		// `directory` is checked before the URL, so this stays a CLI-side refusal even with a URL given.
		const payload = expectValidationRefusal(
			await mcpClient.callTool(startWork, { issue_url: 'https://github.com/o/r/issues/1' }),
		);

		expect(payload).toEqual({ message: "missing 'directory' parameter", error: true });
	});

	/**
	 * Regression guard for #5679: with no hosting integration connected — the state every
	 * agent-driven and CI run is in — the Start Work wizard used to fall back to an interactive
	 * "Connect an Integration" step despite `useDefaults`, leaving the MCP call unanswered until it
	 * timed out and a modal picker open in the shared worker instance. The wizard now settles its
	 * deferred with an "integration required" error on the programmatic path instead of prompting, so
	 * the caller gets a refusal and the UI stays clear.
	 */
	test('gitlens_start_work answers a malformed issue URL instead of hanging', async ({ mcpClient, vscode }) => {
		const workspacePath = vscode.electron.workspacePath;
		const before = localBranches(workspacePath);

		const response = await mcpClient.callTool(startWork, {
			directory: workspacePath,
			issue_url: malformedUrl,
		});

		// The wizard cannot resolve the issue, so the extension must report that rather than leave the
		// caller waiting. The text is the extension's (relayed verbatim by the proxy); only the fact
		// that an answer arrived — and that it is a refusal — is asserted, since the wording belongs to
		// whichever step gave up.
		expect(
			response.error,
			`expected the extension to answer a malformed URL; response=${JSON.stringify(response)}`,
		).toBeDefined();

		// A wizard that escaped without settling its deferred would leave a picker on screen and the
		// call unanswered; assert the UI is clear so a future regression names that rather than showing
		// up as an unrelated failure in the next spec.
		await expect(vscode.page.locator('.quick-input-widget')).toBeHidden({ timeout: MaxTimeout });
		expect(localBranches(workspacePath), 'a failed start-work must not leave a branch behind').toEqual(before);
	});

	/** Same guarantee as above (#5679), through the review wizard. */
	test('gitlens_start_review answers a malformed PR URL instead of hanging', async ({ mcpClient, vscode }) => {
		const workspacePath = vscode.electron.workspacePath;
		const before = localBranches(workspacePath);

		const response = await mcpClient.callTool(startReview, {
			directory: workspacePath,
			pr_url: malformedUrl,
		});

		expect(
			response.error,
			`expected the extension to answer a malformed URL; response=${JSON.stringify(response)}`,
		).toBeDefined();

		await expect(vscode.page.locator('.quick-input-widget')).toBeHidden({ timeout: MaxTimeout });
		expect(
			localBranches(workspacePath),
			'a failed start-review must not leave a branch or worktree behind',
		).toEqual(before);
	});
});
