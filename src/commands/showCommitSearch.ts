'use strict';
import { Strings } from '../system';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRepoSearchBy, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitsQuickPick, RepositoriesQuickPick, ShowCommitsSearchInResultsQuickPickItem } from '../quickPicks';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

const searchByRegex = /^([@~=:#])/;
const searchByMap = new Map<string, GitRepoSearchBy>([
    ['@', GitRepoSearchBy.Author],
    ['~', GitRepoSearchBy.Changes],
    ['=', GitRepoSearchBy.ChangedOccurrences],
    [':', GitRepoSearchBy.Files],
    ['#', GitRepoSearchBy.Sha]
]);

export interface ShowCommitSearchCommandArgs {
    search?: string;
    searchBy?: GitRepoSearchBy;
    maxCount?: number;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowCommitSearchCommand extends ActiveEditorCachedCommand {

    constructor() {
        super(Commands.ShowCommitSearch);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowCommitSearchCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri === undefined ? undefined : await GitUri.fromUri(uri);

        let repoPath = gitUri === undefined ? Container.git.getHighlanderRepoPath() : gitUri.repoPath;
        if (!repoPath) {
            const pick = await RepositoriesQuickPick.show(`Search for commits in which repository${GlyphChars.Ellipsis}`, args.goBackCommand);
            if (pick instanceof CommandQuickPickItem) return pick.execute();
            if (pick === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();

            repoPath = pick.repoPath;
        }

        args = { ...args };
        const originalArgs = { ...args };

        if (!args.search || args.searchBy == null) {
            try {
                if (!args.search) {
                    if (editor !== undefined && gitUri !== undefined) {
                        const blameLine = await Container.git.getBlameForLine(gitUri, editor.selection.active.line);
                        if (blameLine !== undefined && !blameLine.commit.isUncommitted) {
                            args.search = `#${blameLine.commit.shortSha}`;
                        }
                    }
                }
            }
            catch (ex) {
                Logger.error(ex, 'ShowCommitSearchCommand', 'search prefetch failed');
            }

            args.search = await window.showInputBox({
                value: args.search,
                prompt: `Please enter a search string`,
                placeHolder: `search by message, author (@<pattern>), files (:<pattern>), commit id (#<sha>), changes (~<pattern>), or changed occurrences (=<string>)`
            } as InputBoxOptions);
            if (args.search === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();

            originalArgs.search = args.search;

            const match = searchByRegex.exec(args.search);
            if (match && match[1]) {
                args.searchBy = searchByMap.get(match[1]);
                args.search = args.search.substring((args.search[1] === ' ') ? 2 : 1);
            }
            else if (GitService.isSha(args.search)) {
                args.searchBy = GitRepoSearchBy.Sha;
            }
            else {
                args.searchBy = GitRepoSearchBy.Message;
            }
        }

        if (args.searchBy === undefined) {
            args.searchBy = GitRepoSearchBy.Message;
        }

        let searchLabel: string | undefined = undefined;
        switch (args.searchBy) {
            case GitRepoSearchBy.Author:
                searchLabel = `commits with an author matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Changes:
                searchLabel = `commits with changes matching '${args.search}'`;
                break;

            case GitRepoSearchBy.ChangedOccurrences:
                searchLabel = `commits with changed occurrences matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Files:
                searchLabel = `commits with files matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Message:
                searchLabel = `commits with a message matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Sha:
                searchLabel = `commits with an id matching '${args.search}'`;
                break;
        }

        const progressCancellation = CommitsQuickPick.showProgress(searchLabel!);
        try {
            const log = await Container.git.getLogForSearch(repoPath, args.search, args.searchBy, { maxCount: args.maxCount });

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const goBackCommand = args.goBackCommand || new CommandQuickPickItem({
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to commit search`
            }, Commands.ShowCommitSearch, [uri, originalArgs]);

            const pick = await CommitsQuickPick.show(log, searchLabel!, progressCancellation, {
                goBackCommand: goBackCommand,
                showAllCommand: log !== undefined && log.truncated
                    ? new CommandQuickPickItem({
                        label: `$(sync) Show All Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                    }, Commands.ShowCommitSearch, [uri, { ...args, maxCount: 0, goBackCommand: goBackCommand }])
                    : undefined,
                showInResultsExplorerCommand: log !== undefined
                    ? new ShowCommitsSearchInResultsQuickPickItem(log, searchLabel!)
                    : undefined
            });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                pick.commit.toGitUri(),
                {
                    sha: pick.commit.sha,
                    commit: pick.commit,
                    goBackCommand: new CommandQuickPickItem({
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 2)} to search for ${searchLabel}`
                    }, Commands.ShowCommitSearch, [ uri, args ])
                } as ShowQuickCommitDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowCommitSearchCommand');
            return window.showErrorMessage(`Unable to find commits. See output channel for more details`);
        }
        finally {
            progressCancellation.dispose();
        }
    }
}