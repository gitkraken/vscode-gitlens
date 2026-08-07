import * as process from 'node:process';
import { test as base, createTmpDir, GitFixture } from '../baseTest.js';
import type { McpReadiness } from '../helpers/mcpHelper.js';
import { findGkCliFromArgs, McpClient, waitForMcpReady } from '../helpers/mcpHelper.js';

export { expect } from '@playwright/test';
export type {
	IpcDiscoveryData,
	McpConfigResult,
	McpMessage,
	McpClient,
	McpToolDefinition,
} from '../helpers/mcpHelper.js';
export { readIpcDiscoveryFile } from '../helpers/mcpHelper.js';

interface McpFixtures {
	/** Ready-to-use McpClient for the current VS Code worker instance. */
	mcpClient: McpClient;
}

interface McpWorkerFixtures {
	/** MCP preconditions for this worker's editor instance, resolved once. */
	mcpReadiness: McpReadiness;
}

/**
 * Extended Playwright test fixture that provides a McpClient.
 *
 * Each worker gets its own temp git repo (via setup callback) so the
 * IPC discovery file can be matched by workspacePaths — avoiding PID
 * mismatch between Electron main and extension host processes.
 */
export const mcpTest = base.extend<McpFixtures, McpWorkerFixtures>({
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

	// Worker-scoped, like the editor it describes: both preconditions are properties of the running
	// instance, not of a test, and waiting on them is the expensive part. Resolving them per test would
	// make an environment that never publishes a discovery file pay the full budget on every single
	// test and leave each one too little of its timeout for the call it was going to make.
	mcpReadiness: [
		async ({ vscode }, use) => {
			const gkPath = findGkCliFromArgs(vscode.electron.args);

			// One shared budget for both waits, so a slow editor cannot spend it all on the install and
			// leave the discovery wait to fail anonymously.
			await use(await waitForMcpReady(gkPath, vscode.electron.workspacePath));
		},
		{ scope: 'worker' },
	],

	mcpClient: async ({ mcpReadiness }, use) => {
		await use(new McpClient(mcpReadiness.gkPath, mcpReadiness.ipcFilePath, 'vscode', mcpReadiness.ipcDiagnosis));
	},
});
