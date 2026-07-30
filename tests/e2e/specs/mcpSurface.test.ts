/**
 * MCP E2E — Surface and Mode Contract
 *
 * Guards the tool surface GitLens depends on: which `gitlens_*` tools the bundled MCP server
 * publishes in each server mode, and the parameters those tools declare. GitLens installs the gk
 * binary itself and pins no version, so this is the guard that notices when the surface the
 * extension was written against changes underneath it.
 *
 * Source of truth (gk CLI `internal/mcp/internal/tools/gitlens.go` + `cmd/gk/mcp/mcp.go`):
 * - `GetToolset(readOnly)` publishes `gitlens_launchpad` always, `gitlens_start_work` and
 *   `gitlens_start_review` only when not read-only, and `gitlens_open_graph` only with
 *   `--experimental`. The read-only and experimental gates are independent.
 * - Each mode is a process argument, so every mode is its own `gk mcp` spawn — modes cannot be
 *   switched on a live server.
 * - Exactly four tools carry the `gitlens_` prefix, so asserting the *exact* set per mode doubles as
 *   the rename guard: a renamed, dropped, or added GitLens tool fails here and has to be
 *   acknowledged in this spec. The prefix has moved before (v3.1.69's `gitlens_commit_composer`
 *   became `git_commit_composer` in v3.1.70), which is exactly why it is pinned.
 *
 * What this spec deliberately does NOT claim: it does not prove the round-trip into the live
 * extension. Publication is decided at server construction from the CLI's own registry — the version
 * gate (`supportsRegisteredTool`) treats an *unknown* GitLens version as compatible, so a dead
 * extension, a missing IPC discovery file, or unregistered handlers all still yield the full set.
 * Round-trip coverage lives in `mcpGitlensTools.test.ts`. Consequently a failure here points at the
 * gk build GitLens resolved (or at a GitLens version below the registry minimum of v17.10.0), not at
 * extension-side state.
 */
import type { McpToolDefinition } from '../fixtures/mcp.js';
import { expect, mcpTest as test } from '../fixtures/mcp.js';

const launchpad = 'gitlens_launchpad';
const openGraph = 'gitlens_open_graph';
const startReview = 'gitlens_start_review';
const startWork = 'gitlens_start_work';

/**
 * The GitLens-owned tools as published in each mode. Listing order carries no meaning — the CLI is
 * free to reorder its registry, so every assertion below sorts both sides and compares sets.
 */
const expectedSurface = {
	default: [launchpad, startReview, startWork],
	readonly: [launchpad],
	experimental: [launchpad, openGraph, startReview, startWork],
	readonlyExperimental: [launchpad, openGraph],
} satisfies Record<string, string[]>;

/**
 * The parameters each GitLens tool declares (`mcp.WithString` + `mcp.Required()` in the CLI
 * registry), split by whether the schema marks them required.
 *
 * The optional ones matter as much as the required ones: GitLens reads `instructions` positionally
 * out of the forwarded args (`src/env/node/gk/cli/commands.ts` `handleStartReviewCommand` /
 * `handleStartWorkCommand`), so a dropped or renamed optional parameter breaks that plumbing
 * silently — no error, just instructions that never arrive.
 */
const expectedParams = {
	[launchpad]: { required: ['directory'], optional: [] },
	[openGraph]: { required: ['directory'], optional: [] },
	[startReview]: { required: ['directory', 'pr_url'], optional: ['instructions'] },
	[startWork]: { required: ['directory', 'issue_url'], optional: ['instructions'] },
} satisfies Record<string, { required: string[]; optional: string[] }>;

function gitlensToolNames(definitions: McpToolDefinition[]): string[] {
	return definitions
		.filter(t => t.name.startsWith('gitlens_'))
		.map(t => t.name)
		.sort();
}

/**
 * Asserts the exact set of `gitlens_*` tools for a mode.
 *
 * An empty set is called out separately because it has a different cause than a wrong set: the CLI
 * registry no longer publishes GitLens tools at all, or it pinged GitLens and rejected its version —
 * neither of which is a mode-gating change.
 */
function expectGitlensSurface(definitions: McpToolDefinition[], expected: string[], mode: string): void {
	const published = gitlensToolNames(definitions);

	expect(
		published.length,
		`no gitlens_* tools published in ${mode} mode — the gk build dropped its GitLens registry entries, or it rejected the running GitLens version (registry minimum v17.10.0), so mode gating cannot be evaluated. Published tools: ${definitions
			.map(t => t.name)
			.sort()
			.join(', ')}`,
	).toBeGreaterThan(0);

	expect(published, `unexpected gitlens_* surface in ${mode} mode — check the resolved gk build`).toEqual(
		[...expected].sort(),
	);
}

test.describe('MCP — Surface and Mode Contract', () => {
	// Serial so the tests share this file's single worker: the worker-scoped VS Code instance is the
	// expensive part, and under the config's `fullyParallel` these otherwise-independent tests would
	// be spread across workers, each launching its own editor for a listing that needs none.
	test.describe.configure({ mode: 'serial' });

	// ── Mode gating ──────────────────────────────────────────────────────────

	test('publishes the read-write, non-experimental surface by default', async ({ mcpClient }) => {
		expectGitlensSurface(await mcpClient.listToolDefinitions(), expectedSurface.default, 'default');
	});

	test('drops the mutating tools in read-only mode', async ({ mcpClient }) => {
		// Both write-path tools create refs in the working tree (a branch, and a worktree for review),
		// so read-only mode must not offer them at all.
		const definitions = await mcpClient.listToolDefinitions({ readonly: true });

		expectGitlensSurface(definitions, expectedSurface.readonly, 'read-only');
	});

	test('adds gitlens_open_graph with --experimental', async ({ mcpClient }) => {
		const definitions = await mcpClient.listToolDefinitions({ experimental: true });

		expectGitlensSurface(definitions, expectedSurface.experimental, 'experimental');
	});

	test('keeps read-only gating under --experimental', async ({ mcpClient }) => {
		// The two gates are independent: the experimental flag must not smuggle the mutating tools back
		// into a read-only server.
		const definitions = await mcpClient.listToolDefinitions({ readonly: true, experimental: true });

		expectGitlensSurface(definitions, expectedSurface.readonlyExperimental, 'read-only experimental');
	});

	// ── Declared parameters ──────────────────────────────────────────────────

	test('declares the parameters of every GitLens tool', async ({ mcpClient }) => {
		// Experimental mode is the only one that exposes all four tools at once, so assert the whole
		// registry from a single listing.
		const definitions = await mcpClient.listToolDefinitions({ experimental: true });
		expectGitlensSurface(definitions, expectedSurface.experimental, 'experimental');

		for (const [name, params] of Object.entries(expectedParams)) {
			// Guaranteed by the exact-set assertion above; thrown rather than asserted so the loop body
			// stays narrowed to a defined definition.
			const definition = definitions.find(t => t.name === name);
			if (definition == null) throw new Error(`${name} is missing from the published tools`);

			expect(
				[...(definition.inputSchema?.required ?? [])].sort(),
				`unexpected required params for ${name}`,
			).toEqual([...params.required].sort());
			// Exact property set, so a dropped or renamed optional parameter fails too.
			expect(
				Object.keys(definition.inputSchema?.properties ?? {}).sort(),
				`unexpected params for ${name}`,
			).toEqual([...params.required, ...params.optional].sort());
		}
	});
});
