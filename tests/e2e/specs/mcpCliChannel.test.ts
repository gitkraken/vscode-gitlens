/**
 * MCP — GK CLI release channel
 *
 * Opt-in: skipped unless `GL_E2E_CLI_INSIDERS` is `1`, `true` or `yes` (case-insensitive) — anything
 * else, including an unset variable and the empty string CI passes when its input is unchecked, skips.
 * Tagged `@cli-insiders` so it can be selected (`--grep @cli-insiders`). "Insiders" here is the GK **CLI's**
 * pre-release channel — VS Code's own insiders channel is a different axis (`VSCODE_VERSION`,
 * `pnpm run test:e2e:insiders`).
 *
 * Do NOT add `@cli-insiders` to a project's `grepInvert`: project-level `grepInvert` wins over
 * `--grep`, which would make these tests unselectable rather than merely off by default.
 *
 * Why opt-in. Running this installs the CLI's pre-release proxy edition and, through it, a
 * pre-release core. The proxy lands in the throwaway profile's `globalStorage`, but the core does
 * not — it goes to the machine-wide CLI data directory, which no harness temp dir cleans up. What
 * keeps the rest of the suite unaffected is that the CLI suffixes its insiders layout
 * (`gk-insiders`, `mcp_resources_insiders`, its own `versions/` entry), NOT the `vscodeOptions`
 * override — that only buys this spec its own editor instance. Point `XDG_DATA_HOME` at a scratch
 * directory to keep a run out of the real install entirely.
 *
 * What this covers that the stable specs cannot is GitLens's own decision rather than the CLI's
 * contract: the setting selects which proxy EDITION `CliBinaryInstaller` fetches, and the installed
 * proxy then resolves a pre-release core with no flag passed at all. GitLens' argv-level injection in
 * `runCLICommand` stays invisible to a client that builds its own argv; its consequence does not.
 */
import { execSync } from 'node:child_process';
import * as process from 'node:process';
import { createTmpDir, GitFixture } from '../baseTest.js';
import { expect, mcpTest } from '../fixtures/mcp.js';

const test = mcpTest.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			// The whole point of this instance. `defaultUserSettings` pins this off for every other
			// spec, so this is a real override rather than a restatement of the packaged default.
			userSettings: { 'gitlens.gitkraken.cli.insiders.enabled': true },
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

/** Windows reports this path with backslashes and arbitrary case on either side of the comparison. */
function normalizePath(p: string): string {
	return process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p;
}

/**
 * Deliberately not a bare presence check: CI passes the switch through a workflow input, and a false
 * input still *sets* the variable to an empty string — which would opt every dispatched run in.
 */
const optedIn = /^(?:1|true|yes)$/i.test(process.env.GL_E2E_CLI_INSIDERS ?? '');

test.describe('MCP — GK CLI release channel', { tag: '@cli-insiders' }, () => {
	// Skipped at describe scope so opting out costs nothing: no editor instance is launched at all.
	test.skip(!optedIn, 'opt-in: set GL_E2E_CLI_INSIDERS=1');

	// Serial for a reason specific to this file: under `fullyParallel` these three would each get
	// their own worker, and a differing worker option means a differing worker hash — three separate
	// insiders instances, three CLI installs. It also keeps the last test's premise (this instance's
	// channel really is insiders) dependent on the first one having proven it.
	test.describe.configure({ mode: 'serial' });

	// The one assertion here about GitLens rather than the CLI: the setting decides which proxy
	// edition gets installed, and a pre-release edition carries a pre-release version suffix.
	test('should install a pre-release proxy edition when the CLI insiders setting is on', ({ mcpClient }) => {
		const version = execSync(`"${mcpClient.gkPath}" version`, { encoding: 'utf8' }).trim();

		expect(version).toMatch(/CLI Installer: \d+\.\d+\.\d+-(?:rc|alpha)\./);
	});

	test('should point the generated config at the pre-release proxy it installed', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig({ insiders: true });

		expect(config.type).toBe('stdio');
		// Whether the flag is echoed into `args` is the CLI's contract and is pinned in gkcli's own
		// unit tests; what matters to GitLens is that the config it will register points at the binary
		// installed for this editor. Same instance, same proxy, so this is not a cross-channel compare.
		expect(normalizePath(config.command)).toBe(normalizePath(mcpClient.gkPath));
	});

	// Worth its own case only here: this instance's channel IS insiders, so it is the one place that
	// can show the emitted flag tracks the flag rather than the resolved channel — the config does not
	// inherit the edition that generated it.
	test('should omit --insiders from server args when the flag is not passed', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		expect(config.type).toBe('stdio');
		expect(config.args).not.toContain('--insiders');
	});
});
