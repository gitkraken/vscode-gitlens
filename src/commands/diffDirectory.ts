'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitProvider } from '../gitProvider';
import { Logger } from '../logger';

export class DiffDirectoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.DiffDirectory);
    }

    async execute(editor: TextEditor, uri?: Uri, shaOrBranch1?: string, shaOrBranch2?: string): Promise<any> {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri, this.repoPath);
            if (!repoPath) return window.showWarningMessage(`Unable to open directory diff`);

            if (!shaOrBranch1) {
                //window.showQuickPick()
                return undefined;
            }

            this.git.openDirectoryDiff(repoPath, shaOrBranch1, shaOrBranch2);
            return undefined;
        }
        catch (ex) {
            Logger.error('GitLens.DiffDirectoryCommand', ex);
            return window.showErrorMessage(`Unable to open directory diff. See output channel for more details`);
        }
    }
}