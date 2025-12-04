import { execSync } from 'node:child_process';
import path from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

// eslint-disable-next-line import-x/no-default-export
export default async (): Promise<void> => {
	// Build the E2E runner (required for VS Code extension host)
	const rootDir = path.resolve(__dirname, '../..');
	execSync('pnpm run build:e2e-runner', { cwd: rootDir, stdio: 'inherit' });

	await downloadAndUnzipVSCode('stable');
};
