import { execSync } from 'node:child_process';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

// oxlint-disable-next-line import/no-default-export
export default async (config: FullConfig): Promise<void> => {
	// Build the E2E runner (required for VS Code extension host)
	const rootDir = path.resolve(__dirname, '../..');
	execSync('pnpm run build:e2e-runner', { cwd: rootDir, stdio: 'inherit' });

	// Pre-download VS Code only if a selected project needs it — i.e. one whose editor binary path is
	// empty (the `vscode` project). Fork-only runs (Cursor/Windsurf/Kiro/…) skip the download.
	// If Playwright doesn't filter `config.projects` by `--project` here, this safely degrades to
	// "download whenever the vscode project is registered" (which it always is).
	const needsVSCode = config.projects.some(p => {
		const use = p.use as { editorExecutablePath?: string };
		return !use.editorExecutablePath;
	});
	if (needsVSCode) {
		await downloadAndUnzipVSCode('stable');
	}
};
