import type { GlCommands } from '../../constants.commands.js';

/**
 * Every registered `gitlens.showSettingsPage!<anchor>` command. Anchors that
 * target a dropped category are redirected to native settings by
 * `SettingsWebviewProvider.onShowing` (via `droppedAnchorQueries`) rather than
 * removed here — see a test asserting every anchor below is either a kept
 * category id or a `droppedAnchorQueries` key.
 *
 * Deliberately kept in its own leaf module (type-only imports, no `vscode`)
 * so it can be imported from a unit test without pulling in the extension's
 * command-registration/activation machinery — `registration.ts` itself is
 * unsafe to import outside a running extension host.
 */
export const settingsPageAnchorCommands: GlCommands[] = [
	'gitlens.showSettingsPage!account',
	'gitlens.showSettingsPage!file-annotations',
	'gitlens.showSettingsPage!branches-view',
	'gitlens.showSettingsPage!commits-view',
	'gitlens.showSettingsPage!contributors-view',
	'gitlens.showSettingsPage!current-line',
	'gitlens.showSettingsPage!file-history-view',
	'gitlens.showSettingsPage!line-history-view',
	'gitlens.showSettingsPage!remotes-view',
	'gitlens.showSettingsPage!repositories-view',
	'gitlens.showSettingsPage!search-compare-view',
	'gitlens.showSettingsPage!stashes-view',
	'gitlens.showSettingsPage!tags-view',
	'gitlens.showSettingsPage!worktrees-view',
	'gitlens.showSettingsPage!commit-graph',
	'gitlens.showSettingsPage!autolinks',
	'gitlens.showSettingsPage!ai',
	'gitlens.showSettingsPage!agents',
	'gitlens.showSettingsPage!integrations',
];
