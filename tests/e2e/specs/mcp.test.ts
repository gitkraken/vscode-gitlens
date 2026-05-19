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
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import * as process from 'node:process';
import { expect, mcpTest as test, readIpcDiscoveryFile } from '../fixtures/mcp.js';
import { McpClient } from '../helpers/mcpHelper.js';

test.describe('MCP — Configuration', () => {
	// Tests within each block run serially (shared gk CLI state),
	// but blocks themselves are independent — a failure in one block
	// does not prevent other blocks from running.
	test.describe.configure({ mode: 'serial' });

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

		expect(config.args).toContain('mcp');
	});

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
	test.describe.configure({ mode: 'serial' });

	test('should return a non-empty list of tools', async ({ mcpClient }) => {
		const tools = await mcpClient.listTools();

		expect(tools).toBeInstanceOf(Array);
		expect(tools.length).toBeGreaterThan(0);
	});

	test('should include git-related tools', async ({ mcpClient }) => {
		const tools = await mcpClient.listTools();
		const gitTools = tools.filter(t => /git/i.test(t));

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

test.describe('MCP — Tool Invocation', () => {
	test.describe.configure({ mode: 'serial' });

	test('should return an error for unknown tool', async ({ mcpClient }) => {
		const response = await mcpClient.callTool('nonexistent_tool_12345', {});

		// MCP spec: unknown tool should return an error response, not crash
		expect(response).toBeDefined();
		expect(response.error).toBeDefined();
	});

	test('should return a valid response for a known tool', async ({ mcpClient }) => {
		const tools = await mcpClient.listTools();
		expect(tools.length).toBeGreaterThan(0);

		// Pick the first tool that looks safe to call without args
		const safeToolCandidates = tools.filter(t => /status|list|log|diff|branch/i.test(t));
		const toolName = safeToolCandidates[0] ?? tools[0];

		const response = await mcpClient.callTool(toolName, {});

		// Should get a response (either result or error), not a timeout/crash
		expect(response).toBeDefined();
		expect(response.jsonrpc).toBe('2.0');
	});
});

// ============================================================================
// IPC Discovery
// ============================================================================

test.describe('MCP — IPC Discovery', () => {
	test.describe.configure({ mode: 'serial' });

	test('should find IPC discovery file for current workspace', async ({ mcpClient, vscode }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const workspacePath = vscode.electron.workspacePath;
		expect(existsSync(ipcPath!)).toBe(true);

		// Verify the matched file actually contains our workspace (case-insensitive for Windows)
		const data = readIpcDiscoveryFile(ipcPath!);
		expect(data).toBeDefined();
		if (data == null) return;

		expect(data.workspacePaths).toBeInstanceOf(Array);
		const wsLower = (data.workspacePaths ?? []).map(p => p.toLowerCase());
		expect(wsLower).toContain(workspacePath.toLowerCase());
	});

	test('should contain valid IPC discovery data', async ({ mcpClient }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const data = readIpcDiscoveryFile(ipcPath!);
		expect(data).toBeDefined();
		if (data == null) return;

		expect(data.token).toBeTruthy();
		expect(data.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(data.port).toBeGreaterThan(0);
		expect(data.pid).toBeGreaterThan(0);
		expect(data.scheme).toBeTruthy();
	});

	test('should include workspace paths in discovery data', async ({ mcpClient }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const data = readIpcDiscoveryFile(ipcPath!);
		expect(data).toBeDefined();
		if (data == null) return;

		expect(data.workspacePaths).toBeInstanceOf(Array);
		expect(data.workspacePaths?.length).toBeGreaterThan(0);
	});

	test('should include IDE metadata in discovery data', async ({ mcpClient }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const data = readIpcDiscoveryFile(ipcPath!);
		expect(data).toBeDefined();
		if (data == null) return;

		expect(data.scheme).toBe('vscode');
	});
});

// ============================================================================
// CLI Installation Verification
// ============================================================================

test.describe('MCP — CLI Installation', () => {
	test.describe.configure({ mode: 'serial' });

	test('should install gk CLI binary on activation', async ({ mcpClient }) => {
		expect(existsSync(mcpClient.gkPath)).toBe(true);
	});

	test('should have correct binary file size', async ({ mcpClient }) => {
		const stats = statSync(mcpClient.gkPath);

		// gk binary should be a substantial executable, not a stub
		expect(stats.size).toBeGreaterThan(1_000_000);
	});

	test('should report CLI version via gk version', async ({ mcpClient }) => {
		const output = execSync(`"${mcpClient.gkPath}" version`, { encoding: 'utf8' }).trim();

		// Proxy binary returns "CLI Core: X.Y.Z\nCLI Installer: X.Y.Z"
		expect(output).toContain('CLI Core:');
		expect(output).toMatch(/\d+\.\d+\.\d+/);
	});

	test('should have executable permissions on Unix', async ({ mcpClient }) => {
		test.skip(process.platform === 'win32', 'Permission check not applicable on Windows');

		const stats = statSync(mcpClient.gkPath);
		const mode = stats.mode & 0o777;

		// Owner execute bit should be set (at minimum 0o755)
		expect(mode & 0o100).toBeTruthy();
	});
});

// ============================================================================
// MCP Registration (IDE-specific)
// ============================================================================

test.describe('MCP — Registration', () => {
	test.describe.configure({ mode: 'serial' });

	test('should provide VS Code server definition with correct scheme', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		expect(config.args).toContain('--scheme=vscode');
	});

	test('should provide server definition with gitlens source', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		expect(config.args).toContain('--source=gitlens');
	});

	test('should provide server definition with correct host', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		expect(config.args).toContain('--host=vscode');
	});

	test('should return cursor scheme when configured for cursor', async ({ mcpClient }) => {
		const cursorClient = new McpClient(mcpClient.gkPath, mcpClient.ipcFilePath, 'cursor');
		const config = await cursorClient.getMcpConfig();

		expect(config.args).toContain('--host=cursor');
		expect(config.args).toContain('--scheme=cursor');
	});
});

