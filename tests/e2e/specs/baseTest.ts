import { test as base, type Page, _electron } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';
export { expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';

export type TestOptions = {
	vscodeVersion: string;
};

type TestFixtures = TestOptions & {
	page: Page;
	createTmpDir: () => Promise<string>;
};

let testProjectPath: string;
export const test = base.extend<TestFixtures>({
	vscodeVersion: ['insiders', { option: true }],
	page: async ({ vscodeVersion, createTmpDir }, use) => {
		const defaultCachePath = await createTmpDir();
		const vscodePath = await downloadAndUnzipVSCode(vscodeVersion);
		testProjectPath = path.join(__dirname, '..', '..', '..');

		const electronApp = await _electron.launch({
			executablePath: vscodePath,
			// Got it from https://github.com/microsoft/vscode-test/blob/0ec222ef170e102244569064a12898fb203e5bb7/lib/runTest.ts#L126-L160
			args: [
				'--no-sandbox', // https://github.com/microsoft/vscode/issues/84238
				'--disable-gpu-sandbox', // https://github.com/microsoft/vscode-test/issues/221
				'--disable-updates', // https://github.com/microsoft/vscode-test/issues/120
				'--skip-welcome',
				'--skip-release-notes',
				'--disable-workspace-trust',
				`--extensionDevelopmentPath=${path.join(__dirname, '..', '..', '..')}`,
				`--extensions-dir=${path.join(defaultCachePath, 'extensions')}`,
				`--user-data-dir=${path.join(defaultCachePath, 'user-data')}`,
				testProjectPath,
			],
		});

		const page = await electronApp.firstWindow();
		await page.context().tracing.start({
			screenshots: true,
			snapshots: true,
			title: test.info().title,
		});

		await use(page);

		const tracePath = test.info().outputPath('trace.zip');
		await page.context().tracing.stop({ path: tracePath });
		test.info().attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
		await electronApp.close();

		const logPath = path.join(defaultCachePath, 'user-data');
		if (fs.existsSync(logPath)) {
			const logOutputPath = test.info().outputPath('vscode-logs');
			await fs.promises.cp(logPath, logOutputPath, { recursive: true });
		}
	},
	createTmpDir: async ({}, use) => {
		const tempDirs: string[] = [];
		await use(async () => {
			const tempDir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gltest-')));
			tempDirs.push(tempDir);
			return tempDir;
		});
		for (const tempDir of tempDirs) await fs.promises.rm(tempDir, { recursive: true });
	},
});
