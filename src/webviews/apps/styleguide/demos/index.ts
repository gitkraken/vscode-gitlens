import { buttonsGroups } from './buttons.js';
import { chipsGroups } from './chips.js';
import { contentGroups } from './content.js';
import { formsGroups } from './forms.js';
import { gatedGroups } from './gated.js';
import { gitGroups } from './git.js';
import { indicatorsGroups } from './indicators.js';
import { overlaysGroups } from './overlays.js';
import { structureGroups } from './structure.js';
import { treesGroups } from './trees.js';
import type { ComponentGroup } from './types.js';

export const componentGroups: ComponentGroup[] = [
	...buttonsGroups,
	...chipsGroups,
	...formsGroups,
	...gitGroups,
	...contentGroups,
	...overlaysGroups,
	...structureGroups,
	...indicatorsGroups,
	...treesGroups,
	...gatedGroups,
];

// Function-only modules with no standalone element to render — listed for completeness.
export const nonElements: { name: string; reason: string }[] = [
	{
		name: 'commit-popover-content',
		reason: 'render-function helpers consumed by gl-popover instances, not a component',
	},
	{ name: 'agent-status-render', reason: 'render-function helpers for agent status text, not a component' },
	{ name: 'file-tree-utils', reason: 'pure tree-building helpers consumed by the tree components' },
	{ name: 'tree/base', reason: 'shared TreeItem/TreeModel types, not a renderable component' },
	{ name: 'linkify', reason: 'text-to-markup helper — demoed via its function output under Rich content' },
];

// Shared components that depend on extension context/data (subscription, integrations, IPC, git models)
// and can't render standalone — listed for completeness, not demoed. These live outside shared/components
// (plus-app specific) so no family file owns them.
export const undemoed: string[] = ['gl-account-chip', 'gl-integrations-chip', 'gl-merge-rebase-status'];
