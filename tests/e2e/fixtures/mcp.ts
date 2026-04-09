import * as process from 'node:process';
import { test as base, createTmpDir, GitFixture } from '../baseTest.js';
import { findGkCliFromArgs, findIpcFileByWorkspace, McpClient, waitForCliInstall } from '../helpers/mcpHelper.js';

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
 * Each worker gets its own temp git repo (via setup callback) so the
 * IPC discovery file can be matched by workspacePaths — avoiding PID
 * mismatch between Electron main and extension host processes.
 */
export const mcpTest = base.extend<McpFixtures>({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],

	mcpClient: async ({ vscode }, use) => {
		const gkPath = findGkCliFromArgs(vscode.electron.args);
		await waitForCliInstall(gkPath);
		const workspacePath = vscode.electron.workspacePath;

		const ipcFilePath = await findIpcFileByWorkspace(workspacePath);
		const client = new McpClient(gkPath, ipcFilePath);
		await use(client);
	},
});
