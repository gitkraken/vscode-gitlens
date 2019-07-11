'use strict';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitRepoSearchBy, GitService } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, CommitsQuickPick, ShowCommitSearchResultsInViewQuickPickItem } from '../quickpicks';
import { Iterables } from '../system';
import { SearchResultsCommitsNode } from '../views/nodes';
import {
    ActiveEditorCachedCommand,
    command,
    CommandContext,
    Commands,
    getCommandUri,
    getRepoPathOrPrompt,
    isCommandViewContextWithRepo
} from './common';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

const searchByRegex = /^([@~:#])/;
const symbolToSearchByMap = new Map<string, GitRepoSearchBy>([
    ['@', GitRepoSearchBy.Author],
    ['~', GitRepoSearchBy.Changes],
    [':', GitRepoSearchBy.Files],
    ['#', GitRepoSearchBy.Sha]
]);

const searchByToSymbolMap = new Map<GitRepoSearchBy, string>([
    [GitRepoSearchBy.Author, '@'],
    [GitRepoSearchBy.Changes, '~'],
    [GitRepoSearchBy.Files, ':'],
    [GitRepoSearchBy.Sha, '#']
]);

export interface SearchCommitsCommandArgs {
    search?: string;
    searchBy?: GitRepoSearchBy;
    prefillOnly?: boolean;
    repoPath?: string;
    showInView?: boolean;

    goBackCommand?: CommandQuickPickItem;
}

@command()
export class SearchCommitsCommand extends ActiveEditorCachedCommand {
    private _lastSearch: string | undefined;

    constructor() {
        super([Commands.SearchCommits, Commands.SearchCommitsInView]);
    }

    protected preExecute(context: CommandContext, args: SearchCommitsCommandArgs = {}) {
        if (context.type === 'viewItem') {
            args = { ...args };
            args.showInView = true;

            if (context.node instanceof SearchResultsCommitsNode) {
                args.search = context.node.search;
                args.searchBy = context.node.searchBy;
                args.prefillOnly = true;
            }

            if (isCommandViewContextWithRepo(context)) {
                args.repoPath = context.node.repo.path;
                return this.execute(context.editor, context.node.uri, args);
            }
        }
        else if (context.command === Commands.SearchCommitsInView) {
            args = { ...args };
            args.showInView = true;
        }
        else {
            // TODO: Add a user setting (default to view?)
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: SearchCommitsCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const repoPath =
            args.repoPath ||
            (await getRepoPathOrPrompt(
                `Search for commits in which repository${GlyphChars.Ellipsis}`,
                args.goBackCommand
            ));
        if (!repoPath) return undefined;

        args = { ...args };
        const originalArgs = { ...args };

        if (args.prefillOnly && args.search && args.searchBy) {
            args.search = `${searchByToSymbolMap.get(args.searchBy) || ''}${args.search}`;
            args.searchBy = undefined;
        }

        if (!args.search || args.searchBy == null) {
            let selection: [number, number] | undefined;
            if (!args.search) {
                if (args.searchBy != null) {
                    args.search = searchByToSymbolMap.get(args.searchBy);
                    selection = [1, 1];
                }
                else {
                    args.search = this._lastSearch;
                }
            }

            if (args.showInView) {
                await Container.searchView.show();
            }

            const repo = await Container.git.getRepository(repoPath);

            const opts: InputBoxOptions = {
                value: args.search,
                prompt: 'Please enter a search string',
                placeHolder: `Search${
                    repo === undefined ? '' : ` ${repo.formattedName}`
                } for commits by message, author (@<pattern>), files (:<path/glob>), commit id (#<sha>), or changes (~<pattern>)`,
                valueSelection: selection
            };
            args.search = await window.showInputBox(opts);
            if (args.search === undefined) {
                return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
            }

            this._lastSearch = originalArgs.search = args.search;

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

        if (args.showInView) {
            void Container.searchView.search(repoPath, args.search, args.searchBy, {
                label: { label: searchLabel! }
            });

            return undefined;
        }

        const progressCancellation = CommitsQuickPick.showProgress(searchLabel!);
        try {
            const log = await Container.git.getLogForSearch(repoPath, args.search, args.searchBy);

            if (progressCancellation.token.isCancellationRequested) return undefined;

            let goBackCommand: CommandQuickPickItem | undefined =
                args.goBackCommand ||
                new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: 'to commit search'
                    },
                    Commands.SearchCommits,
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
                                      label: '$(sync) Show All Commits',
                                      description: 'this may take a while'
                                  },
                                  Commands.SearchCommits,
                                  [uri, { ...args, maxCount: 0, goBackCommand: goBackCommand }]
                              )
                            : undefined,
                    showInViewCommand:
                        log !== undefined
                            ? new ShowCommitSearchResultsInViewQuickPickItem(args.search, args.searchBy, log, {
                                  label: searchLabel!
                              })
                            : undefined
                });
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                commit = pick.item;
                goBackCommand = undefined;
            }
            else {
                commit = Iterables.first(log.commits.values());
            }

            const commandArgs: ShowQuickCommitDetailsCommandArgs = {
                sha: commit.sha,
                commit: commit,
                goBackCommand:
                    goBackCommand ||
                    new CommandQuickPickItem(
                        {
                            label: `go back ${GlyphChars.ArrowBack}`,
                            description: `to search for ${searchLabel}`
                        },
                        Commands.SearchCommits,
                        [uri, args]
                    )
            };
            return commands.executeCommand(Commands.ShowQuickCommitDetails, commit.toGitUri(), commandArgs);
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
