import { execSync } from 'node:child_process';
import path from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

// oxlint-disable-next-line import/no-default-export
export default async (): Promise<void> => {
	// Build the E2E runner (required for VS Code extension host)
	const rootDir = path.resolve(__dirname, '../..');
	execSync('pnpm run build:e2e-runner', { cwd: rootDir, stdio: 'inherit' });

	// Skip the VS Code download when tests are pointed at a specific editor binary
	// (e.g. Cursor, Windsurf, Trae) via VSCODE_E2E_EXECUTABLE_PATH.
	if (!process.env.VSCODE_E2E_EXECUTABLE_PATH) {
		await downloadAndUnzipVSCode('stable');
	}
};
