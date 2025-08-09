import type { CancellationToken, Disposable, TerminalLink, TerminalLinkContext, TerminalLinkProvider } from 'vscode';
import { commands, window } from 'vscode';
import type { GitWizardCommandArgs } from '../commands/gitWizard';
import type { InspectCommandArgs } from '../commands/inspect';
import type { ShowQuickBranchHistoryCommandArgs } from '../commands/showQuickBranchHistory';
import type { ShowQuickCommitCommandArgs } from '../commands/showQuickCommit';
import type { GlCommands } from '../constants.commands';
import type { Container } from '../container';
import type { PagedResult } from '../git/gitProvider';
import type { GitBranch } from '../git/models/branch';
import type { GitTag } from '../git/models/tag';
import { getBranchNameWithoutRemote } from '../git/utils/branch.utils';
import { createReference } from '../git/utils/reference.utils';
import { createTerminalLinkCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';

const commandsRegexShared =
	/\b(g(?:it)?\b\s*)\b(branch|checkout|cherry-pick|fetch|grep|log|merge|pull|push|rebase|reset|revert|show|stash|status|tag)\b/gi;
// Since negative lookbehind isn't supported in all browsers, leave out the negative lookbehind condition `(?<!\.lock)` to ensure the branch name doesn't end with `.lock`
// eslint-disable-next-line no-control-regex
const refRegexShared = /\b((?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ,~^:?*[\\]+[^ ./])\b/gi;
const rangeRegex = /^[0-9a-f]{7,40}\.\.\.?[0-9a-f]{7,40}$/;
const shaRegex = /^[0-9a-f]{7,40}$/;

interface GitTerminalLink<T = object> extends TerminalLink {
	command: {
		command: GlCommands;
		args: T;
	};
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

		const showDetailsView = configuration.get('terminalLinks.showDetailsView');

		const links: GitTerminalLink[] = [];

		let branchResults: PagedResult<GitBranch> | undefined;
		let tagResults: PagedResult<GitTag> | undefined;

		// Don't use the shared regex instance directly, because we can be called reentrantly (because of the awaits below)
		const refRegex = new RegExp(refRegexShared, refRegexShared.flags);
		const commandsRegex = new RegExp(commandsRegexShared, commandsRegexShared.flags);

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

			if (ref.toUpperCase() === 'HEAD') {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show HEAD',
					command: createTerminalLinkCommand<ShowQuickBranchHistoryCommandArgs>(
						'gitlens.showQuickBranchHistory',
						{
							branch: 'HEAD',
							repoPath: repoPath,
						},
					),
				};
				links.push(link);

				continue;
			}

			const svc = this.container.git.getRepositoryService(repoPath);
			// TODO@eamodio handle paging
			branchResults ??= await svc.branches.getBranches(undefined, token).catch(() => undefined);
			if (token.isCancellationRequested) break;

			let branch = branchResults?.values.find(r => r.name === ref);
			branch ??= branchResults?.values.find(r => getBranchNameWithoutRemote(r.name) === ref);
			if (branch != null) {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show Branch',
					command: createTerminalLinkCommand<ShowQuickBranchHistoryCommandArgs>(
						'gitlens.showQuickBranchHistory',
						{ repoPath: repoPath, branch: branch.name },
					),
				};
				links.push(link);

				continue;
			}

			// TODO@eamodio handle paging
			tagResults ??= await svc.tags.getTags(undefined, token).catch(() => undefined);
			if (token.isCancellationRequested) break;

			const tag = tagResults?.values.find(r => r.name === ref);
			if (tag != null) {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show Tag',
					command: createTerminalLinkCommand<ShowQuickBranchHistoryCommandArgs>(
						'gitlens.showQuickBranchHistory',
						{ repoPath: repoPath, tag: tag.name },
					),
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
						command: createTerminalLinkCommand<GitWizardCommandArgs>('gitlens.gitCommands', {
							command: 'log',
							state: {
								repo: repoPath,
								reference: createReference(ref, repoPath, { refType: 'revision' }),
							},
						}),
					};
					links.push(link);
				}

				continue;
			}

			if (await svc.refs.isValidReference(ref, undefined, token).catch(() => false)) {
				const link: GitTerminalLink<ShowQuickCommitCommandArgs | InspectCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show Commit',
					command: showDetailsView
						? createTerminalLinkCommand<InspectCommandArgs>('gitlens.showInDetailsView', {
								ref: createReference(ref, repoPath, { refType: 'revision' }),
							})
						: createTerminalLinkCommand<ShowQuickCommitCommandArgs>('gitlens.showQuickCommitDetails', {
								repoPath: repoPath,
								sha: ref,
							}),
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
