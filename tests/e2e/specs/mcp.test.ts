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
import { existsSync, statSync } from 'node:fs';
import * as process from 'node:process';
import { expect, mcpTest as test, readIpcDiscoveryFile } from '../fixtures/mcp.js';

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
	test.describe.configure({ mode: 'serial' });

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
// Block 2: IPC Discovery
// ============================================================================

test.describe('MCP — IPC Discovery', () => {
	test.describe.configure({ mode: 'serial' });

	test('should create IPC discovery file for current VS Code PID', async ({ mcpClient, vscode }) => {
		const ipcPath = mcpClient.ipcFilePath;
		const pid = vscode.electron.app.process().pid;
		console.log('[IPC Discovery] pid:', pid);
		console.log('[IPC Discovery] ipcFilePath:', ipcPath ?? 'NOT FOUND');

		// IPC file may not exist if workspace has no folders (e.g. temp dir opened as file)
		// In E2E tests with a workspace, it should be present
		if (ipcPath != null) {
			expect(existsSync(ipcPath)).toBe(true);
			expect(ipcPath).toContain(`gitlens-ipc-server-${pid}-`);
		}
	});

	test('should contain valid IPC discovery data', async ({ mcpClient }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const data = readIpcDiscoveryFile(ipcPath!);
		console.log('[IPC Data] contents:', JSON.stringify(data, null, 2));

		expect(data).toBeDefined();
		expect(data!.token).toBeTruthy();
		expect(data!.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(data!.port).toBeGreaterThan(0);
		expect(data!.pid).toBeGreaterThan(0);
		expect(data!.scheme).toBeTruthy();
	});

	test('should include workspace paths in discovery data', async ({ mcpClient }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const data = readIpcDiscoveryFile(ipcPath!);
		console.log('[IPC Workspace] paths:', data?.workspacePaths);

		expect(data).toBeDefined();
		expect(data!.workspacePaths).toBeInstanceOf(Array);
		expect(data!.workspacePaths!.length).toBeGreaterThan(0);
	});

	test('should include IDE metadata in discovery data', async ({ mcpClient }) => {
		const ipcPath = mcpClient.ipcFilePath;
		test.skip(ipcPath == null, 'No IPC discovery file available');

		const data = readIpcDiscoveryFile(ipcPath!);
		console.log('[IPC IDE] ideName:', data?.ideName, 'scheme:', data?.scheme);

		expect(data).toBeDefined();
		// E2E tests run in VS Code
		expect(data!.scheme).toBe('vscode');
	});
});

// ============================================================================
// Block 1: CLI Installation Verification
// ============================================================================

test.describe('MCP — CLI Installation', () => {
	test.describe.configure({ mode: 'serial' });

	test('should install gk CLI binary on activation', async ({ mcpClient }) => {
		const gkPath = mcpClient.gkPath;
		console.log('[CLI Install] gkPath:', gkPath);
		console.log('[CLI Install] exists:', existsSync(gkPath));

		expect(existsSync(gkPath)).toBe(true);
	});

	test('should have correct binary file size', async ({ mcpClient }) => {
		const gkPath = mcpClient.gkPath;
		const stats = statSync(gkPath);
		console.log('[CLI Binary] size:', stats.size, 'bytes');

		// gk binary should be a substantial executable, not a stub
		expect(stats.size).toBeGreaterThan(1_000_000);
	});

	test('should report CLI version via gk version', async ({ mcpClient }) => {
		const { execSync } = await import('node:child_process');
		const output = execSync(`"${mcpClient.gkPath}" version`, { encoding: 'utf8' }).trim();
		console.log('[CLI Version] output:', output);

		// Proxy binary returns "CLI Core: X.Y.Z\nCLI Installer: X.Y.Z"
		expect(output).toContain('CLI Core:');
		expect(output).toMatch(/\d+\.\d+\.\d+/);
	});

	test('should have executable permissions on Unix', async ({ mcpClient }) => {
		test.skip(process.platform === 'win32', 'Permission check not applicable on Windows');

		const gkPath = mcpClient.gkPath;
		const stats = statSync(gkPath);
		const mode = stats.mode & 0o777;
		console.log('[CLI Permissions] mode:', mode.toString(8));

		// Owner execute bit should be set (at minimum 0o755)
		expect(mode & 0o100).toBeTruthy();
	});
});
