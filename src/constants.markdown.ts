import type { GlCommands } from './constants.commands.js';

/**
 * The only commands that `command:` links in GitLens-rendered Markdown (editor hovers, view tooltips) may run.
 * Those Markdown strings include text GitLens doesn't control (commit messages, pull request and issue titles,
 * author names), so they are trusted for this list rather than for every command.
 *
 * Keep it to commands GitLens itself emits as links: the `CommitFormatter` tokens, autolinks, the editor hovers,
 * and the view tooltips that build their own links. Shared by reference — never copy or rebuild it per use.
 */
export const trustedMarkdownCommands: readonly string[] = Object.freeze([
	'gitlens.action.hover.commands' satisfies GlCommands,
	'gitlens.action.openIssue' satisfies GlCommands,
	'gitlens.action.openPullRequest' satisfies GlCommands,
	'gitlens.ai.explainCommit:editor' satisfies GlCommands,
	'gitlens.ai.explainWip:editor' satisfies GlCommands,
	'gitlens.connectRemoteProvider' satisfies GlCommands,
	'gitlens.copyShaToClipboard' satisfies GlCommands,
	'gitlens.diffWith' satisfies GlCommands,
	'gitlens.openCommitOnRemote' satisfies GlCommands,
	'gitlens.openFileRevision' satisfies GlCommands,
	'gitlens.refreshHover' satisfies GlCommands,
	'gitlens.revealCommitInView' satisfies GlCommands,
	'gitlens.showCommitInView' satisfies GlCommands,
	'gitlens.showInCommitGraph' satisfies GlCommands,
	'gitlens.showQuickCommitDetails' satisfies GlCommands,
	'gitlens.showQuickCommitFileDetails' satisfies GlCommands,
	'gitlens.views.revealWorktreeInExplorer' satisfies GlCommands,
]);
