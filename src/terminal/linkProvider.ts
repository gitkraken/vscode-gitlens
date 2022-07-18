import type { Disposable, TerminalLink, TerminalLinkContext, TerminalLinkProvider } from 'vscode';
import { commands, window } from 'vscode';
import * as nls from 'vscode-nls';
import type {
	GitCommandsCommandArgs,
	ShowQuickBranchHistoryCommandArgs,
	ShowQuickCommitCommandArgs,
} from '../commands';
import { Commands } from '../constants';
import type { Container } from '../container';
import type { PagedResult } from '../git/gitProvider';
import type { GitBranch } from '../git/models/branch';
import { GitReference } from '../git/models/reference';
import type { GitTag } from '../git/models/tag';

const localize = nls.loadMessageBundle();
const commandsRegexShared =
	/\b(g(?:it)?\b\s*)\b(branch|checkout|cherry-pick|fetch|grep|log|merge|pull|push|rebase|reset|revert|show|stash|status|tag)\b/gi;
// Since negative lookbehind isn't supported in all browsers, leave out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
const refRegexShared = /\b((?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\000-\037\177 ~^:?*[\\]+[^./])\b/gi;
const rangeRegex = /^[0-9a-f]{7,40}\.\.\.?[0-9a-f]{7,40}$/;
const shaRegex = /^[0-9a-f]{7,40}$/;

interface GitTerminalLink<T = object> extends TerminalLink {
	command: {
		command: Commands;
		args: T;
	};
}

export class GitTerminalLinkProvider implements Disposable, TerminalLinkProvider<GitTerminalLink> {
	private disposable: Disposable;

	constructor(private readonly container: Container) {
		this.disposable = window.registerTerminalLinkProvider(this);
	}

	dispose() {
		this.disposable.dispose();
	}

	async provideTerminalLinks(context: TerminalLinkContext): Promise<GitTerminalLink[]> {
		if (context.line.trim().length === 0) return [];

		const repoPath = this.container.git.highlander?.path;
		if (!repoPath) return [];

		const links: GitTerminalLink[] = [];

		let branchResults: PagedResult<GitBranch> | undefined;
		let tagResults: PagedResult<GitTag> | undefined;

		// Don't use the shared regex instance directly, because we can be called reentrantly (because of the awaits below)
		const refRegex = new RegExp(refRegexShared, refRegexShared.flags);
		const commandsRegex = new RegExp(commandsRegexShared, commandsRegexShared.flags);

		let match;
		do {
			match = commandsRegex.exec(context.line);
			if (match != null) {
				const [_, git, command] = match;

				const link: GitTerminalLink<GitCommandsCommandArgs> = {
					startIndex: match.index + git.length,
					length: command.length,
					tooltip: localize('openInGitCommandPalette', 'Open in Git Command Palette'),
					command: {
						command: Commands.GitCommands,
						args: {
							command: command as GitCommandsCommandArgs['command'],
						},
					},
				};
				links.push(link);
			}

			match = refRegex.exec(context.line);
			if (match == null) break;

			const [_, ref] = match;

			if (ref.toUpperCase() === 'HEAD') {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: localize('showHead', 'Show HEAD'),
					command: {
						command: Commands.ShowQuickBranchHistory,
						args: {
							branch: 'HEAD',
							repoPath: repoPath,
						},
					},
				};
				links.push(link);

				continue;
			}

			if (branchResults === undefined) {
				branchResults = await this.container.git.getBranches(repoPath);
				// TODO@eamodio handle paging
			}

			const branch = branchResults.values.find(r => r.name === ref);
			if (branch != null) {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: localize('showBranch', 'Show Branch'),
					command: {
						command: Commands.ShowQuickBranchHistory,
						args: { repoPath: repoPath, branch: branch.name },
					},
				};
				links.push(link);

				continue;
			}

			if (tagResults === undefined) {
				tagResults = await this.container.git.getTags(repoPath);
				// TODO@eamodio handle paging
			}

			const tag = tagResults.values.find(r => r.name === ref);
			if (tag != null) {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: localize('showTag', 'Show Tag'),
					command: {
						command: Commands.ShowQuickBranchHistory,
						args: { repoPath: repoPath, tag: tag.name },
					},
				};
				links.push(link);

				continue;
			}

			if (!shaRegex.test(ref)) {
				if (rangeRegex.test(ref)) {
					const link: GitTerminalLink<GitCommandsCommandArgs> = {
						startIndex: match.index,
						length: ref.length,
						tooltip: localize('showCommits', 'Show Commits'),
						command: {
							command: Commands.GitCommands,
							args: {
								command: 'log',
								state: {
									repo: repoPath,
									reference: GitReference.create(ref, repoPath, { refType: 'revision' }),
								},
							},
						},
					};
					links.push(link);
				}

				continue;
			}

			if (await this.container.git.validateReference(repoPath, ref)) {
				const link: GitTerminalLink<ShowQuickCommitCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: localize('showCommit', 'Show Commit'),
					command: {
						command: Commands.ShowQuickCommit,
						args: {
							repoPath: repoPath,
							sha: ref,
						},
					},
				};
				links.push(link);
			}
		} while (true);

		return links;
	}

	handleTerminalLink(link: GitTerminalLink): void {
		void commands.executeCommand(link.command.command, link.command.args);
	}
}
