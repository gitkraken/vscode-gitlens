import type { Disposable, TerminalLink, TerminalLinkContext, TerminalLinkProvider } from 'vscode';
import { commands, window } from 'vscode';
import type { GitWizardCommandArgs } from '../commands/gitWizard';
import type { InspectCommandArgs } from '../commands/inspect';
import type { ShowQuickBranchHistoryCommandArgs } from '../commands/showQuickBranchHistory';
import type { ShowQuickCommitCommandArgs } from '../commands/showQuickCommit';
import type { Commands } from '../constants.commands';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import type { PagedResult } from '../git/gitProvider';
import type { GitBranch } from '../git/models/branch';
import { getBranchNameWithoutRemote } from '../git/models/branch.utils';
import { createReference } from '../git/models/reference.utils';
import type { GitTag } from '../git/models/tag';
import { configuration } from '../system/vscode/configuration';

const commandsRegexShared =
	/\b(g(?:it)?\b\s*)\b(branch|checkout|cherry-pick|fetch|grep|log|merge|pull|push|rebase|reset|revert|show|stash|status|tag)\b/gi;
// Since negative lookbehind isn't supported in all browsers, leave out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// eslint-disable-next-line no-control-regex
const refRegexShared = /\b((?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ,~^:?*[\\]+[^ ./])\b/gi;
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

		const showDetailsView = configuration.get('terminalLinks.showDetailsView');

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

				const link: GitTerminalLink<GitWizardCommandArgs> = {
					startIndex: match.index + git.length,
					length: command.length,
					tooltip: 'Open in Git Command Palette',
					command: {
						command: GlCommand.GitCommands,
						args: {
							command: command as GitWizardCommandArgs['command'],
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
					tooltip: 'Show HEAD',
					command: {
						command: GlCommand.ShowQuickBranchHistory,
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

			let branch = branchResults.values.find(r => r.name === ref);
			if (branch == null) {
				branch = branchResults.values.find(r => getBranchNameWithoutRemote(r.name) === ref);
			}
			if (branch != null) {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show Branch',
					command: {
						command: GlCommand.ShowQuickBranchHistory,
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
					tooltip: 'Show Tag',
					command: {
						command: GlCommand.ShowQuickBranchHistory,
						args: { repoPath: repoPath, tag: tag.name },
					},
				};
				links.push(link);

				continue;
			}

			if (!shaRegex.test(ref)) {
				if (rangeRegex.test(ref)) {
					const link: GitTerminalLink<GitWizardCommandArgs> = {
						startIndex: match.index,
						length: ref.length,
						tooltip: 'Show Commits',
						command: {
							command: GlCommand.GitCommands,
							args: {
								command: 'log',
								state: {
									repo: repoPath,
									reference: createReference(ref, repoPath, { refType: 'revision' }),
								},
							},
						},
					};
					links.push(link);
				}

				continue;
			}

			if (await this.container.git.validateReference(repoPath, ref)) {
				const link: GitTerminalLink<ShowQuickCommitCommandArgs | InspectCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show Commit',
					command: showDetailsView
						? {
								command: GlCommand.ShowInDetailsView,
								args: {
									ref: createReference(ref, repoPath, { refType: 'revision' }),
								},
						  }
						: {
								command: GlCommand.ShowQuickCommit,
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
