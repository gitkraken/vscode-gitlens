/**
 * MCP E2E — Surface and Mode Contract
 *
 * Guards the tool surface GitLens owns: which `gitlens_*` tools the bundled MCP server publishes
 * in each mode, and the parameters they declare. A regression on either side of the boundary — the
 * extension dropping an IPC route, or the CLI changing its gating — shows up here as a diff in the
 * published list rather than as a mysterious failure deep in a round-trip test.
 *
 * Source of truth (gk CLI `internal/mcp/internal/tools/gitlens.go` + `cmd/gk/mcp/mcp.go`):
 * - `GetToolset(readOnly)` publishes `gitlens_launchpad` always, `gitlens_start_work` and
 *   `gitlens_start_review` only when not read-only, and `gitlens_open_graph` only with
 *   `--experimental`.
 * - Exactly four tools carry the `gitlens_` prefix, so asserting the *exact* set per mode doubles as
 *   the rename guard the tracker asks for: a renamed, dropped, or newly added GitLens tool fails
 *   here and has to be acknowledged in this spec.
 * - Every mode is a process argument, so each mode is a separate `gk mcp` spawn — the modes cannot
 *   be switched on a live server.
 *
 * Ambient requirement: the `gitlens_*` tools are published only once the CLI has pinged the live
 * extension and learned its version (`supportsRegisteredTool`), which in turn needs the IPC handlers
 * registered — i.e. GitLens' AI features enabled (`gitlens.ai.enabled`, on by default). If that
 * breaks, *all* GitLens tools vanish at once, which `expectGitlensSurface` reports explicitly
 * instead of letting it read as a gating regression.
 */
import type { McpServerMode, McpToolDefinition } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

const launchpad = 'gitlens_launchpad';
const openGraph = 'gitlens_open_graph';
const startReview = 'gitlens_start_review';
const startWork = 'gitlens_start_work';

/** The GitLens-owned tools, sorted, as published in each mode. */
const expectedSurface = {
	default: [launchpad, startReview, startWork],
	readonly: [launchpad],
	experimental: [launchpad, openGraph, startReview, startWork],
} satisfies Record<string, string[]>;

/** The parameters each GitLens tool declares as required (`mcp.Required()` in the CLI registry). */
const expectedRequiredParams: Record<string, string[]> = {
	[launchpad]: ['directory'],
	[openGraph]: ['directory'],
	[startReview]: ['directory', 'pr_url'],
	[startWork]: ['directory', 'issue_url'],
};

function gitlensToolNames(definitions: McpToolDefinition[]): string[] {
	return definitions
		.filter(t => t.name.startsWith('gitlens_'))
		.map(t => t.name)
		.sort();
}

/**
 * Asserts the exact set of `gitlens_*` tools for a mode.
 *
 * An empty set is called out separately: it means the CLI never resolved the live extension (no IPC
 * discovery file, handlers not registered, or a version gate), not that mode gating changed.
 */
function expectGitlensSurface(definitions: McpToolDefinition[], expected: string[], mode: string): void {
	const published = gitlensToolNames(definitions);

	expect(
		published.length,
		`no gitlens_* tools published in ${mode} mode — the CLI could not resolve the live extension (IPC discovery missing, IPC handlers not registered, or the GitLens version gate rejected it), so mode gating cannot be evaluated. Published tools: ${definitions
			.map(t => t.name)
			.sort()
			.join(', ')}`,
	).toBeGreaterThan(0);

	expect(published, `unexpected gitlens_* surface in ${mode} mode`).toEqual(expected);
}

test.describe('MCP — Surface and Mode Contract', () => {
	test.describe.configure({ mode: 'serial' });

	// ── Mode gating ──────────────────────────────────────────────────────────

	test('publishes the read-write, non-experimental surface by default', async ({ mcpClient }) => {
		const definitions = await mcpClient.listToolDefinitions();

		expectGitlensSurface(definitions, expectedSurface.default, 'default');
		// Called out explicitly (though implied by the exact set above): the experimental tool must
		// stay behind its flag, since it opens UI in the live instance.
		expect(gitlensToolNames(definitions)).not.toContain(openGraph);
	});

	test('drops the mutating tools in read-only mode', async ({ mcpClient }) => {
		const mode: McpServerMode = { readonly: true };
		const definitions = await mcpClient.listToolDefinitions(mode);

		// Both write-path tools create refs in the working tree (a branch, and a worktree for review),
		// so read-only mode must not offer them at all.
		expectGitlensSurface(definitions, expectedSurface.readonly, 'read-only');
	});

	test('adds gitlens_open_graph with --experimental', async ({ mcpClient }) => {
		const mode: McpServerMode = { experimental: true };
		const definitions = await mcpClient.listToolDefinitions(mode);

		expectGitlensSurface(definitions, expectedSurface.experimental, 'experimental');
	});

	test('keeps read-only gating under --experimental', async ({ mcpClient }) => {
		// The two flags are independent: the experimental flag must not smuggle the mutating tools
		// back into a read-only server.
		const mode: McpServerMode = { readonly: true, experimental: true };
		const definitions = await mcpClient.listToolDefinitions(mode);

		expectGitlensSurface(definitions, [launchpad, openGraph], 'read-only experimental');
	});

	// ── Declared parameters ──────────────────────────────────────────────────

	test('declares the required parameters of every GitLens tool', async ({ mcpClient }) => {
		// Experimental mode is the only one that exposes all four tools at once, so assert the whole
		// registry from a single listing.
		const definitions = await mcpClient.listToolDefinitions({ experimental: true });
		expectGitlensSurface(definitions, expectedSurface.experimental, 'experimental');

		for (const [name, required] of Object.entries(expectedRequiredParams)) {
			const definition = definitions.find(t => t.name === name);
			expect(definition, `${name} should be published`).toBeDefined();

			expect((definition!.inputSchema?.required ?? []).sort(), `unexpected required params for ${name}`).toEqual(
				required,
			);
			// The required params must exist as declared properties, otherwise a client can't build a
			// valid call for them.
			for (const param of required) {
				expect(definition!.inputSchema?.properties ?? {}, `${name} should declare "${param}"`).toHaveProperty(
					param,
				);
			}
		}
	});
});
