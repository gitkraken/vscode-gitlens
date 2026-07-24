import type { CancellationToken, Disposable, TerminalLink, TerminalLinkContext, TerminalLinkProvider } from 'vscode';
import { commands, window } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { GitTag } from '@gitlens/git/models/tag.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { CompareWithCommandArgs } from '../commands/compareWith.js';
import type { GitWizardCommandArgs } from '../commands/gitWizard.js';
import type { InspectCommandArgs } from '../commands/inspect.js';
import type { ShowQuickBranchHistoryCommandArgs } from '../commands/showQuickBranchHistory.js';
import type { ShowQuickCommitCommandArgs } from '../commands/showQuickCommit.js';
import type { GlCommands } from '../constants.commands.js';
import type { Container } from '../container.js';
import type { GlRepository } from '../git/models/repository.js';
import { getReferenceFromBranch, getReferenceFromTag } from '../git/utils/-webview/reference.utils.js';
import { toAbortSignal } from '../system/-webview/cancellation.js';
import { createTerminalLinkCommand } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import type { GraphCompareSeed } from '../webviews/plus/graph/protocol.js';
import type { ShowInCommitGraphCommandArgs } from '../webviews/plus/graph/registration.js';

type TerminalLinkShowIn = 'graph' | 'inspect' | 'quickpick';

const commandsRegexShared =
	/\b(g(?:it)?\b\s*)\b(branch|checkout|cherry-pick|fetch|grep|log|merge|pull|push|rebase|reset|revert|show|stash|status|tag)\b/gi;
// Since negative lookbehind isn't supported in all browsers, leave out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// oxlint-disable-next-line no-control-regex
const refRegexShared = /\b((?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ,~^:?*[\\]+[^ ./])\b/gi;
// Matches a revision range (`<ref>..<ref>` / `<ref>...<ref>`) as a whole — each side is a ref-name-ish
// token (branch/tag/HEAD/sha, plus `~N`/`^` suffixes). `refRegexShared` rejects any token containing
// `..`, so ranges must be detected separately (and the trailing ref suppressed below); sides are then
// validated (below) so file paths like `a/../b` don't link. The side pattern (word/-/slash runs joined
// by single dots) mirrors the range side in `packages/git`'s revision utils and can't swallow the `..`.
const rangesRegexShared = /\b([\w/-]+(?:\.[\w/-]+)*(?:[~^]\d*)*)(\.\.\.?)([\w/-]+(?:\.[\w/-]+)*(?:[~^]\d*)*)/gi;
const shaRegex = /^[0-9a-f]{7,40}$/;

interface GitTerminalLink<T = object> extends TerminalLink {
	command: {
		command: GlCommands;
		args: T;
	};
}

// Builds the command a clicked commit link fires, per the `terminalLinks.showIn` setting.
function createCommitLinkCommand(showIn: TerminalLinkShowIn, repoPath: string, sha: string) {
	switch (showIn) {
		case 'inspect':
			return createTerminalLinkCommand<InspectCommandArgs>('gitlens.showInDetailsView', {
				ref: createReference(sha, repoPath, { refType: 'revision' }),
			});
		case 'quickpick':
			return createTerminalLinkCommand<ShowQuickCommitCommandArgs>('gitlens.showQuickCommitDetails', {
				repoPath: repoPath,
				sha: sha,
			});
		case 'graph':
		default:
			return createTerminalLinkCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
				ref: createReference(sha, repoPath, { refType: 'revision' }),
			});
	}
}

// Builds the command a clicked branch/tag/HEAD link fires. `graph` reveals the ref; `inspect` shows
// its tip commit (falling back to the ref's history when the tip sha is unknown); `quickpick` opens
// the ref's history.
function createRefLinkCommand(
	showIn: TerminalLinkShowIn,
	repoPath: string,
	graphRef: GitReference,
	tipSha: string | undefined,
	historyArgs: ShowQuickBranchHistoryCommandArgs,
) {
	if (showIn === 'graph') {
		return createTerminalLinkCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', { ref: graphRef });
	}
	if (showIn === 'inspect' && tipSha != null) {
		return createTerminalLinkCommand<InspectCommandArgs>('gitlens.showInDetailsView', {
			ref: createReference(tipSha, repoPath, { refType: 'revision' }),
		});
	}
	return createTerminalLinkCommand<ShowQuickBranchHistoryCommandArgs>('gitlens.showQuickBranchHistory', historyArgs);
}

