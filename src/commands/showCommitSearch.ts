'use strict';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './common';
import { Git, GitRepoSearchBy, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitsQuickPick } from '../quickPicks';

const searchByRegex = /^([@:#])/;
const searchByMap = new Map<string, GitRepoSearchBy>([
    ['@', GitRepoSearchBy.Author],
    [':', GitRepoSearchBy.Files],
    ['#', GitRepoSearchBy.Sha]
]);

export class ShowCommitSearchCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowCommitSearch);
    }

    async execute(editor: TextEditor, uri?: Uri, search?: string, searchBy?: GitRepoSearchBy, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        if (!search || searchBy == null) {
            search = await window.showInputBox({
                value: search,
                prompt: `Please enter a search string`,
                placeHolder: `search by message, author (use @<name>), files (use :<pattern>), or commit id (use #<sha>)`
            } as InputBoxOptions);
            if (search === undefined) return goBackCommand && goBackCommand.execute();

            const match = searchByRegex.exec(search);
            if (match && match[1]) {
                searchBy = searchByMap.get(match[1]);
                search = search.substring((search[1] === ' ') ? 2 : 1);
            }
            else if (Git.isSha(search)) {
                searchBy = GitRepoSearchBy.Sha;
            }
            else {
                searchBy = GitRepoSearchBy.Message;
            }
        }

        try {
            const log = await this.git.getLogForRepoSearch(gitUri.repoPath, search, searchBy);

            let originalSearch: string;
            let placeHolder: string;
            switch (searchBy) {
                case GitRepoSearchBy.Author:
                    originalSearch = `@${search}`;
                    placeHolder = `commits with author matching '${search}'`;
                    break;
                case GitRepoSearchBy.Files:
                    originalSearch = `:${search}`;
                    placeHolder = `commits with files matching '${search}'`;
                    break;
                case GitRepoSearchBy.Message:
                    originalSearch = search;
                    placeHolder = `commits with message matching '${search}'`;
                    break;
                case GitRepoSearchBy.Sha:
                    originalSearch = `#${search}`;
                    placeHolder = `commits with id matching '${search}'`;
                    break;
            }

            // Create a command to get back to here
            const currentCommand = new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: `\u00a0 \u2014 \u00a0\u00a0 to commit search`
            }, Commands.ShowCommitSearch, [gitUri, originalSearch, undefined, goBackCommand]);

            const pick = await CommitsQuickPick.show(this.git, log, placeHolder, currentCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to search for ${placeHolder}`
                }, Commands.ShowCommitSearch, [gitUri, search, searchBy, goBackCommand]));
        }
        catch (ex) {
            Logger.error(ex, 'ShowCommitSearchCommand');
            return window.showErrorMessage(`Unable to find commits. See output channel for more details`);
        }
    }
}