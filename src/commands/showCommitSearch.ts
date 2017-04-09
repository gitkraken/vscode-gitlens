'use strict';
import { commands, InputBoxOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './common';
import { Git, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitsQuickPick } from '../quickPicks';

export class ShowCommitSearchCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowCommitSearch);
    }

    async execute(editor: TextEditor, uri?: Uri, search?: string, searchBy?: undefined | 'author' | 'files' | 'message' | 'sha', goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        if (!search || searchBy == null) {
            search = await window.showInputBox({
                value: search,
                prompt: `Please enter a search string`,
                placeHolder: `search by message, author (use a:<name>), files (use f:<pattern>), or sha (use s:<hash>)`
            } as InputBoxOptions);
            if (!search) return undefined;

            if (Git.isSha(search)) {
                searchBy = 'sha';
            }
            else if (search.startsWith('a:')) {
                searchBy = 'author';
                search = search.substring((search[2] === ' ') ? 3 : 2);
            }
            else if (search.startsWith('f:')) {
                searchBy = 'files';
                search = search.substring((search[2] === ' ') ? 3 : 2);
            }
            else if (search.startsWith('s:')) {
                searchBy = 'sha';
                search = search.substring((search[2] === ' ') ? 3 : 2);
            }
            else {
                searchBy = 'message';
            }
        }

        try {
            const log = await this.git.getLogForRepoSearch(gitUri.repoPath, search, searchBy);

            let originalSearch: string;
            let placeHolder: string;
            switch (searchBy) {
                case 'author':
                    originalSearch = `a:${search}`;
                    placeHolder = `commits with author matching '${search}'`;
                    break;
                case 'files':
                    originalSearch = `f:${search}`;
                    placeHolder = `commits with files matching '${search}'`;
                    break;
                case 'message':
                    originalSearch = search;
                    placeHolder = `commits with message matching '${search}'`;
                    break;
                case 'sha':
                    originalSearch = `s:${search}`;
                    placeHolder = `commits with sha matching '${search}'`;
                    break;
            }

            if (!goBackCommand) {
                // Create a command to get back to the branch history
                goBackCommand = new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to commit search`
                }, Commands.ShowCommitSearch, [gitUri, originalSearch]);
            }

            const pick = await CommitsQuickPick.show(this.git, log, placeHolder, goBackCommand);
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