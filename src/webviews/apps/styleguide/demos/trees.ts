import { html } from 'lit';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { Preferences } from '../../../commitDetails/protocol.js';
import type { TreeItemAction } from '../../shared/components/tree/base.js';
import type { FileItem } from '../../shared/components/tree/gl-file-tree-pane.js';
import '../../shared/components/chips/action-chip.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/tree/gl-file-tree-pane.js';
import '../../shared/components/tree/gl-wip-tree-pane.js';
import '../../shared/components/tree/tree-item.js';
import '../../shared/components/tree/tree.js';
import type { ComponentGroup } from './types.js';

const repoPath = '/Users/dev/code/vscode-gitlens';

// Basic (ungrouped) working-file list — mirrors what commit details / compare views pass in.
const basicFiles: FileItem[] = [
	{
		repoPath: repoPath,
		path: 'src/git/gitProviderService.ts',
		status: 'M',
		staged: false,
		stats: { additions: 42, deletions: 11, changes: 53 },
	},
	{
		repoPath: repoPath,
		path: 'src/commands/copyCurrentBranch.ts',
		status: 'A',
		staged: false,
		stats: { additions: 18, deletions: 0, changes: 18 },
	},
	{
		repoPath: repoPath,
		path: 'src/webviews/apps/shared/components/tree/gl-file-tree-pane.ts',
		status: 'M',
		staged: false,
		stats: { additions: 6, deletions: 2, changes: 8 },
	},
];

// Nested paths across two folders — forces the hierarchical (tree) layout to fan out visibly.
const treeLayoutFiles: FileItem[] = [
	{ repoPath: repoPath, path: 'src/git/gitProviderService.ts', status: 'M' },
	{ repoPath: repoPath, path: 'src/git/models/fileChange.ts', status: 'M' },
	{ repoPath: repoPath, path: 'src/git/models/fileStatus.ts', status: 'A' },
	{ repoPath: repoPath, path: 'src/webviews/apps/shared/components/tree/tree-item.ts', status: 'M' },
	{ repoPath: repoPath, path: 'src/webviews/apps/shared/components/tree/tree.ts', status: '?' },
];

const treeLayoutConfig = { layout: 'tree', threshold: 0, compact: true } as const;

// Staged/mixed/disabled checkbox states, keyed by path.
const checkableStates = new Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string }>([
	['src/git/gitProviderService.ts', { state: 'checked' }],
	['src/commands/copyCurrentBranch.ts', { state: 'mixed' }],
	[
		'src/webviews/apps/shared/components/tree/gl-file-tree-pane.ts',
		{ disabled: true, disabledReason: 'Excluded by AI ignore rules' },
	],
]);

// Unmerged (conflict) status — 'UU' = modified-by-both; conflictMarkers drives the "N conflicts" pill.
const conflictFiles: FileItem[] = [
	{ repoPath: repoPath, path: 'src/git/models/fileStatus.ts', status: 'UU', conflictMarkers: 3 },
];

// Per-row inline actions (rendered via the tree-item actions slot).
const fileRowActions: TreeItemAction[] = [
	{ icon: 'diff', label: 'Open Changes', action: 'file-open' },
	{ icon: 'discard', label: 'Discard Changes', action: 'file-discard' },
];

// Agent "currently editing" decoration.
const agentTouchedFiles = new Map<string, AgentSessionPhase>([['src/agents/session.ts', 'working']]);
const agentFiles: FileItem[] = [{ repoPath: repoPath, path: 'src/agents/session.ts', status: 'M' }];

// GitCommitSearchContext requires `query`/`queryFilters` (deep search-query model); gl-file-tree-pane
// only reads `matchedFiles`, so a targeted cast through `unknown` stands in for the rest.
const searchContext = {
	matchedFiles: [{ path: 'src/git/gitProviderService.ts' }],
} as unknown as GitCommitSearchContext;

