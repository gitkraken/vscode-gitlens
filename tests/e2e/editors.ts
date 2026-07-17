export interface EditorConfig {
	/** project name + CLI `--project=<id>` */
	id: string;
	/** human-readable name for reporting/CI */
	name: string;
	/** fork with known UI gaps → informational (continue-on-error in CI) */
	experimental: boolean;
	/** env var carrying the binary path; empty = VS Code, downloaded by the harness */
	envVar: string;
	/**
	 * Whether to include this editor in the CI matrix (defaults to true when omitted). Login-walled
	 * forks (Cursor) gate their entire workbench behind an un-skippable, auth-only sign-in overlay on a
	 * fresh CI profile, so every UI-driven spec fails fast with zero signal while still paying a full
	 * editor launch — pure CI load. They stay registered for local `--project=<id>` runs (with a manual
	 * login), just not in CI. See baseTest.ts `assertWorkbenchReachable` and docs/testing.md.
	 */
	runInCI?: boolean;
}

export const editors: EditorConfig[] = [
	{ id: 'vscode', name: 'VS Code', experimental: false, envVar: '' },
	{ id: 'windsurf', name: 'Windsurf', experimental: false, envVar: 'WINDSURF_E2E_PATH' },
	{ id: 'kiro', name: 'Kiro', experimental: true, envVar: 'KIRO_E2E_PATH' },
	// Login-walled (see runInCI): excluded from the CI matrix, still runnable locally.
	{ id: 'cursor', name: 'Cursor', experimental: true, envVar: 'CURSOR_E2E_PATH', runInCI: false },
	{ id: 'positron', name: 'Positron', experimental: true, envVar: 'POSITRON_E2E_PATH' },
];

/** Editors included in the CI matrix (see {@link EditorConfig.runInCI}). */
export const ciEditors: EditorConfig[] = editors.filter(e => e.runInCI !== false);
