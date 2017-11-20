'use strict';
import { Strings } from '../system';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { GitRepoSearchBy, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, CommitsQuickPick } from '../quickPicks';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

const searchByRegex = /^([@~=:#])/;
const searchByMap = new Map<string, GitRepoSearchBy>([
    ['@', GitRepoSearchBy.Author],
    ['~', GitRepoSearchBy.Changes],
    ['=', GitRepoSearchBy.ChangesOccurrences],
    [':', GitRepoSearchBy.Files],
    ['#', GitRepoSearchBy.Sha]
]);

export interface ShowCommitSearchCommandArgs {
    search?: string;
    searchBy?: GitRepoSearchBy;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowCommitSearchCommand extends ActiveEditorCachedCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.ShowCommitSearch);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowCommitSearchCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri === undefined ? undefined : await GitUri.fromUri(uri, this.git);

        const repoPath = gitUri === undefined ? this.git.getHighlanderRepoPath() : gitUri.repoPath;
        if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to show commit search`);

        args = { ...args };
        if (!args.search || args.searchBy == null) {
            try {
                if (!args.search) {
                    if (editor !== undefined && gitUri !== undefined) {
                        const blameLine = await this.git.getBlameForLine(gitUri, editor.selection.active.line);
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
                placeHolder: `search by message, author (use @<name>), files (use :<pattern>), or commit id (use #<sha>)`
            } as InputBoxOptions);
            if (args.search === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();

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

        let originalSearch: string | undefined = undefined;
        let placeHolder: string | undefined = undefined;
        switch (args.searchBy) {
            case GitRepoSearchBy.Author:
                originalSearch = `@${args.search}`;
                placeHolder = `commits with author matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Changes:
                originalSearch = `~${args.search}`;
                placeHolder = `commits with changes matching '${args.search}'`;
                break;

            case GitRepoSearchBy.ChangesOccurrences:
                originalSearch = `=${args.search}`;
                placeHolder = `commits with changes (new occurrences) matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Files:
                originalSearch = `:${args.search}`;
                placeHolder = `commits with files matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Message:
                originalSearch = args.search;
                placeHolder = `commits with message matching '${args.search}'`;
                break;

            case GitRepoSearchBy.Sha:
                originalSearch = `#${args.search}`;
                placeHolder = `commits with id matching '${args.search}'`;
                break;
        }

        const progressCancellation = CommitsQuickPick.showProgress(placeHolder!);
        try {
            const log = await this.git.getLogForRepoSearch(repoPath, args.search, args.searchBy);
            if (log === undefined) return undefined;

            if (progressCancellation.token.isCancellationRequested) return undefined;

            // Create a command to get back to here
            const currentCommand = new CommandQuickPickItem({
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to commit search`
            }, Commands.ShowCommitSearch, [
                    uri,
                    {
                        search: originalSearch,
                        goBackCommand: args.goBackCommand
                    } as ShowCommitSearchCommandArgs
                ]);

            const pick = await CommitsQuickPick.show(this.git, log, placeHolder!, progressCancellation, currentCommand);
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                new GitUri(pick.commit.uri, pick.commit),
                {
                    sha: pick.commit.sha,
                    commit: pick.commit,
                    goBackCommand: new CommandQuickPickItem({
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 2)} to search for ${placeHolder}`
                    }, Commands.ShowCommitSearch, [
                            uri,
                            args
                        ])
                } as ShowQuickCommitDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowCommitSearchCommand');
            return window.showErrorMessage(`Unable to find commits. See output channel for more details`);
        }
    }
}