// Mixed staged/unstaged working set — the WIP feed emits two rows for a mixed path (one per staged
// flag); gl-wip-tree-pane's own deduplicateFiles collapses that in checkable mode.
const wipFiles: FileItem[] = [
	{ repoPath: repoPath, path: 'src/git/gitProviderService.ts', status: 'M', staged: true },
	{ repoPath: repoPath, path: 'src/git/gitProviderService.ts', status: 'M', staged: false },
	{ repoPath: repoPath, path: 'src/commands/copyCurrentBranch.ts', status: 'A', staged: true },
	{
		repoPath: repoPath,
		path: 'src/webviews/apps/shared/components/tree/gl-wip-tree-pane.ts',
		status: 'M',
		staged: false,
	},
	{
		repoPath: repoPath,
		path: 'src/webviews/apps/shared/components/tree/__tests__/fixtures/new-file.ts',
		status: '?',
		staged: false,
	},
];

const wipStats: GitCommitStats = { files: 5, additions: 84, deletions: 23 };

// Preferences is a wide, mostly-unrelated bag (date/avatar/AI/signature prefs); gl-wip-tree-pane only
// reads `.files`/`.indentGuides`/`.workingFilesOrderBy`/`.workingChangesSortBy` off it — cast the
// relevant slice through `unknown` rather than fabricating the other ~10 required fields.
const wipPreferences = {
	files: { layout: 'auto', compact: true, threshold: 5, icon: 'type' },
	indentGuides: 'onHover',
	workingFilesOrderBy: 'name',
	workingChangesSortBy: 'stage',
} as unknown as Preferences;

// Conflict scenario for the bulk-resolve toolbar.
const wipConflictFiles: FileItem[] = [
	{ repoPath: repoPath, path: 'src/git/models/fileStatus.ts', status: 'UU', conflictMarkers: 2 },
	{ repoPath: repoPath, path: 'src/commands/copyCurrentBranch.ts', status: 'M', staged: false },
];

const noFiles: FileItem[] = [];

