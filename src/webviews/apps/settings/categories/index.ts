import type { SettingsCategory } from '../model.js';
import { descriptorKeys } from '../model.js';
import { annotationsCategories } from './annotations.js';
import { editorCategories } from './editor.js';
import { generalCategories } from './general.js';
import { integrationsCategories } from './integrations.js';
import { viewsCategories } from './views.js';

/**
 * All categories, in nav order (group order: Integrations, Editor, Views, General).
 * `annotationsCategories` + `editorCategories` are both `group: 'Editor'` — two
 * source files for one merged nav group (former "Annotations" + "In-editor").
 */
export const settingsCategories: readonly SettingsCategory[] = [
	...integrationsCategories,
	...annotationsCategories,
	...editorCategories,
	...viewsCategories,
	...generalCategories,
];

/**
 * Legacy anchors that don't match a category id 1:1.
 * Every other anchor (including all `gitlens.showSettingsPage!<anchor>` command
 * variants) is a category id directly.
 */
const anchorAliases: Record<string, string> = {
	// Legacy in-page anchors that map into merged categories
	'views-side-bar': 'commits-view',
};

/**
 * Dropped-category anchors (and legacy aliases whose target was dropped) →
 * the native Settings UI search query they redirect to. Consumed by
 * `SettingsWebviewProvider.onShowing` — the single chokepoint every
 * `gitlens.showSettingsPage[!<anchor>]` invocation passes through (including
 * the base command's setting-key anchors), so a redirect registered here
 * intercepts the request before the webview ever shows.
 *
 * Covered by a test asserting every `showSettingsPage!<anchor>` command's
 * anchor is either a kept category id (resolves via `anchorToCategory`) or a
 * key here — so a dropped category can never silently orphan its entry point.
 */
export const droppedAnchorQueries: Record<string, string> = {
	'file-annotations': 'gitlens.fileAnnotations',
	'repositories-view': 'gitlens.views.repositories',
	'branches-view': 'gitlens.views.branches',
	'remotes-view': 'gitlens.views.remotes',
	'tags-view': 'gitlens.views.tags',
	'worktrees-view': 'gitlens.views.worktrees',
	'commit-details-view': 'gitlens.views.commitDetails',
	'contributors-view': 'gitlens.views.contributors',
	'file-history-view': 'gitlens.views.fileHistory',
	'line-history-view': 'gitlens.views.lineHistory',
	'search-compare-view': 'gitlens.views.searchAndCompare',
	// Substring-matches every sort* setting (sortRepositoriesBy/sortBranchesBy/sortTagsBy/
	// sortContributorsBy/sortWorktreesBy/sortWorkingChangesBy), not just sortRepositoriesBy
	sorting: 'gitlens.sort',
	// The legacy sorting section's HTML id was 'views'; 'sorting' itself is also
	// covered directly above in case anything still deep-links to the section id
	views: 'gitlens.sort',
	shortcuts: 'gitlens.keymap',
	// Substring-matches both `gitlens.modes` and `gitlens.mode.statusBar.*`/`gitlens.mode.active`,
	// which the dropped section also exposed
	modes: 'gitlens.mode',
	'terminal-links': 'gitlens.terminalLinks',
	'rebase-editor': 'gitlens.rebaseEditor',
};

/**
 * Resolves a deep-link anchor to a category — and, when the anchor is a
 * setting key rather than a section id (e.g. the status bar "Blame Paused"
 * tooltip links `advanced.blame.delayAfterEdit`), also to the key so the
 * control can be highlighted. The legacy app resolved any element id, so
 * every anchor shape in the wild must keep landing somewhere sensible.
 */
export function anchorToCategory(anchor: string): { id: string; key?: string } | undefined {
	const id = anchorAliases[anchor] ?? anchor;
	if (settingsCategories.some(c => c.id === id)) return { id: id };

	// Fall back to treating the anchor as a setting key (`gitlens.` prefix optional)
	const key = anchor.startsWith('gitlens.') ? anchor.substring('gitlens.'.length) : anchor;
	for (const category of settingsCategories) {
		if (category.master?.key === key || category.controls.some(c => descriptorKeys(c).includes(key))) {
			return { id: category.id, key: key };
		}
	}
	return undefined;
}
