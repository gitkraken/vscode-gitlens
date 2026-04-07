import { test as base } from '../baseTest.js';
import { findGkCliFromArgs, findLatestIpcFile, McpClient, waitForCliInstall } from '../helpers/mcpHelper.js';

export { expect } from '@playwright/test';
export type { IpcDiscoveryData, McpConfigResult, McpMessage, McpClient } from '../helpers/mcpHelper.js';
export { readIpcDiscoveryFile } from '../helpers/mcpHelper.js';

interface McpFixtures {
	/** Ready-to-use McpClient for the current VS Code worker instance. */
	mcpClient: McpClient;
}

/**
 * Extended Playwright test fixture that provides a McpClient.
 *
 * Derives the gk CLI path from `--user-data-dir` (the temp directory
 * E2E tests use), waits for GitLens to auto-install the CLI on first run,
 * then constructs a McpClient with the latest live IPC discovery file.
 *
 * Usage:
 * ```ts
 * import { mcpTest as test, expect } from '../fixtures/mcp.js';
 *
 * test('tools/list returns git_status', async ({ mcpClient }) => {
 *   const tools = await mcpClient.listTools();
 *   expect(tools).toContain('git_status');
 * });
 * ```
 */
export const mcpTest = base.extend<McpFixtures>({
	mcpClient: async ({ vscode }, use) => {
		const gkPath = findGkCliFromArgs(vscode.electron.args);
		await waitForCliInstall(gkPath);
		const vscodePid = vscode.electron.app.process().pid;
		const ipcFilePath = findLatestIpcFile(vscodePid);
		if (ipcFilePath == null) {
			console.warn(`[mcpTest] No live IPC file found for pid=${vscodePid} — GK_GL_PATH will not be set`);
		}
		const client = new McpClient(gkPath, ipcFilePath);
		await use(client);
	},
});
