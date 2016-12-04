'use strict';
import { Iterables } from '../system';
import { commands, QuickPickOptions, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommitQuickPickItem, CompareQuickPickItem } from './quickPickItems';
import * as moment from 'moment';

export default class ShowQuickFileHistoryCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = GitUri.fromUri(uri, this.git);

        try {
            const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath);
            if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

            const items = Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c));
            const commitPick = await window.showQuickPick(Array.from(items), <QuickPickOptions>{
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: Iterables.first(log.commits.values()).fileName
            });

            if (commitPick) {
                const commit = commitPick.commit;

                let command: Commands | undefined = Commands.DiffWithWorking;
                if (commit.previousSha) {
                    const items: CompareQuickPickItem[] = [
                        {
                            label: `Compare with Working Tree`,
                            description: `\u2022 ${commit.sha}  $(git-compare)  ${commit.fileName}`,
                            detail: null,
                            command: Commands.DiffWithWorking
                        },
                        {
                            label: `Compare with Previous Commit`,
                            description: `\u2022 ${commit.previousSha}  $(git-compare)  ${commit.sha}`,
                            detail: null,
                            command: Commands.DiffWithPrevious
                        }
                    ];

                    const comparePick = await window.showQuickPick(items, <QuickPickOptions>{
                        matchOnDescription: true,
                        placeHolder: `${commit.fileName} \u2022 ${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()}`
                    });

                    command = comparePick ? comparePick.command : undefined;
                }

                if (command) {
                    return commands.executeCommand(command, commit.uri, commit);
                }
            }
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}