import type { SettingsCategory } from '../model.js';
import { descriptorKeys } from '../model.js';
import { annotationsCategories } from './annotations.js';
import { editorCategories } from './editor.js';
import { generalCategories } from './general.js';
import { integrationsCategories } from './integrations.js';
import { viewsCategories } from './views.js';

/** All categories, in nav order (group order: Annotations, In-editor, Views, Integrations, Editing, General). */
export const settingsCategories: readonly SettingsCategory[] = [
	...annotationsCategories,
	...editorCategories,
	...viewsCategories,
	...integrationsCategories,
	...generalCategories,
];

/**
 * Legacy anchors that don't match a category id 1:1.
 * Every other anchor (including all `gitlens.showSettingsPage!<anchor>` command
 * variants) is a category id directly.
 */
const anchorAliases: Record<string, string> = {
	// The legacy sorting section's HTML id was 'views'
	views: 'sorting',
	// Legacy in-page anchors that map into merged categories
	'views-side-bar': 'commits-view',
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
