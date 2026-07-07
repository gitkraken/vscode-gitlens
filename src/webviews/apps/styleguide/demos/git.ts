import { html } from 'lit';
import type { GitRebaseStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { CommitSignatureShape } from '../../../commitDetails/protocol.js';
import type { ComponentDemo, ComponentGroup } from './types.js';
import '../../shared/components/branch-icon.js';
import '../../shared/components/branch-name.js';
import '../../shared/components/commit-sha.js';
import '../../shared/components/commit/commit-author.js';
import '../../shared/components/commit/commit-stats.js';
import '../../shared/components/commit/signature-badge.js';
import '../../shared/components/commit/signature-details.js';
import '../../shared/components/commit/wip-stats.js';
import '../../shared/components/ref-name.js';
import '../../shared/components/status/git-status.js';

const REF_BRANCH: GitReference = {
	refType: 'branch',
	id: 'refs/heads/feature/graph-performance',
	name: 'feature/graph-performance',
	ref: 'refs/heads/feature/graph-performance',
	sha: '6e917dc71d47d2d34404e0b4edc49247560b4a5c',
	remote: false,
	repoPath: '/Users/dev/gitlens',
};

const REF_TAG: GitReference = {
	refType: 'tag',
	id: 'refs/tags/v14.2.0',
	name: 'v14.2.0',
	ref: 'refs/tags/v14.2.0',
	sha: 'a5c364130e76aa89c5db037afba921e4e63d9a3b',
	repoPath: '/Users/dev/gitlens',
};

const REF_REVISION: GitReference = {
	refType: 'revision',
	name: '6cf7ae0',
	ref: '6cf7ae0b4ee3344a1cdfc51feb9c10836e9cfc79',
	sha: '6cf7ae0b4ee3344a1cdfc51feb9c10836e9cfc79',
	repoPath: '/Users/dev/gitlens',
};

// Small inline avatar so we never hit a remote gravatar/robohash URL. gl-commit-author's
// renderPopoverContent() shows .avatarUrl unconditionally (not gated on show-avatar), so every
// gl-commit-author demo below sets this explicitly — omitting it entirely would still fall back
// to the class default (a live gravatar/robohash URL) the moment the identity popover is opened.
const AVATAR_DATA_URI =
	'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjNGVjOWIwIi8+PHRleHQgeD0iMzIiIHk9IjQyIiBmb250LXNpemU9IjI2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjZmZmZmZmIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+RUE8L3RleHQ+PC9zdmc+';

// Shared across gl-commit-author / gl-signature-badge / gl-signature-details so the demos read as
// one consistent signer, and gl-signature-details can still show the fingerprint copy line.
const SIGNATURE_TRUSTED: CommitSignatureShape = {
	status: 'good',
	format: 'gpg',
	signer: 'Eric Amodio <eamodio@gitkraken.com>',
	trustLevel: 'ultimate',
	keyId: '9B62179273C8EB5B',
	fingerprint: 'D7E8 05DA 846A 32C3 BB81  E3C2 9B62 1792 73C8 EB5B',
};

const SIGNATURE_UNVERIFIED: CommitSignatureShape = {
	status: 'good',
	format: 'ssh',
	signer: 'keith.daulton@gitkraken.com',
	trustLevel: 'unknown',
	fingerprint: 'SHA256:4f6c1a9b7d3e2f5a8c0b6d1e4f7a9c2b5d8e1f4a',
};

const SIGNATURE_BAD: CommitSignatureShape = {
	status: 'bad',
	format: 'gpg',
	signer: 'Unknown Signer <unknown@example.com>',
	errorMessage: 'BAD signature from unknown key',
};

const SIGNATURE_EXPIRED: CommitSignatureShape = {
	status: 'expired',
	format: 'gpg',
	signer: 'Keith Daulton <keith.daulton@gitkraken.com>',
	keyId: 'B682575EC87A171A',
};

const SIGNATURE_MISSING_KEY: CommitSignatureShape = {
	status: 'error',
	format: 'gpg',
	signer: 'Unknown Signer <unknown@example.com>',
	keyId: 'C826A6FCE48478DC',
	errorMessage: 'gpg: Can’t check signature: no public key',
};

const REBASE_HEAD = {
	refType: 'revision',
	name: '6e917dc',
	ref: '6e917dc71d47d2d34404e0b4edc49247560b4a5c',
	sha: '6e917dc71d47d2d34404e0b4edc49247560b4a5c',
	repoPath: '/Users/dev/gitlens',
} as const;

const REBASE_STATUS: GitRebaseStatus = {
	type: 'rebase',
	repoPath: '/Users/dev/gitlens',
	HEAD: REBASE_HEAD,
	current: {
		refType: 'branch',
		name: 'feature/graph-performance',
		ref: 'refs/heads/feature/graph-performance',
		sha: '6e917dc71d47d2d34404e0b4edc49247560b4a5c',
		remote: false,
		repoPath: '/Users/dev/gitlens',
	},
	incoming: {
		refType: 'branch',
		name: 'main',
		ref: 'refs/heads/main',
		sha: 'd685766b7e1c78f485aab431a0923af7fc444984',
		remote: false,
		repoPath: '/Users/dev/gitlens',
	},
	mergeBase: 'a5c364130e76aa89c5db037afba921e4e63d9a3b',
	onto: {
		refType: 'revision',
		name: 'd685766',
		ref: 'd685766b7e1c78f485aab431a0923af7fc444984',
		sha: 'd685766b7e1c78f485aab431a0923af7fc444984',
		repoPath: '/Users/dev/gitlens',
	},
	source: REBASE_HEAD,
	steps: {
		current: {
			number: 2,
			commit: {
				refType: 'revision',
				name: '6cf7ae0',
				ref: '6cf7ae0b4ee3344a1cdfc51feb9c10836e9cfc79',
				sha: '6cf7ae0b4ee3344a1cdfc51feb9c10836e9cfc79',
				repoPath: '/Users/dev/gitlens',
			},
		},
		total: 5,
	},
	hasStarted: true,
	isPaused: true,
	isInteractive: true,
};

const branchIconDemos: ComponentDemo[] = [
	{
		label: 'gl-branch-icon status=local',
		render: () => html`<gl-branch-icon branch="feature/graph-performance" status="local"></gl-branch-icon>`,
		note: 'Local-only icon (plain git-branch glyph, no status ring). Hover to see the tooltip.',
	},
	{
		label: 'gl-branch-icon status=diverged',
		render: () =>
			html`<gl-branch-icon
				branch="feature/graph-performance"
				status="diverged"
				upstream="origin/feature/graph-performance"
			></gl-branch-icon>`,
	},
	{
		label: 'gl-branch-icon status=ahead',
		render: () =>
			html`<gl-branch-icon
				branch="feature/graph-performance"
				status="ahead"
				upstream="origin/feature/graph-performance"
			></gl-branch-icon>`,
	},
	{
		label: 'gl-branch-icon status=behind',
		render: () =>
			html`<gl-branch-icon
				branch="feature/graph-performance"
				status="behind"
				upstream="origin/feature/graph-performance"
			></gl-branch-icon>`,
	},
	{
		label: 'gl-branch-icon status=missingUpstream',
		render: () =>
			html`<gl-branch-icon
				branch="bug/#3521-blame-gutter"
				status="missingUpstream"
				upstream="origin/bug/#3521-blame-gutter"
			></gl-branch-icon>`,
	},
	{
		label: 'gl-branch-icon status=upToDate haschanges',
		render: () =>
			html`<gl-branch-icon branch="main" status="upToDate" upstream="origin/main" haschanges></gl-branch-icon>`,
		note: "`hasChanges` has no attribute rename, so Lit's default-lowercased observed attribute is `haschanges` (no hyphen) — using the bare attribute avoids relying on case.",
	},
	{
		label: 'gl-branch-icon worktree',
		render: () =>
			html`<gl-branch-icon
				branch="feature/graph-performance"
				status="local"
				worktree
				haschanges
			></gl-branch-icon>`,
		note: 'Renders the dedicated worktree glyph with a colored ring — haschanges is required for the ring to pick up a color; without it the ring is transparent (see "worktree is-default" below).',
	},
	{
		label: 'gl-branch-icon worktree is-default',
		render: () => html`<gl-branch-icon branch="main" status="local" worktree is-default></gl-branch-icon>`,
		note: 'is-default suppresses the worktree glyph even though worktree is true, falling back to the generic status-ring glyph (ring is transparent here since there are no changes, so it reads as the plain branch icon).',
	},
	{
		label: 'gl-branch-icon status=detached',
		render: () => html`<gl-branch-icon status="detached"></gl-branch-icon>`,
		note: 'Renders a plain git-commit code-icon, bypassing the SVG branch/worktree glyphs entirely.',
	},
];

const branchNameDemos: ComponentDemo[] = [
	{
		label: 'gl-branch-name default',
		render: () => html`<gl-branch-name name="feature/graph-performance"></gl-branch-name>`,
	},
	{
		label: 'gl-branch-name appearance=pill',
		render: () => html`<gl-branch-name appearance="pill" name="main"></gl-branch-name>`,
		note: "Pill color comes from --gl-branch-color, which falls back to the graph's local-branch scroll-marker color.",
	},
	{
		label: 'gl-branch-name appearance=button chevron',
		render: () => html`<gl-branch-name appearance="button" name="release/14.2" chevron></gl-branch-name>`,
		note: 'Focusable/clickable (role=button, tabindex=0); click is a normal DOM event with no listener here, so it safely no-ops in the styleguide.',
	},
	{
		label: 'gl-branch-name worktree',
		render: () => html`<gl-branch-name name="bug/#3521-blame-gutter" worktree></gl-branch-name>`,
	},
	{
		label: 'gl-branch-name custom icon',
		render: () => html`<gl-branch-name name="v14.2.0" icon="tag"></gl-branch-name>`,
		note: 'Demonstrates the icon override escape hatch (consumers reuse this component for tag-like labels too).',
	},
];

const refNameDemos: ComponentDemo[] = [
	{
		label: 'gl-ref-name branch (icon)',
		render: () => html`<gl-ref-name icon .ref=${REF_BRANCH}></gl-ref-name>`,
	},
	{
		label: 'gl-ref-name branch worktree (icon)',
		render: () => html`<gl-ref-name icon worktree .ref=${REF_BRANCH}></gl-ref-name>`,
		note: "worktree=true swaps the icon/class to the gl-worktree glyph even though ref.refType is still 'branch'.",
	},
	{
		label: 'gl-ref-name tag (icon)',
		render: () => html`<gl-ref-name icon .ref=${REF_TAG}></gl-ref-name>`,
	},
	{
		label: 'gl-ref-name revision (icon)',
		render: () => html`<gl-ref-name icon .ref=${REF_REVISION}></gl-ref-name>`,
	},
	{
		label: 'gl-ref-name label-only (no icon)',
		render: () => html`<gl-ref-name .ref=${REF_BRANCH}></gl-ref-name>`,
	},
];

const commitShaDemos: ComponentDemo[] = [
	{
		label: 'gl-commit-sha committed',
		render: () => html`<gl-commit-sha sha="6e917dc71d47d2d34404e0b4edc49247560b4a5c"></gl-commit-sha>`,
	},
	{
		label: 'gl-commit-sha appearance=pill',
		render: () =>
			html`<gl-commit-sha appearance="pill" sha="a5c364130e76aa89c5db037afba921e4e63d9a3b"></gl-commit-sha>`,
	},
	{
		label: 'gl-commit-sha uncommitted (working)',
		render: () => html`<gl-commit-sha sha="0000000000000000000000000000000000000000"></gl-commit-sha>`,
	},
	{
		label: 'gl-commit-sha uncommitted (staged)',
		render: () => html`<gl-commit-sha sha="0000000000000000000000000000000000000000:"></gl-commit-sha>`,
	},
	{
		label: 'gl-commit-sha-copy default',
		render: () => html`<gl-commit-sha-copy sha="6e917dc71d47d2d34404e0b4edc49247560b4a5c"></gl-commit-sha-copy>`,
		note: "Not otherwise composed into any higher-level demo elsewhere in this catalog. Clicking calls navigator.clipboard.writeText and flips the tooltip label to 'Copied!'; if clipboard access is unavailable in the sandboxed webview it falls back to 'Unable to Copy' — either way it renders and reacts, it just may not literally copy.",
	},
	{
		label: 'gl-commit-sha-copy appearance=toolbar',
		render: () =>
			html`<gl-commit-sha-copy
				appearance="toolbar"
				sha="a5c364130e76aa89c5db037afba921e4e63d9a3b"
			></gl-commit-sha-copy>`,
	},
	{
		label: 'gl-commit-sha-copy uncommitted (no copy affordance)',
		render: () => html`<gl-commit-sha-copy sha="0000000000000000000000000000000000000000"></gl-commit-sha-copy>`,
	},
];

const commitAuthorDemos: ComponentDemo[] = [
	{
		label: 'gl-commit-author default (person icon)',
		render: () =>
			html`<gl-commit-author
				name="Eric Amodio"
				email="eamodio@gitkraken.com"
				.avatarUrl=${AVATAR_DATA_URI}
				.authorDate=${new Date('2026-07-01T14:32:00Z')}
			></gl-commit-author>`,
	},
	{
		label: 'gl-commit-author layout=stacked',
		render: () =>
			html`<gl-commit-author
				layout="stacked"
				name="Eric Amodio"
				email="eamodio@gitkraken.com"
				.avatarUrl=${AVATAR_DATA_URI}
				.authorDate=${new Date('2026-07-06T09:15:00Z')}
			></gl-commit-author>`,
	},
	{
		label: 'gl-commit-author avatar + trusted signature',
		render: () =>
			html`<gl-commit-author
				layout="stacked"
				show-avatar
				.avatarUrl=${AVATAR_DATA_URI}
				name="Eric Amodio"
				email="eamodio@gitkraken.com"
				.authorDate=${new Date('2026-07-06T09:15:00Z')}
				.signature=${SIGNATURE_TRUSTED}
			></gl-commit-author>`,
		note: 'avatarUrl/committerEmail/etc. are multi-word properties with no attribute rename, so the observed attribute would be an all-lowercase run (e.g. avatarurl) — use property bindings (.avatarUrl=) to sidestep that entirely.',
	},
	{
		label: 'gl-commit-author distinct committer',
		render: () =>
			html`<gl-commit-author
				layout="stacked"
				name="Eric Amodio"
				email="eamodio@gitkraken.com"
				.avatarUrl=${AVATAR_DATA_URI}
				.committerName=${'Keith Daulton'}
				.committerEmail=${'keith.daulton@gitkraken.com'}
				.authorDate=${new Date('2026-07-06T09:15:00Z')}
				.committerDate=${new Date('2026-07-06T11:42:00Z')}
			></gl-commit-author>`,
		note: 'Hover/click/focus the row to open the identity gl-popover — it lists both author and committer with emails and (if present) the signature.',
	},
	{
		label: 'gl-commit-author dateStyle=absolute',
		render: () =>
			html`<gl-commit-author
				name="Eric Amodio"
				email="eamodio@gitkraken.com"
				.avatarUrl=${AVATAR_DATA_URI}
				.authorDate=${new Date('2026-07-06T09:15:00Z')}
				.dateStyle=${'absolute'}
			></gl-commit-author>`,
	},
];

const commitStatsDemos: ComponentDemo[] = [
	{
		label: 'commit-stats symbols (default)',
		render: () => html`<commit-stats added="3" modified="5" removed="1"></commit-stats>`,
		note: "Hover for the full tooltip breakdown ('9 files changed (3 added, 5 modified, 1 removed)').",
	},
	{
		label: 'commit-stats symbol=icons',
		render: () => html`<commit-stats added="3" modified="5" removed="1" symbol="icons"></commit-stats>`,
		note: 'The exported renderCommitStatsIcons(stats, opts) helper in this same file builds this exact markup from a GitCommitStats model — not separately demoed since output is identical.',
	},
	{
		label: 'commit-stats appearance=pill',
		render: () =>
			html`<commit-stats added="12" modified="4" removed="2" symbol="icons" appearance="pill"></commit-stats>`,
	},
	{
		label: 'commit-stats no-tooltip',
		render: () => html`<commit-stats added="2" symbol="icons" no-tooltip></commit-stats>`,
	},
	{
		label: 'commit-stats removed-only',
		render: () => html`<commit-stats removed="7" symbol="icons"></commit-stats>`,
		note: 'Shows how a single non-null stat renders alone (added/modified are both null here, so only the removed span appears).',
	},
];

const wipStatsDemos: ComponentDemo[] = [
	{
		label: 'gl-wip-stats dirty (pill, icons)',
		render: () => html`<gl-wip-stats added="3" modified="5" removed="1"></gl-wip-stats>`,
	},
	{
		label: 'gl-wip-stats clean',
		render: () => html`<gl-wip-stats show-clean added="0" modified="0" removed="0"></gl-wip-stats>`,
		note: 'The all-null guard requires at least one of dirty/added/modified/removed to be non-null, hence the explicit 0s.',
	},
	{
		label: 'gl-wip-stats badge dirty',
		render: () => html`<gl-wip-stats badge added="2" modified="1"></gl-wip-stats>`,
	},
	{
		label: 'gl-wip-stats badge clean',
		render: () => html`<gl-wip-stats badge show-clean added="0" modified="0" removed="0"></gl-wip-stats>`,
	},
	{
		label: 'gl-wip-stats paused rebase',
		render: () => html`<gl-wip-stats .pausedOpStatus=${REBASE_STATUS}></gl-wip-stats>`,
		note: 'pausedOpStatus is attribute:false — it MUST be set via the .pausedOpStatus= property binding; there is no attribute form at all.',
	},
	{
		label: 'gl-wip-stats paused rebase with conflicts',
		render: () =>
			html`<gl-wip-stats .pausedOpStatus=${REBASE_STATUS} has-conflicts conflicts-count="3"></gl-wip-stats>`,
	},
];

const signatureBadgeDemos: ComponentDemo[] = [
	{
		label: 'gl-signature-badge trusted',
		render: () =>
			html`<gl-signature-badge
				.signature=${SIGNATURE_TRUSTED}
				.committerEmail=${'eamodio@gitkraken.com'}
			></gl-signature-badge>`,
	},
	{
		label: 'gl-signature-badge unverified signer (unknown)',
		render: () =>
			html`<gl-signature-badge
				.signature=${SIGNATURE_UNVERIFIED}
				.committerEmail=${'keith.daulton@gitkraken.com'}
			></gl-signature-badge>`,
		note: "trustLevel='unknown' keeps this in the 'unknown' (muted) state even though status is 'good' and the emails match.",
	},
	{
		label: 'gl-signature-badge untrusted (bad)',
		render: () => html`<gl-signature-badge .signature=${SIGNATURE_BAD}></gl-signature-badge>`,
	},
];

const signatureDetailsDemos: ComponentDemo[] = [
	{
		label: 'gl-signature-details trusted (fingerprint)',
		wide: true,
		render: () =>
			html`<gl-signature-details
				.signature=${SIGNATURE_TRUSTED}
				.committerEmail=${'eamodio@gitkraken.com'}
			></gl-signature-details>`,
		note: 'The key/fingerprint line has a gl-copy-container icon button; clicking copies the fingerprint to the clipboard.',
	},
	{
		label: 'gl-signature-details expired key',
		wide: true,
		render: () =>
			html`<gl-signature-details
				.signature=${SIGNATURE_EXPIRED}
				.committerEmail=${'keith.daulton@gitkraken.com'}
			></gl-signature-details>`,
	},
	{
		label: 'gl-signature-details missing public key',
		wide: true,
		render: () => html`<gl-signature-details .signature=${SIGNATURE_MISSING_KEY}></gl-signature-details>`,
	},
];

const gitStatusDemos: ComponentDemo[] = [
	{ label: 'gl-git-status modified', render: () => html`<gl-git-status status="M"></gl-git-status>` },
	{ label: 'gl-git-status added', render: () => html`<gl-git-status status="A"></gl-git-status>` },
	{ label: 'gl-git-status deleted', render: () => html`<gl-git-status status="D"></gl-git-status>` },
	{ label: 'gl-git-status renamed', render: () => html`<gl-git-status status="R"></gl-git-status>` },
	{ label: 'gl-git-status copied', render: () => html`<gl-git-status status="C"></gl-git-status>` },
	{ label: 'gl-git-status untracked', render: () => html`<gl-git-status status="?"></gl-git-status>` },
	{ label: 'gl-git-status ignored', render: () => html`<gl-git-status status="!"></gl-git-status>` },
	{
		label: 'gl-git-status conflict (both modified)',
		render: () => html`<gl-git-status status="UU"></gl-git-status>`,
		note: '2-char status auto-sets the [conflict] attribute, which bumps --gl-icon-size and switches to the split two-tone glyph.',
	},
	{
		label: 'gl-git-status conflict (added by us)',
		render: () => html`<gl-git-status status="AU"></gl-git-status>`,
	},
	{
		label: 'gl-git-status conflict (added by them)',
		render: () => html`<gl-git-status status="UA"></gl-git-status>`,
	},
	{
		label: 'gl-git-status conflict (added by both)',
		render: () => html`<gl-git-status status="AA"></gl-git-status>`,
	},
	{
		label: 'gl-git-status conflict (deleted by us)',
		render: () => html`<gl-git-status status="DU"></gl-git-status>`,
	},
	{
		label: 'gl-git-status conflict (deleted by them)',
		render: () => html`<gl-git-status status="UD"></gl-git-status>`,
	},
	{
		label: 'gl-git-status conflict (deleted by both)',
		render: () => html`<gl-git-status status="DD"></gl-git-status>`,
	},
];

export const gitGroups: ComponentGroup[] = [
	{
		family: 'Branches & refs',
		demos: [...branchIconDemos, ...branchNameDemos, ...refNameDemos],
	},
	{
		family: 'Commits, signatures & file status',
		demos: [
			...commitShaDemos,
			...commitAuthorDemos,
			...commitStatsDemos,
			...wipStatsDemos,
			...signatureBadgeDemos,
			...signatureDetailsDemos,
			...gitStatusDemos,
		],
	},
];
