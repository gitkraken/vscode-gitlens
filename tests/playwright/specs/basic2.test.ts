import path from 'path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

let electronApp: ElectronApplication;

const rootPath = path.resolve(__dirname, '../../../');
const args = [
	'--verbose',
	'--debug',
	'--disable-gpu-sandbox', // https://github.com/microsoft/vscode-test/issues/221
	'--disable-updates', // https://github.com/microsoft/vscode-test/issues/120
	'--disable-workspace-trust',
	'--extensionDevelopmentPath=' + rootPath,
	'--new-window', // Opens a new session of VS Code instead of restoring the previous session (default).
	'--no-sandbox', // https://github.com/microsoft/vscode/issues/84238
	'--profile-temp', // "debug in a clean environment"
	'--skip-release-notes',
	'--skip-welcome',
];

test.beforeEach(async () => {
	electronApp = await electron.launch({
		executablePath: await downloadAndUnzipVSCode('stable'),
		args,
	});
});

test('launches vscode', async () => {
	const page = await electronApp.firstWindow();

	// This should fail, but if it runs it means our vscode instance is running
	await page.getByRole('button', { name: 'Some button' }).click();
});

test.afterEach(async () => {
	await electronApp?.close();
});
