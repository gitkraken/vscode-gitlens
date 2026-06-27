// Color-token adoption status per shared webview component — the data behind the styleguide's
// adoption dashboard + scoreboard. Seeded from the css-color-revamp inventory; refresh with
// `node scripts/styleguide/scanAdoption.mjs` (scans each component's source for --gl-color-* vs
// --color-* vs raw --vscode-* vs hex). This is the rendered source of truth (no runtime scanning).

export type AdoptionStatus =
	| 'new-tokens' // consumes --gl-color-* semantic tokens
	| 'mixed' // --gl-* hooks + --vscode-*/legacy fallbacks (the migration surface)
	| 'vscode-direct' // clean --vscode-* only, not yet semantic
	| 'legacy' // legacy --color-* tokens
	| 'hardcoded' // hex/rgb literals or color data tables
	| 'none'; // layout-only, no color of its own

export interface ComponentAdoption {
	readonly name: string;
	readonly family: string;
	readonly status: AdoptionStatus;
}

export const adoptionStatusLabels: Record<AdoptionStatus, string> = {
	'new-tokens': 'new tokens',
	mixed: 'mixed',
	'vscode-direct': 'vscode-direct',
	legacy: 'legacy',
	hardcoded: 'hardcoded',
	none: 'none',
};

export const componentAdoption: readonly ComponentAdoption[] = [
	// Badges / pills / indicators
	{ name: 'gl-tracking-pill', family: 'Badges & pills', status: 'new-tokens' },
	{ name: 'gl-indicator', family: 'Badges & pills', status: 'new-tokens' },
	{ name: 'gl-badge', family: 'Badges & pills', status: 'mixed' },
	{ name: 'gl-pill', family: 'Badges & pills', status: 'mixed' },
	{ name: 'gl-agent-status-pill', family: 'Badges & pills', status: 'mixed' },
	{ name: 'gl-tracking-status', family: 'Badges & pills', status: 'legacy' },

	// Buttons / actions / chips
	{ name: 'gl-button', family: 'Buttons & actions', status: 'mixed' },
	{ name: 'gl-action-chip', family: 'Buttons & actions', status: 'vscode-direct' },
	{ name: 'gl-autolink-chip', family: 'Buttons & actions', status: 'vscode-direct' },
	{ name: 'gl-pr-chip', family: 'Buttons & actions', status: 'vscode-direct' },

	// Cards / surfaces
	{ name: 'gl-card', family: 'Cards & surfaces', status: 'mixed' },
	{ name: 'gl-accordion', family: 'Cards & surfaces', status: 'vscode-direct' },
	{ name: 'gl-icon-cube', family: 'Cards & surfaces', status: 'mixed' },
	{ name: 'gl-work-item', family: 'Cards & surfaces', status: 'none' },

	// Overlays / floating
	{ name: 'gl-tooltip', family: 'Overlays', status: 'mixed' },
	{ name: 'gl-popover', family: 'Overlays', status: 'mixed' },
	{ name: 'gl-menu-list', family: 'Overlays', status: 'vscode-direct' },
	{ name: 'gl-dialog', family: 'Overlays', status: 'mixed' },

	// Form controls
	{ name: 'gl-checkbox', family: 'Form controls', status: 'vscode-direct' },
	{ name: 'gl-radio', family: 'Form controls', status: 'vscode-direct' },
	{ name: 'gl-switch', family: 'Form controls', status: 'mixed' },
	{ name: 'gl-segmented', family: 'Form controls', status: 'mixed' },
	{ name: 'gl-search-input', family: 'Form controls', status: 'mixed' },

	// Banner / alert
	{ name: 'gl-banner', family: 'Banner & alert', status: 'mixed' },
	{ name: 'gl-repo-alerts', family: 'Banner & alert', status: 'none' },

	// Commit / git presentation
	{ name: 'commit-stats', family: 'Git presentation', status: 'mixed' },
	{ name: 'wip-stats', family: 'Git presentation', status: 'mixed' },
	{ name: 'gl-git-status', family: 'Git presentation', status: 'hardcoded' },
	{ name: 'gl-file-icon', family: 'Git presentation', status: 'hardcoded' },
	{ name: 'commit-author', family: 'Git presentation', status: 'legacy' },

	// Tree / markdown / agents
	{ name: 'gl-tree', family: 'Tree & content', status: 'mixed' },
	{ name: 'gl-markdown', family: 'Tree & content', status: 'vscode-direct' },
	{ name: 'gl-issue-pull-request', family: 'Tree & content', status: 'mixed' },
	{ name: 'gl-agent-status', family: 'Tree & content', status: 'vscode-direct' },
];
