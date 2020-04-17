'use strict';
import { commands, Disposable, TerminalLink, TerminalLinkContext, TerminalLinkProvider, window } from 'vscode';
import { Commands, ShowQuickBranchHistoryCommandArgs, ShowQuickCommitCommandArgs } from '../commands';
import { Container } from '../container';

const shaRegex = /^[0-9a-f]{7,40}$/;
const refRegex = /\b((?!\S*\/\.)(?!\S*\.\.)(?!\/)(?!\S*\/\/)(?!\S*@\{)(?!@$)(?!\S*\\)[^\000-\037\177 ~^:?*[]+(?<!\.lock)(?<!\/)(?<!\.))\b/gi;

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

		const branchesAndTags = await Container.git.getBranchesAndOrTags(repoPath, { include: 'all' });

		// Don't use the shared regex instance directly, because we can be called reentrantly (because of the awaits below)
		const regex = new RegExp(refRegex, 'gi');

		let match;
		do {
			match = regex.exec(context.line);
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

			if (!shaRegex.test(ref)) continue;

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
