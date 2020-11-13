'use strict';
import { commands, Disposable, TerminalLink, TerminalLinkContext, TerminalLinkProvider, window } from 'vscode';
import {
	Commands,
	GitCommandsCommandArgs,
	ShowQuickBranchHistoryCommandArgs,
	ShowQuickCommitCommandArgs,
} from '../commands';
import { Container } from '../container';
import { GitReference } from '../git/git';

const commandsRegexShared = /\b(g(?:it)?\b\s*)\b(branch|checkout|cherry-pick|fetch|grep|log|merge|pull|push|rebase|reset|revert|show|stash|status|tag)\b/gi;
const refRegexShared = /\b((?!\/)(?!\S*\/\/)(?!\S*@\{)(?!@$)(?!\S*\\)[^\000-\037\177 ~^:?*[]+(?<!\.lock)(?<!\/)(?<!\.))\b/gi;
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

	constructor() {
		this.disposable = window.registerTerminalLinkProvider(this);
	}

	dispose() {
		this.disposable.dispose();
	}

	async provideTerminalLinks(context: TerminalLinkContext): Promise<GitTerminalLink[]> {
		if (context.line.trim().length === 0) return [];

		const repoPath = Container.git.getHighlanderRepoPath();
		if (repoPath == null) return [];

		const links: GitTerminalLink[] = [];

		const branchesAndTags = await Container.git.getBranchesAndOrTags(repoPath);

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
					tooltip: 'Open in Git Command Palette',
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
					tooltip: 'Show HEAD',
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

			const branchOrTag = branchesAndTags?.find(r => r.name === ref);
			if (branchOrTag != null) {
				const link: GitTerminalLink<ShowQuickBranchHistoryCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: branchOrTag.refType === 'branch' ? 'Show Branch' : 'Show Tag',
					command: {
						command: Commands.ShowQuickBranchHistory,
						args: {
							branch: branchOrTag.refType === 'branch' ? branchOrTag.name : undefined,
							tag: branchOrTag.refType === 'tag' ? branchOrTag.name : undefined,
							repoPath: repoPath,
						},
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
						tooltip: 'Show Commits',
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

			if (await Container.git.validateReference(repoPath, ref)) {
				const link: GitTerminalLink<ShowQuickCommitCommandArgs> = {
					startIndex: match.index,
					length: ref.length,
					tooltip: 'Show Commit',
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