// Builds the command a clicked commit range fires. `graph` opens the Commit Graph's compare mode with
// the two endpoints (falling back to the Search & Compare view when the repository can't be resolved);
// `inspect` opens a comparison in the Search & Compare view; `quickpick` opens the commit log for the
// range (preserving the literal `..`/`...` operator). Convention: left = base (older), right = compare.
function createRangeLinkCommand(
	showIn: TerminalLinkShowIn,
	repoPath: string,
	range: string,
	left: string,
	right: string,
	repository: GlRepository | undefined,
	leftRefType: 'branch' | 'tag' | 'commit',
	rightRefType: 'branch' | 'tag' | 'commit',
) {
	if (showIn === 'graph' && repository != null) {
		const compare: GraphCompareSeed = {
			leftRef: left,
			leftRefType: leftRefType,
			rightRef: right,
			rightRefType: rightRefType,
		};
		return createTerminalLinkCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			repository: repository,
			compare: compare,
		});
	}
	if (showIn === 'graph' || showIn === 'inspect') {
		return createTerminalLinkCommand<CompareWithCommandArgs>('gitlens.compareWith', {
			repoPath: repoPath,
			ref1: right,
			ref2: left,
		});
	}
	return createTerminalLinkCommand<GitWizardCommandArgs>('gitlens.gitCommands', {
		command: 'log',
		state: {
			repo: repoPath,
			reference: createReference(range, repoPath, { refType: 'revision' }),
		},
	});
}

export class GitTerminalLinkProvider implements Disposable, TerminalLinkProvider<GitTerminalLink> {
	private disposable: Disposable;

	constructor(private readonly container: Container) {
		this.disposable = window.registerTerminalLinkProvider(this);
	}

	dispose(): void {
		this.disposable.dispose();
	}

