'use strict';
import { Iterables } from '../system';
import { commands, QuickPickItem, QuickPickOptions, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import * as moment from 'moment';

class CommitQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string;

    constructor(public commit: GitCommit) {
        this.label = `${commit.author}, ${moment(commit.date).fromNow()}`;
        this.description = `\u2022 ${commit.sha}`;
        this.detail = commit.message;
    }
}

export default class ShowQuickFileHistoryCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = GitUri.fromUri(uri);

        try {
            const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath);
            if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

            const items = Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c));
            const commitPick = await window.showQuickPick(Array.from(items), <QuickPickOptions>{
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (commitPick) {
                return commands.executeCommand(Commands.DiffWithWorking, commitPick.commit.uri, commitPick.commit);
            }
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}