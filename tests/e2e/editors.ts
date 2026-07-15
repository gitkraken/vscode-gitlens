export interface EditorConfig {
	/** project name + CLI `--project=<id>` */
	id: string;
	/** human-readable name for reporting/CI */
	name: string;
	/** fork with known UI gaps → informational (continue-on-error in CI) */
	experimental: boolean;
	/** env var carrying the binary path; empty = VS Code, downloaded by the harness */
	envVar: string;
}

export const editors: EditorConfig[] = [
	{ id: 'vscode', name: 'VS Code', experimental: false, envVar: '' },
	{ id: 'windsurf', name: 'Windsurf', experimental: false, envVar: 'WINDSURF_E2E_PATH' },
	{ id: 'kiro', name: 'Kiro', experimental: true, envVar: 'KIRO_E2E_PATH' },
	{ id: 'cursor', name: 'Cursor', experimental: true, envVar: 'CURSOR_E2E_PATH' },
	{ id: 'positron', name: 'Positron', experimental: true, envVar: 'POSITRON_E2E_PATH' },
];
