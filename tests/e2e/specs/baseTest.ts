import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron, test as base } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';
import { GitLensPage } from '../pageObjects/gitLensPage';

export { expect } from '@playwright/test';

export const MaxTimeout = 10000;

export interface VSCodeInstance {
	page: Page;
	electronApp: ElectronApplication;
	gitlens: GitLensPage;
}

export async function launchVSCode(vscodeVersion = 'stable'): Promise<VSCodeInstance> {
	const tempDir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gltest-')));
	const vscodePath = await downloadAndUnzipVSCode(vscodeVersion);
	const testProjectPath = path.join(__dirname, '..', '..', '..');

	const electronApp = await _electron.launch({
		executablePath: vscodePath,
		args: [
			'--no-sandbox',
			'--disable-gpu-sandbox',
			'--disable-updates',
			'--skip-welcome',
			'--skip-release-notes',
			'--disable-workspace-trust',
			`--extensionDevelopmentPath=${testProjectPath}`,
			`--extensions-dir=${path.join(tempDir, 'extensions')}`,
			`--user-data-dir=${path.join(tempDir, 'user-data')}`,
			testProjectPath,
		],
	});

	const page = await electronApp.firstWindow();
	const gitlens = new GitLensPage(page);

	return { page: page, electronApp: electronApp, gitlens: gitlens };
}

export const test = base;
