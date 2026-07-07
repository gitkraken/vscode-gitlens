import { html } from 'lit';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import type { RepositoryShape } from '../../../../git/models/repositoryShape.js';
import '../../shared/components/actions/action-item.js';
import '../../shared/components/actions/action-nav.js';
import '../../shared/components/button-container.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/copy-container.js';
import '../../shared/components/nav-buttons.js';
import '../../shared/components/ref-button.js';
import '../../shared/components/repo-button-group.js';
import type { NavigationState } from '../../shared/controllers/navigationStack.js';
import type { ComponentGroup } from './types.js';

const navMid: NavigationState = { count: 5, position: 2, canBack: true, canForward: true };
const navAtStart: NavigationState = { count: 5, position: 0, canBack: false, canForward: true };
const navAtEnd: NavigationState = { count: 5, position: 4, canBack: true, canForward: false };

const repoNoProvider: RepositoryShape = {
	id: 'repo-1',
	name: 'vscode-gitlens',
	path: '/Users/dev/code/vscode-gitlens',
	uri: 'file:///Users/dev/code/vscode-gitlens',
	virtual: false,
};

const repoConnected: RepositoryShape = {
	id: 'repo-2',
	name: 'vscode-gitlens',
	path: '/Users/dev/code/vscode-gitlens',
	uri: 'file:///Users/dev/code/vscode-gitlens',
	virtual: false,
	provider: {
		name: 'GitHub',
		icon: 'github',
		// SupportedCloudIntegrationIds is a deep string-literal union — targeted cast for stub data.
		integration: { id: 'github' as SupportedCloudIntegrationIds, connected: true },
		supportedFeatures: { createPullRequestWithDetails: true },
		url: 'https://github.com/gitkraken/vscode-gitlens',
		bestRemoteName: 'origin',
	},
};

const repoDisconnected: RepositoryShape = {
	...repoConnected,
	id: 'repo-3',
	provider: {
		...repoConnected.provider!,
		integration: { id: 'github' as SupportedCloudIntegrationIds, connected: false },
	},
};

const branchRef: GitReference = {
	refType: 'branch',
	name: 'feature/graph-performance',
	ref: 'feature/graph-performance',
	sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
	repoPath: '/Users/dev/code/vscode-gitlens',
	remote: false,
};

const tagRef: GitReference = {
	refType: 'tag',
	name: 'v16.3.0',
	ref: 'v16.3.0',
	sha: 'b2c3d4e5f6789012345678901234567890abcdef',
	repoPath: '/Users/dev/code/vscode-gitlens',
};

const revisionRef: GitReference = {
	refType: 'revision',
	name: 'a1b2c3d',
	ref: 'a1b2c3d4e5f6789012345678901234567890abcd',
	sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
	repoPath: '/Users/dev/code/vscode-gitlens',
};

const worktreeBranchRef: GitReference = {
	refType: 'branch',
	name: 'bug/#3521-blame-gutter',
	ref: 'bug/#3521-blame-gutter',
	sha: 'c3d4e5f6789012345678901234567890abcdef12',
	repoPath: '/Users/dev/code/vscode-gitlens',
	remote: false,
	worktree: { path: '/Users/dev/code/vscode-gitlens-worktrees/blame-gutter', isDefault: false },
};

