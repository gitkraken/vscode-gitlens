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
	 * forks (Cursor, Kiro) gate their entire workbench behind an auth-only sign-in overlay that never
	 * lifts on a fresh CI profile, so every UI-driven spec fails fast with zero signal while still paying
	 * a full editor launch (multiplied by retries) — pure CI load. They stay registered for local
	 * `--project=<id>` runs (with a manual login), just not in CI. See baseTest.ts
	 * `assertWorkbenchReachable` and docs/testing.md.
	 */
	runInCI?: boolean;
	/**
	 * Playwright worker count for this editor's CI job (defaults to the config's CI value when omitted).
	 * Heavier forks (Positron) thrash a limited CI runner when 4 Electron instances launch at once —
	 * webviews/views then exceed their load timeouts (graph rows, activity-bar view registration).
	 * Fewer workers trade wall-clock for the resources each instance needs to render in time.
	 */
	ciWorkers?: number;
}

export const editors: EditorConfig[] = [
	{ id: 'vscode', name: 'VS Code', experimental: false, envVar: '' },
	{ id: 'windsurf', name: 'Windsurf', experimental: false, envVar: 'WINDSURF_E2E_PATH' },
	// Login-walled on a fresh CI profile (see runInCI): Kiro's `kiro-sign-in-page` overlay persists —
	// its "Skip All" affordance only clears the wall on an already-authenticated machine (verified: green
	// locally, wall never lifts in CI), so every UI spec fails and each retry relaunches the editor into
	// the same wall → the job burns its wall-clock and gets cancelled. Excluded from CI, still runnable
	// locally. See baseTest.ts `assertWorkbenchReachable` and docs/testing.md.
	{ id: 'kiro', name: 'Kiro', experimental: true, envVar: 'KIRO_E2E_PATH', runInCI: false },
	{ id: 'cursor', name: 'Cursor', experimental: true, envVar: 'CURSOR_E2E_PATH', runInCI: false },
	{ id: 'positron', name: 'Positron', experimental: true, envVar: 'POSITRON_E2E_PATH', ciWorkers: 2 },
];

/** Editors included in the CI matrix (see {@link EditorConfig.runInCI}). */
export const ciEditors: EditorConfig[] = editors.filter(e => e.runInCI !== false);