// ============================================================================
// Settings & Feature Flags
// ============================================================================

test.describe('MCP — Settings & Feature Flags', () => {
	test.describe.configure({ mode: 'serial' });

	// CLI does not yet support --insiders in `gk mcp config` (see gitkraken/gkcli#724).
	// When supported, the returned command should point to gk-insiders (pre-release binary).
	test.fixme('should return gk-insiders command when insiders option is set', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig({ insiders: true });

		expect(config).toBeDefined();
		expect(config.type).toBe('stdio');
		expect(config.command).toMatch(/gk-insiders/);
	});

	test('should return gk command (not insiders) by default', async ({ mcpClient }) => {
		const config = await mcpClient.getMcpConfig();

		expect(config).toBeDefined();
		expect(config.command).not.toMatch(/gk-insiders/);
	});
});

// ============================================================================
// Error Resilience
// ============================================================================

test.describe('MCP — Error Resilience', () => {
	test.describe.configure({ mode: 'serial' });

	test('should return valid config even without IPC file', async ({ mcpClient }) => {
		const noIpcClient = new McpClient(mcpClient.gkPath, undefined);
		const config = await noIpcClient.getMcpConfig();

		expect(config).toBeDefined();
		expect(config.name).toBeTruthy();
		expect(config.type).toBe('stdio');
	});

	test('should list tools even without IPC file', async ({ mcpClient }) => {
		const noIpcClient = new McpClient(mcpClient.gkPath, undefined);
		const tools = await noIpcClient.listTools();

		expect(tools).toBeInstanceOf(Array);
		expect(tools.length).toBeGreaterThan(0);
	});

	test('should handle tool call gracefully without IPC file', async ({ mcpClient }) => {
		const noIpcClient = new McpClient(mcpClient.gkPath, undefined);
		const response = await noIpcClient.callTool('nonexistent_tool', {});

		expect(response).toBeDefined();
		expect(response.jsonrpc).toBe('2.0');
	});
});