export const treesGroups: ComponentGroup[] = [
	{
		family: 'Trees & file lists',
		description:
			'Tree primitives (gl-tree, gl-tree-item) and the virtualized file-list panes (gl-file-tree-pane, gl-wip-tree-pane) built on top of them.',
		demos: [
			{
				label: 'gl-tree (guides="always", folder + files)',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="always">
						<gl-tree-item branch level="1" path="src/git">
							<code-icon slot="icon" icon="folder"></code-icon>
							git
						</gl-tree-item>
						<gl-tree-item
							level="2"
							path="src/git/gitProviderService.ts"
							parent-path="src/git"
							parent-expanded
						>
							<code-icon slot="icon" icon="file"></code-icon>
							gitProviderService.ts
						</gl-tree-item>
						<gl-tree-item
							level="2"
							path="src/git/models/fileChange.ts"
							parent-path="src/git"
							parent-expanded
						>
							<code-icon slot="icon" icon="file"></code-icon>
							fileChange.ts
						</gl-tree-item>
						<gl-tree-item level="1" path="src/extension.ts">
							<code-icon slot="icon" icon="file"></code-icon>
							extension.ts
						</gl-tree-item>
					</gl-tree>
				`,
				note: "The folder's chevron only emits gl-tree-item-toggle, which gl-tree doesn't listen for — real hosts mutate expanded/parentExpanded on the model externally, so the chevron click here is a visual no-op.",
			},
			{
				label: 'gl-tree (guides="onHover")',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="onHover">
						<gl-tree-item branch level="1" path="src/commands">
							<code-icon slot="icon" icon="folder"></code-icon>
							commands
						</gl-tree-item>
						<gl-tree-item
							level="2"
							path="src/commands/copyCurrentBranch.ts"
							parent-path="src/commands"
							parent-expanded
						>
							<code-icon slot="icon" icon="file"></code-icon>
							copyCurrentBranch.ts
						</gl-tree-item>
					</gl-tree>
				`,
				note: "Connector guide lines only render on hover in this mode — a static view won't show them.",
			},
			{
				label: 'gl-tree-item (leaf, icon + description + decoration)',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="always">
						<gl-tree-item level="1" path="src/git/gitProviderService.ts">
							<code-icon slot="icon" icon="file"></code-icon>
							gitProviderService.ts
							<span slot="description">src/git</span>
							<span slot="decorations-after">M</span>
						</gl-tree-item>
					</gl-tree>
				`,
				note: "Shown inside its structural parent gl-tree. The decoration renders unstyled here — the coloring classes live in gl-tree-view's shadow scope, not tree-item's.",
			},
			{
				label: 'gl-tree-item (branch, expanded vs collapsed)',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="always">
						<gl-tree-item branch level="1" path="src/webviews">
							<code-icon slot="icon" icon="folder"></code-icon>
							webviews
						</gl-tree-item>
						<gl-tree-item
							level="2"
							path="src/webviews/protocol.ts"
							parent-path="src/webviews"
							parent-expanded
						>
							<code-icon slot="icon" icon="file"></code-icon>
							protocol.ts
						</gl-tree-item>
						<gl-tree-item branch .expanded=${false} level="1" path="src/commands">
							<code-icon slot="icon" icon="folder"></code-icon>
							commands
						</gl-tree-item>
						<gl-tree-item
							level="2"
							path="src/commands/copyCurrentBranch.ts"
							parent-path="src/commands"
							.parentExpanded=${false}
						>
							<code-icon slot="icon" icon="file"></code-icon>
							copyCurrentBranch.ts
						</gl-tree-item>
					</gl-tree>
				`,
				note: '`expanded` and `parentExpanded` are bound via property (not attribute) bindings to force strictly-false values — both default to true/undefined, and a boolean-attribute directive that never renders "present" leaves the property at its class default instead of false.',
			},
			{
				label: 'gl-tree-item (checkable: checked / indeterminate / disabled)',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="onHover">
						<gl-tree-item
							checkable
							.checked=${true}
							level="1"
							path="src/git/gitProviderService.ts"
							checkable-tooltip="Unstage gitProviderService.ts"
						>
							gitProviderService.ts
						</gl-tree-item>
						<gl-tree-item
							checkable
							.checked=${'indeterminate'}
							level="1"
							path="src/git/models/fileChange.ts"
							checkable-tooltip="Stage fileChange.ts"
							checkable-alt-tooltip="Unstage fileChange.ts"
						>
							fileChange.ts
						</gl-tree-item>
						<gl-tree-item
							checkable
							disable-check
							level="1"
							path="src/git/models/fileStatus.ts"
							checkable-tooltip="Excluded by AI ignore rules"
						>
							fileStatus.ts
						</gl-tree-item>
					</gl-tree>
				`,
				note: "`checked` is bound via `.checked` since its type (boolean | 'indeterminate') has no attribute converter.",
			},
			{
				label: 'gl-tree-item (selected + focused, controlled)',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="always">
						<gl-tree-item
							level="1"
							path="src/git/gitProviderService.ts"
							.selected=${true}
							.controlledSelection=${true}
							focused
						>
							gitProviderService.ts
						</gl-tree-item>
						<gl-tree-item level="1" path="src/git/models/fileChange.ts"> fileChange.ts </gl-tree-item>
					</gl-tree>
				`,
				note: '`selected` is an internal @state() field with no attribute — bound here via a property binding purely for display, mirroring how the real gl-tree-view drives it in controlled mode.',
			},
			{
				label: 'gl-tree-item (rich row + inline action)',
				layout: 'tall',
				render: () => html`
					<gl-tree guides="always">
						<gl-tree-item rich level="1" path="src/agents/session.ts">
							<code-icon slot="icon" icon="robot"></code-icon>
							<div>
								<div>Claude Code session</div>
								<div>Editing 3 files…</div>
							</div>
							<gl-action-chip slot="actions" icon="close" label="Stop"></gl-action-chip>
						</gl-tree-item>
					</gl-tree>
				`,
				note: '`rich` opts the row out of the fixed single-line height so arbitrary multi-line content can be slotted in.',
			},
			{
				label: 'gl-file-tree-pane (basic list)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="24rem">
						<gl-file-tree-pane .files=${basicFiles}></gl-file-tree-pane>
					</div>
				`,
				note: "Wrapped in a fixed-height frame — gl-file-tree-pane's internal lit-virtualizer needs a definite-height ancestor or it lays out 0 rows.",
			},
			{
				label: 'gl-file-tree-pane (tree layout + file icons)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="26rem">
						<gl-file-tree-pane .files=${treeLayoutFiles} .filesLayout=${treeLayoutConfig} show-file-icons>
						</gl-file-tree-pane>
					</div>
				`,
				note: 'Needs the fixed-height frame (see the basic-list demo) for the virtualizer to render rows.',
			},
			{
				label: 'gl-file-tree-pane (checkable: stage/unstage)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="24rem">
						<gl-file-tree-pane
							.files=${basicFiles}
							checkable
							check-verb="Stage"
							uncheck-verb="Unstage"
							.checkableStates=${checkableStates}
							selection-badge-label="Staged"
						></gl-file-tree-pane>
					</div>
				`,
				note: 'Toggling a checkbox dispatches gl-check-all/file-checked with no listener here — it still flips visually (uncontrolled optimistic toggle). Needs the fixed-height frame.',
			},
			{
				label: 'gl-file-tree-pane (conflict status)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="16rem">
						<gl-file-tree-pane .files=${conflictFiles}></gl-file-tree-pane>
					</div>
				`,
				note: 'Needs the fixed-height frame for the virtualizer to render rows.',
			},
			{
				label: 'gl-file-tree-pane (actions + agent decoration)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="16rem">
						<gl-file-tree-pane
							.files=${agentFiles}
							.fileActions=${fileRowActions}
							.agentTouchedFiles=${agentTouchedFiles}
						></gl-file-tree-pane>
					</div>
				`,
				note: 'The inline action chip dispatches a plain CustomEvent with no listener here — clickable, but no-ops. Needs the fixed-height frame.',
			},
			{
				label: 'gl-file-tree-pane (search box + match highlighting)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="24rem">
						<gl-file-tree-pane .files=${basicFiles} .searchContext=${searchContext} show-search-box>
						</gl-file-tree-pane>
					</div>
				`,
				note: 'Needs the fixed-height frame for the virtualizer to render rows.',
			},
			{
				label: 'gl-wip-tree-pane (grouped staged/unstaged)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="26rem">
						<gl-wip-tree-pane .files=${wipFiles} .stats=${wipStats} .preferences=${wipPreferences}>
						</gl-wip-tree-pane>
					</div>
				`,
				note: 'Toolbar buttons (Stash/Discard/Copy) dispatch events nothing listens for here — they render and are clickable, just no-op. Needs the fixed-height frame.',
			},
			{
				label: 'gl-wip-tree-pane (checkable + multi-selectable)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="26rem">
						<gl-wip-tree-pane
							.files=${wipFiles}
							.stats=${wipStats}
							.preferences=${wipPreferences}
							checkable
							multi-selectable
						></gl-wip-tree-pane>
					</div>
				`,
				note: 'Needs the fixed-height frame for the virtualizer to render rows.',
			},
			{
				label: 'gl-wip-tree-pane (conflict resolution toolbar)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="18rem">
						<gl-wip-tree-pane
							.files=${wipConflictFiles}
							.preferences=${wipPreferences}
							bulk-conflict-actions
							resolve-enabled
						></gl-wip-tree-pane>
					</div>
				`,
				note: 'Shows Resolve Conflicts + Stage Current/Incoming for All Conflicts; their handlers dispatch bubbling events with no listener here.',
			},
			{
				label: 'gl-wip-tree-pane (empty state)',
				layout: 'tall',
				render: () => html`
					<div data-tree-frame-height="10rem">
						<gl-wip-tree-pane .files=${noFiles} .preferences=${wipPreferences}></gl-wip-tree-pane>
					</div>
				`,
				note: 'Leading action cluster hides entirely when files is empty; gl-file-tree-pane\'s own empty text ("No Files") shows instead.',
			},
		],
	},
];
