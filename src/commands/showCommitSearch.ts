'use strict';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRepoSearchBy, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, CommitsQuickPick, ShowCommitsSearchInResultsQuickPickItem } from '../quickpicks';
import { Iterables, Strings } from '../system';
import {
    ActiveEditorCachedCommand,
    command,
    CommandContext,
    Commands,
    getCommandUri,
    getRepoPathOrActiveOrPrompt,
    isCommandViewContextWithRepo
} from './common';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

const searchByRegex = /^([@~=:#])/;
const symbolToSearchByMap = new Map<string, GitRepoSearchBy>([
    ['@', GitRepoSearchBy.Author],
    ['~', GitRepoSearchBy.ChangedLines],
    ['=', GitRepoSearchBy.Changes],
    [':', GitRepoSearchBy.Files],
    ['#', GitRepoSearchBy.Sha]
]);

const searchByToSymbolMap = new Map<GitRepoSearchBy, string>([
    [GitRepoSearchBy.Author, '@'],
    [GitRepoSearchBy.ChangedLines, '~'],
    [GitRepoSearchBy.Changes, '='],
    [GitRepoSearchBy.Files, ':'],
    [GitRepoSearchBy.Sha, '#']
]);

export interface ShowCommitSearchCommandArgs {
    search?: string;
    searchBy?: GitRepoSearchBy;
    maxCount?: number;
    showInResults?: boolean;

    goBackCommand?: CommandQuickPickItem;
}

@command()
export class ShowCommitSearchCommand extends ActiveEditorCachedCommand {
    constructor() {
        super(Commands.ShowCommitSearch);
    }

    protected async preExecute(context: CommandContext, args: ShowCommitSearchCommandArgs = {}) {
        if (context.type === 'view' || context.type === 'viewItem') {
            args = { ...args };
            args.showInResults = true;

            if (isCommandViewContextWithRepo(context)) {
                return this.execute(context.editor, context.node.uri, args);
            }
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowCommitSearchCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && (await GitUri.fromUri(uri));

        const repoPath = await getRepoPathOrActiveOrPrompt(
            gitUri,
            editor,
            `Search for commits in which repository${GlyphChars.Ellipsis}`,
            args.goBackCommand
        );
        if (!repoPath) return undefined;

        args = { ...args };
        const originalArgs = { ...args };

        if (!args.search || args.searchBy == null) {
            let selection;
            if (!args.search && args.searchBy != null) {
                args.search = searchByToSymbolMap.get(args.searchBy);
                selection = [1, 1];
            }

            args.search = await window.showInputBox({
                value: args.search,
                prompt: `Please enter a search string`,
                placeHolder: `search by message, author (@<pattern>), files (:<pattern>), commit id (#<sha>), changes (=<pattern>), changed lines (~<pattern>)`,
                valueSelection: selection
            } as InputBoxOptions);
            if (args.search === undefined) {
                return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
            }

            originalArgs.search = args.search;

            const match = searchByRegex.exec(args.search);
            if (match && match[1]) {
                args.searchBy = symbolToSearchByMap.get(match[1]);
                args.search = args.search.substring(args.search[1] === ' ' ? 2 : 1);
            }
            else if (GitService.isShaLike(args.search)) {
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

            case GitRepoSearchBy.ChangedLines:
                searchLabel = `commits with changed lines matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Changes:
                searchLabel = `commits with changes matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Files:
                searchLabel = `commits with files matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Message:
                searchLabel = args.search ? `commits with a message matching '${args.search}'` : 'all commits';
                break;

            case GitRepoSearchBy.Sha:
                searchLabel = `commits with an id matching '${args.search}'`;
                break;
        }

        if (args.showInResults) {
            Container.resultsView.addSearchResults(
                repoPath,
                Container.git.getLogForSearch(repoPath, args.search!, args.searchBy!, {
                    maxCount: args.maxCount
                }),
                { label: searchLabel! }
            );

            return;
        }

        const progressCancellation = CommitsQuickPick.showProgress(searchLabel!);
        try {
            const log = await Container.git.getLogForSearch(repoPath, args.search, args.searchBy, {
                maxCount: args.maxCount
            });

            if (progressCancellation.token.isCancellationRequested) return undefined;

            let goBackCommand: CommandQuickPickItem | undefined =
                args.goBackCommand ||
                new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to commit search`
                    },
                    Commands.ShowCommitSearch,
                    [uri, originalArgs]
                );

            let commit;
            if (args.searchBy !== GitRepoSearchBy.Sha || log === undefined || log.count !== 1) {
                const pick = await CommitsQuickPick.show(log, searchLabel!, progressCancellation, {
                    goBackCommand: goBackCommand,
                    showAllCommand:
                        log !== undefined && log.truncated
                            ? new CommandQuickPickItem(
                                  {
                                      label: `$(sync) Show All Commits`,
                                      description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                                  },
                                  Commands.ShowCommitSearch,
                                  [uri, { ...args, maxCount: 0, goBackCommand: goBackCommand }]
                              )
                            : undefined,
                    showInResultsCommand:
                        log !== undefined ? new ShowCommitsSearchInResultsQuickPickItem(log, searchLabel!) : undefined
                });
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                commit = pick.commit;
                goBackCommand = undefined;
            }
            else {
                commit = Iterables.first(log.commits.values());
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, commit.toGitUri(), {
                sha: commit.sha,
                commit: commit,
                goBackCommand:
                    goBackCommand ||
                    new CommandQuickPickItem(
                        {
                            label: `go back ${GlyphChars.ArrowBack}`,
                            description: `${Strings.pad(GlyphChars.Dash, 2, 2)} to search for ${searchLabel}`
                        },
                        Commands.ShowCommitSearch,
                        [uri, args]
                    )
            } as ShowQuickCommitDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowCommitSearchCommand');
            return Messages.showGenericErrorMessage('Unable to find commits');
        }
        finally {
            progressCancellation.cancel();
        }
    }
}