export const buttonsGroups: ComponentGroup[] = [
	{
		family: 'Buttons & actions',
		description:
			'gl-button, plus the repo/ref buttons built on top of it and the independently-implemented action-item/action-nav and copy-container primitives.',
		demos: [
			{ label: 'gl-button (filled)', render: () => html`<gl-button>Commit</gl-button>` },
			{
				label: 'gl-button (secondary)',
				render: () => html`<gl-button appearance="secondary">Cancel</gl-button>`,
			},
			{
				label: 'gl-button (toolbar + icon)',
				render: () =>
					html`<gl-button appearance="toolbar"
						><code-icon icon="git-commit" slot="prefix"></code-icon>Commit</gl-button
					>`,
			},
			{
				label: 'gl-button (danger)',
				render: () => html`<gl-button variant="danger">Delete branch</gl-button>`,
			},
			{
				label: 'gl-button (variant=warning)',
				render: () => html`<gl-button variant="warning">Force push</gl-button>`,
			},
			{
				label: 'gl-button (alert)',
				render: () => html`<gl-button appearance="alert">Resolve conflicts</gl-button>`,
			},
			{
				label: 'gl-button (toolbar, variant=success)',
				render: () =>
					html`<gl-button appearance="toolbar" variant="success"
						><code-icon icon="check" slot="prefix"></code-icon>All checks passed</gl-button
					>`,
				note: 'Transparent appearances (toolbar/input/alert) only recolor the foreground for variant — background/border stay transparent.',
			},
			{
				label: 'gl-button (disabled)',
				render: () => html`<gl-button disabled>Push 3 commits</gl-button>`,
			},
			{
				label: 'gl-button (tight, full)',
				render: () => html`<gl-button density="tight" full>Stage all changes</gl-button>`,
			},
			{
				label: 'gl-button (href + tooltip)',
				render: () =>
					html`<gl-button
						href="https://github.com/gitkraken/vscode-gitlens/pull/4821"
						tooltip="Open pull request on GitHub"
						>View PR #4821</gl-button
					>`,
			},
			{
				label: 'gl-button (input, truncate)',
				render: () =>
					html`<div class="demo-narrow">
						<gl-button appearance="input" truncate
							>feature/graph-performance-tuning-and-waterways-viz</gl-button
						>
					</div>`,
				note: 'constrained to 20rem so the label actually ellipsizes.',
			},
			{
				label: 'button-container (grouping=gap)',
				layout: 'block',
				render: () =>
					html`<button-container>
						<gl-button appearance="secondary">Discard</gl-button>
						<gl-button>Commit</gl-button>
					</button-container>`,
			},
			{
				label: 'button-container (grouping=split)',
				layout: 'block',
				render: () =>
					html`<button-container grouping="split">
						<gl-button appearance="secondary">Fetch</gl-button>
						<gl-button appearance="secondary">Pull</gl-button>
						<gl-button appearance="secondary">Push</gl-button>
					</button-container>`,
			},
			{
				label: 'button-container (grouping=gap-wide)',
				layout: 'block',
				render: () =>
					html`<button-container grouping="gap-wide">
						<gl-button appearance="secondary">Discard</gl-button>
						<gl-button>Commit</gl-button>
					</button-container>`,
				note: 'gap-wide widens the gap between buttons from 0.4rem to 1rem.',
			},
			{
				label: 'button-container (layout=full)',
				layout: 'block',
				render: () =>
					html`<button-container layout="full"><gl-button full>Sync changes</gl-button></button-container>`,
				note: 'layout=full stretches the group to 100% width of its stage.',
			},
			{
				label: 'button-container (layout=editor)',
				layout: 'block',
				render: () =>
					html`<button-container layout="editor">
						<gl-button appearance="secondary">Discard</gl-button>
						<gl-button>Commit</gl-button>
					</button-container>`,
				note: "layout=editor keeps the group's own max-width even on wide viewports — unlike layout=shift (the default), it never stretches to 100%.",
			},
			{
				label: 'action-item (basic)',
				render: () => html`<action-item icon="git-commit" label="View Commit Details"></action-item>`,
			},
			{
				label: 'action-item (alt icon/label)',
				render: () =>
					html`<action-item
						icon="copy"
						label="Copy SHA"
						alt-icon="note"
						alt-label="Copy Message"
					></action-item>`,
				note: 'Hold Alt or Shift while hovering or focused to see the icon and tooltip swap to the alt- variant — driven by a real global keydown listener, not a stub.',
			},
			{
				label: 'action-item (href)',
				render: () =>
					html`<action-item
						icon="link-external"
						label="Open on GitHub"
						href="https://github.com/gitkraken/vscode-gitlens/commit/1a2b3c4d5e6f7089abcdef1234567890abcdef12"
					></action-item>`,
			},
			{
				label: 'action-item (disabled)',
				render: () => html`<action-item icon="ellipsis" label="More Actions" disabled></action-item>`,
			},
			{
				label: 'action-nav (with action-items)',
				render: () =>
					html`<action-nav>
						<action-item icon="git-commit" label="View Commit"></action-item>
						<action-item icon="copy" label="Copy SHA"></action-item>
						<action-item
							icon="link-external"
							label="Open on GitHub"
							href="https://github.com/gitkraken/vscode-gitlens/commit/1a2b3c4d5e6f7089abcdef1234567890abcdef12"
						></action-item>
					</action-nav>`,
				note: 'Arrow-key navigation between the action-items works live — action-nav sets roving tabindex on slotchange.',
			},
			{
				label: 'gl-nav-buttons (mid-stack)',
				render: () => html`<gl-nav-buttons .navigation=${navMid}></gl-nav-buttons>`,
			},
			{
				label: 'gl-nav-buttons (at start)',
				render: () => html`<gl-nav-buttons .navigation=${navAtStart}></gl-nav-buttons>`,
				note: 'Back chip disabled.',
			},
			{
				label: 'gl-nav-buttons (at end)',
				render: () => html`<gl-nav-buttons .navigation=${navAtEnd}></gl-nav-buttons>`,
				note: 'Forward chip disabled.',
			},
			{
				label: 'gl-repo-button-group (no provider)',
				render: () => html`<gl-repo-button-group .repository=${repoNoProvider}></gl-repo-button-group>`,
			},
			{
				label: 'gl-repo-button-group (connected GitHub)',
				render: () => html`<gl-repo-button-group .repository=${repoConnected}></gl-repo-button-group>`,
			},
			{
				label: 'gl-repo-button-group (disconnected)',
				render: () => html`<gl-repo-button-group .repository=${repoDisconnected}></gl-repo-button-group>`,
				note: 'Shows the connect chip in place of the connected indicator dot.',
			},
			{
				label: 'gl-repo-button-group (multi-repo)',
				wide: true,
				render: () =>
					html`<gl-repo-button-group multi-repo .repository=${repoConnected}></gl-repo-button-group>`,
			},
			{
				label: 'gl-repo-button-group (disabled)',
				render: () =>
					html`<gl-repo-button-group disabled .repository=${repoNoProvider}></gl-repo-button-group>`,
			},
			{
				label: 'gl-ref-button (branch)',
				render: () => html`<gl-ref-button icon .ref=${branchRef}></gl-ref-button>`,
			},
			{
				label: 'gl-ref-button (tag)',
				render: () => html`<gl-ref-button icon .ref=${tagRef}></gl-ref-button>`,
			},
			{
				label: 'gl-ref-button (revision)',
				render: () => html`<gl-ref-button icon .ref=${revisionRef}></gl-ref-button>`,
			},
			{
				label: 'gl-ref-button (worktree branch)',
				render: () => html`<gl-ref-button icon worktree .ref=${worktreeBranchRef}></gl-ref-button>`,
			},
			{
				label: 'gl-ref-button (no ref)',
				render: () => html`<gl-ref-button icon></gl-ref-button>`,
			},
			{
				label: 'gl-ref-button (disabled)',
				render: () => html`<gl-ref-button icon disabled .ref=${branchRef}></gl-ref-button>`,
			},
			{
				label: 'gl-copy-container (default)',
				render: () =>
					html`<gl-copy-container content="a1b2c3d4e5f6789012345678901234567890abcd"
						>a1b2c3d</gl-copy-container
					>`,
				note: 'Copy uses navigator.clipboard — falls back to an "Unable to Copy" label in restricted webview contexts instead of throwing.',
			},
			{
				label: 'gl-copy-container (toolbar)',
				render: () =>
					html`<gl-copy-container appearance="toolbar" content="a1b2c3d4e5f6789012345678901234567890abcd">
						<code-icon class="copy-icon" icon="copy"></code-icon>
					</gl-copy-container>`,
			},
			{
				label: 'gl-copy-container (custom labels)',
				render: () =>
					html`<gl-copy-container
						content="feature/graph-performance"
						.copyLabel=${'Copy branch name'}
						.copiedLabel=${'Branch name copied'}
						>feature/graph-performance</gl-copy-container
					>`,
			},
			{
				label: 'gl-copy-container (disabled)',
				render: () =>
					html`<gl-copy-container disabled content="a1b2c3d4e5f6789012345678901234567890abcd"
						>a1b2c3d</gl-copy-container
					>`,
			},
		],
	},
];