	async provideTerminalLinks(context: TerminalLinkContext, token: CancellationToken): Promise<GitTerminalLink[]> {
		if (context.line.trim().length === 0) return [];

		const repoPath = this.container.git.highlander?.path;
		if (!repoPath) return [];

		const showIn = configuration.get('terminalLinks.showIn');

		const links: GitTerminalLink[] = [];

		let branchResults: PagedResult<GitBranch> | undefined;
		let tagResults: PagedResult<GitTag> | undefined;

		const svc = this.container.git.getRepositoryService(repoPath);

		// Resolves a range side to its ref kind, or undefined if it isn't a known ref (so file paths like
		// `a/../b` don't link). Cheap: HEAD/shas need no git call; branch/tag lists are fetched lazily and
		// shared with the ref pass below. Strips any `~N`/`^` navigation suffix before matching.
		const rangeSideRefType = async (side: string): Promise<'branch' | 'tag' | 'commit' | undefined> => {
			const base = side.replace(/[~^].*$/, '');
			if (!base) return undefined;
			if (base.toUpperCase() === 'HEAD' || shaRegex.test(base)) return 'commit';
			// TODO@eamodio handle paging
			branchResults ??= await svc.branches.getBranches(undefined, toAbortSignal(token)).catch(() => undefined);
			if (branchResults?.values.some(r => r.name === base || getBranchNameWithoutRemote(r.name) === base)) {
				return 'branch';
			}
			// TODO@eamodio handle paging
			tagResults ??= await svc.tags.getTags(undefined, toAbortSignal(token)).catch(() => undefined);
			return tagResults?.values.some(r => r.name === base) ? 'tag' : undefined;
		};

		// Don't use the shared regex instances directly, because we can be called reentrantly (because of the awaits below)
		const refRegex = new RegExp(refRegexShared, refRegexShared.flags);
		const commandsRegex = new RegExp(commandsRegexShared, commandsRegexShared.flags);
		const rangesRegex = new RegExp(rangesRegexShared, rangesRegexShared.flags);

		// Detect commit ranges first: `refRegex` can't match them (it rejects `..`), and collecting
		// their spans lets us suppress the trailing-sha ref match inside a range (links can't overlap).
		const rangeSpans: [number, number][] = [];
		const repository = showIn === 'graph' ? this.container.git.getRepository(repoPath) : undefined;
		let rangeMatch;
		while (true) {
			if (token.isCancellationRequested) return links;

			rangeMatch = rangesRegex.exec(context.line);
			if (rangeMatch == null) break;

			const [range, left, , right] = rangeMatch;
			// Only link ranges whose BOTH sides resolve to a ref (branch/tag/HEAD/sha) — skips file paths.
			const leftRefType = await rangeSideRefType(left);
			if (leftRefType == null) continue;
			const rightRefType = await rangeSideRefType(right);
			if (rightRefType == null) continue;

			links.push({
				startIndex: rangeMatch.index,
				length: range.length,
				tooltip: showIn === 'quickpick' ? 'Show Commits' : 'Show Comparison',
				command: createRangeLinkCommand(
					showIn,
					repoPath,
					range,
					left,
					right,
					repository,
					leftRefType,
					rightRefType,
				),
			});
			rangeSpans.push([rangeMatch.index, rangeMatch.index + range.length]);
		}

		let match;
		do {
			if (token.isCancellationRequested) break;

			match = commandsRegex.exec(context.line);
			if (match != null) {
				const [_, git, command] = match;

				const link: GitTerminalLink<GitWizardCommandArgs> = {
					startIndex: match.index + git.length,
					length: command.length,
					tooltip: 'Open in Git Command Palette',
					command: createTerminalLinkCommand<GitWizardCommandArgs>('gitlens.gitCommands', {
						command: command as GitWizardCommandArgs['command'],
					}),
				};
				links.push(link);
			}

			match = refRegex.exec(context.line);
			if (match == null) break;

			const [, ref] = match;
			const index = match.index;

			// Skip a ref that falls inside a detected range (its trailing sha) — already linked above.
			if (rangeSpans.some(([start, end]) => index >= start && index < end)) continue;

			if (ref.toUpperCase() === 'HEAD') {
				links.push({
					startIndex: index,
					length: ref.length,
					tooltip: 'Show HEAD',
					command: createRefLinkCommand(
						showIn,
						repoPath,
						createReference('HEAD', repoPath, { refType: 'revision' }),
						'HEAD',
						{ branch: 'HEAD', repoPath: repoPath },
					),
				});

				continue;
			}

			// TODO@eamodio handle paging
			branchResults ??= await svc.branches.getBranches(undefined, toAbortSignal(token)).catch(() => undefined);
			if (token.isCancellationRequested) break;

			let branch = branchResults?.values.find(r => r.name === ref);
			branch ??= branchResults?.values.find(r => getBranchNameWithoutRemote(r.name) === ref);
			if (branch != null) {
				links.push({
					startIndex: index,
					length: ref.length,
					tooltip: 'Show Branch',
					command: createRefLinkCommand(showIn, repoPath, getReferenceFromBranch(branch), branch.sha, {
						repoPath: repoPath,
						branch: branch.name,
					}),
				});

				continue;
			}

			// TODO@eamodio handle paging
			tagResults ??= await svc.tags.getTags(undefined, toAbortSignal(token)).catch(() => undefined);
			if (token.isCancellationRequested) break;

			const tag = tagResults?.values.find(r => r.name === ref);
			if (tag != null) {
				links.push({
					startIndex: index,
					length: ref.length,
					tooltip: 'Show Tag',
					command: createRefLinkCommand(showIn, repoPath, getReferenceFromTag(tag), tag.sha, {
						repoPath: repoPath,
						tag: tag.name,
					}),
				});

				continue;
			}

			if (!shaRegex.test(ref)) continue;

			if (await svc.refs.isValidReference(ref, undefined, toAbortSignal(token)).catch(() => false)) {
				links.push({
					startIndex: index,
					length: ref.length,
					tooltip: 'Show Commit',
					command: createCommitLinkCommand(showIn, repoPath, ref),
				});
			}
		} while (true);

		return links;
	}

	handleTerminalLink(link: GitTerminalLink): void {
		void commands.executeCommand(link.command.command, link.command.args);
	}
}
