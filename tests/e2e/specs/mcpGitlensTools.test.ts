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
 *   call answers an `isError` result carrying `"GitLens '<tool>' server not found"`
 *   — the same channel every other handler failure takes — and `publishCli` lives
 *   inside `startIpc`, so the IPC discovery file is never written either and the
 *   `mcpClient` fixture ends up unpinned. `tests/e2e/baseTest.ts` therefore sets
 *   `gitlens.ai.enabled` explicitly rather than leaning on the packaged default.
 * - Publication is NOT evidence of any of that: the CLI builds its toolset once at
 *   server construction and treats an unknown GitLens version as compatible, so
 *   `tools/list` shows the full `gitlens_*` set even against a dead extension. Surface
 *   and mode gating are covered by `mcpSurface.test.ts`; this file covers the part that
 *   listing cannot prove — the call actually reaching the live extension host.
 * - A successful call wraps its payload in `{ data: ... }` inside `result.content[0].text`
 *   (no `data.output` wrapper — unlike the git tools), optionally alongside a `summary`.
 * - A GitLens handler that *throws* comes back as a result with `isError: true` carrying the
 *   extension's own message as plain text rather than as a payload — the CLI answered these with a
 *   JSON-RPC `-32603` until `a9585eb9` ("report every MCP tool failure on one channel with isError
 *   set"), first shipped in v3.1.76. `gitlens_launchpad` throws exactly that way when no integration
 *   is connected (`handleGetLaunchpadCore` throws before reaching Launchpad) — which is this
 *   harness's default state, since it runs signed out. That refusal is therefore a normal outcome
 *   here, and it evidences the round-trip just as well as a payload does: the wording is GitLens',
 *   not the proxy's.
 *
 * These tools act on the live instance, so the calls target the VS Code workspace
 * directory (the worker's temp repo), not a throwaway repo.
 */
import { MaxTimeout } from '../baseTest.js';
import type { McpMessage } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

type GitlensToolResult = { content?: { text?: string }[]; isError?: boolean };

/**
 * The `{ data, summary }` envelope a `gitlens_*` tool response carries, **after validation**.
 *
 * `data` is required here even though the wire form can omit it — the CLI leaves the key out
 * entirely for a nil payload — because that omission is exactly what
 * {@link parseGitlensToolResponse} rejects. Everything it hands back has one, so callers should
 * not have to re-check. `summary` stays optional: the CLI genuinely omits it for an empty summary.
 */
type GitlensToolEnvelope = { data: unknown; summary?: string };

const openGraph = 'gitlens_open_graph';

/** GitLens' own refusal when Launchpad is asked for items with no hosting integration connected. */
const launchpadDisconnected = 'No connected integrations.';

/** Server mode that publishes `gitlens_open_graph`; every other tool here needs no flags. */
const experimentalMode = { experimental: true } as const;

/**
 * Parses the envelope out of a `gitlens_*` response, asserting the error flag either way.
 *
 * Fails loudly on a JSON-RPC error — nothing a handler decides arrives on that channel any more, so
 * one here means the call never reached a handler at all (an unknown tool, or a transport fault).
 *
 * Only the refusals the CLI itself decides reach this helper: those keep the `{ data }` envelope a
 * success uses and set `isError` alongside it, which is why callers say which of the two they expect.
 * A refusal GitLens threw is relayed as plain text with no envelope, so the launchpad test reads that
 * one directly instead of parsing it here.
 */
function parseGitlensEnvelope(response: McpMessage, errorFlag: boolean): GitlensToolEnvelope {
	expect(response.error, `unexpected JSON-RPC error: ${JSON.stringify(response.error)}`).toBeUndefined();

	const result = response.result as GitlensToolResult | undefined;
	expect(
		result?.isError ?? false,
		`expected the tool result error flag to be ${String(errorFlag)}; text=${result?.content?.[0]?.text}`,
	).toBe(errorFlag);

	const text = result?.content?.[0]?.text;
	expect(text, 'tool response should carry text content').toBeTruthy();

	// Parsed as partial, returned as validated: the envelope only earns its required `data` once the
	// assertion below has rejected the nil-payload form the CLI emits without the key.
	let parsed: Partial<GitlensToolEnvelope>;
	try {
		parsed = JSON.parse(text!) as Partial<GitlensToolEnvelope>;
	} catch (ex) {
		throw new Error(`tool response text was not valid JSON: ${text!.slice(0, 200)}`, { cause: ex });
	}
	expect(parsed).toHaveProperty('data');
	return parsed as GitlensToolEnvelope;
}

/** Parses the envelope out of a successful `gitlens_*` response. */
function parseGitlensToolResponse(response: McpMessage): GitlensToolEnvelope {
	return parseGitlensEnvelope(response, false);
}

/** Parses the envelope out of a `gitlens_*` refusal — same shape, error flag set. */
function parseGitlensRefusal(response: McpMessage): GitlensToolEnvelope {
	return parseGitlensEnvelope(response, true);
}

/** Unwraps just the `data` payload from a successful `gitlens_*` response. */
function gitlensToolData(response: McpMessage): unknown {
	return parseGitlensToolResponse(response).data;
}

test.describe('MCP — GitLens Tools', () => {
	test.describe.configure({ mode: 'serial' });

	// The VS Code instance is worker-scoped and reused across spec files, and these tools surface UI.
	// Starting every case from a closed side bar makes "the Graph view is showing" a state change this
	// spec caused rather than one it inherited — which is what the open-graph assertions rest on.
	test.beforeEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('gitlens_launchpad round-trips into the live instance', async ({ mcpClient, vscode }) => {
		const directory = vscode.electron.workspacePath;

		const response = await mcpClient.callTool('gitlens_launchpad', { directory: directory });

		// Both outcomes evidence the round-trip; which one occurs depends on the account state the
		// harness happens to have, so both are accepted — but each is pinned to its own exact shape so
		// an unrelated failure still fails. Signed out with no integration connected (the default),
		// GitLens' own handler throws and the proxy relays it verbatim as an isError result; the
		// assertion is on that specific message, so a "server not found" — the symptom of handlers
		// never registering — is NOT accepted here.
		expect(response.error, `unexpected JSON-RPC error: ${JSON.stringify(response.error)}`).toBeUndefined();

		const result = response.result as GitlensToolResult | undefined;
		if (result?.isError) {
			const text = result.content?.[0]?.text ?? '';
			expect(text).toContain(launchpadDisconnected);
			// GitLens' own message is relayed as plain text; an enveloped body carrying the same words
			// would mean the CLI answered for it, which is a different outcome than this branch claims.
			expect(text, `GitLens' refusal is relayed as plain text, not an envelope: ${text}`).not.toMatch(/^\s*\{/);
			return;
		}

		// With an integration connected the call resolves normally. Validate the payload SHAPE, not the
		// message wording (which the gk proxy controls and could reword): an empty result yields a
		// `{ message }` no-op, actionable PRs yield `{ items }`.
		const data = gitlensToolData(response);
		// Guard against a null/non-object payload so an unexpected shape fails with the readable
		// assertion below rather than a TypeError on property access.
		const payload = (data ?? {}) as { message?: string; items?: unknown[] };

		expect(
			typeof payload.message === 'string' || Array.isArray(payload.items),
			`unexpected launchpad payload: ${JSON.stringify(data)}`,
		).toBeTruthy();
	});

	/**
	 * `gitlens_open_graph` is the experimental, non-mutating GitLens tool. Two properties of the
	 * implementation shape what these tests can claim, both read from source rather than inferred
	 * from the tool description:
	 *
	 * - The CLI sends a bare `GET <address>/graph` — no query, no body — so the `directory` argument
	 *   never reaches GitLens. It only selects *which* discovered instance to call. With `cwd` and
	 *   `args` empty, `handleGraphCommand` takes its no-repository branch and runs
	 *   `gitlens.showGraphView`, which reveals the side-bar view. So the assertion is "the Commit
	 *   Graph view opened in this instance", never "on the requested repository".
	 * - `{ opened: true }` is a constant the CLI synthesizes; it discards the extension's response
	 *   body. On its own it proves only that the IPC route answered without an HTTP error. Pairing it
	 *   with the view-visibility assertion is what makes the round-trip claim hold — neither half is
	 *   sufficient alone, so both stay.
	 *
	 * The view is asserted, never its contents: this harness runs signed out, and a signed-out Commit
	 * Graph replaces its entire webview with the account screen, so no graph tree or rows appear.
	 */
	test('gitlens_open_graph opens the Commit Graph view in the live instance', async ({ mcpClient, vscode }) => {
		await expect(vscode.gitlens.commitGraphViewSection).toBeHidden({ timeout: MaxTimeout });

		const envelope = parseGitlensToolResponse(
			await mcpClient.callTool(openGraph, { directory: vscode.electron.workspacePath }, experimentalMode),
		);

		expect(envelope.data).toEqual({ opened: true });
		expect(envelope.summary).toBe('Opened GitLens graph');

		await expect(vscode.gitlens.commitGraphViewSection).toBeVisible({ timeout: MaxTimeout });
	});

	test('gitlens_open_graph is not callable without --experimental', async ({ mcpClient, vscode }) => {
		// `mcpSurface.test.ts` covers the tool's absence from `tools/list`; what matters here is that a
		// client calling it anyway is refused rather than quietly served — and that nothing opens.
		const response = await mcpClient.callTool(openGraph, { directory: vscode.electron.workspacePath });

		// A JSON-RPC error, not a tool result: the tool was never added to the server, so the refusal
		// comes from the MCP framework before any handler runs. The code and wording are that
		// framework's, so they are deliberately not pinned here — `mcp.test.ts` treats its own
		// unknown-tool case the same way. What matters is that nothing resolved.
		expect(
			response.error,
			`expected a refusal without --experimental; response=${JSON.stringify(response)}`,
		).toBeDefined();
		expect(response.result).toBeUndefined();

		await expect(vscode.gitlens.commitGraphViewSection).toBeHidden({ timeout: MaxTimeout });
	});

	test('gitlens_open_graph reports a missing directory in the payload, with the error flag set', async ({
		mcpClient,
		vscode,
	}) => {
		// The CLI validates `directory` before it resolves a server, and reports the refusal through
		// the same `{ data }` envelope a success uses, with the protocol-level error flag set alongside
		// it. Pinning both documents the two places a client may read the refusal from.
		const envelope = parseGitlensRefusal(await mcpClient.callTool(openGraph, {}, experimentalMode));

		expect(envelope.data).toEqual({ message: "missing 'directory' parameter", error: true });

		await expect(vscode.gitlens.commitGraphViewSection).toBeHidden({ timeout: MaxTimeout });
	});
});
