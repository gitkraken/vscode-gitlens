/**
 * MCP E2E Smoke Tests
 *
 * Validates MCP server functionality via the gk CLI:
 * - Configuration output format
 * - Tool discovery (tools/list)
 * - Basic tool invocations (tools/call)
 *
 * Uses the mcpTest fixture which provides a ready-to-use McpClient
 * connected to the gk CLI installed by the current VS Code instance.
 */
import { expect, mcpTest as test } from '../fixtures/mcp.js';

// MCP tests run serially on a single VS Code worker instance.
// The gk CLI is shared state — parallel calls can cause port/IPC conflicts.
test.describe.configure({ mode: 'serial' });

test.describe('MCP — Configuration', () => {
	test('should return valid server configuration from getMcpConfig', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		expect(config).toBeDefined();
		expect(config.name).toBeTruthy();
		expect(config.type).toBe('stdio');
		expect(config.command).toBeTruthy();
		expect(config.args).toBeInstanceOf(Array);
		expect(config.args.length).toBeGreaterThan(0);
	});

	test('should include mcp subcommand in config args', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		// The server args should include the "mcp" subcommand
		expect(config.args).toContain('mcp');
	});

	// These two tests require PR #5114 (registers gitlens.gitkraken.mcp.experimental.enabled
	// in package.json and injects --experimental into server args).
	// withSettings() logs a warning but does not throw for unregistered settings,
	// so the test proceeds to the expect assertion where the real failure is visible.

	test('should include --experimental in args when setting is enabled', async ({ mcpClient, vscode }) => {
		using _ = await vscode.gitlens.withSettings({
			'gitlens.gitkraken.mcp.experimental.enabled': true,
		});

		const config = await mcpClient.getMcpConfig({ experimental: true });

		expect(config).toBeDefined();
		expect(config.type).toBe('stdio');
		expect(config.args).toContain('--experimental');
	});

	test('should not include --experimental in args when setting is disabled', async ({ mcpClient, vscode }) => {
		using _ = await vscode.gitlens.withSettings({
			'gitlens.gitkraken.mcp.experimental.enabled': false,
		});

		const config = await mcpClient.getMcpConfig({ experimental: false });

		expect(config).toBeDefined();
		expect(config.type).toBe('stdio');
		expect(config.args).not.toContain('--experimental');
	});
});

test.describe('MCP — Tool Discovery', () => {
	test('should return a non-empty list of tools', async ({ mcpClient }) => {
		const tools = await mcpClient.listTools();

		expect(tools).toBeInstanceOf(Array);
		expect(tools.length).toBeGreaterThan(0);
	});

	test('should include git-related tools', async ({ mcpClient }) => {
		const tools = await mcpClient.listTools();
		const gitTools = tools.filter(t => /git/i.test(t));

		// The MCP server should expose at least some git-related tools
		expect(gitTools.length).toBeGreaterThan(0);
	});

	test('should include gitlens-specific tools', async ({ mcpClient }) => {
		const tools = await mcpClient.listTools();
		const gitlensTools = tools.filter(t => t.startsWith('gitlens_'));

		expect(gitlensTools.length).toBeGreaterThan(0);
		expect(gitlensTools).toContain('gitlens_commit_composer');
		expect(gitlensTools).toContain('gitlens_launchpad');
		expect(gitlensTools).toContain('gitlens_start_review');
		expect(gitlensTools).toContain('gitlens_start_work');
	});

	test('should return consistent results on repeated calls', async ({ mcpClient }) => {
		const first = await mcpClient.listTools();
		const second = await mcpClient.listTools();

		expect(first.sort()).toEqual(second.sort());
	});
});
