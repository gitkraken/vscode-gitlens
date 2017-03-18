'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { BuiltInCommands } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, BranchesQuickPick } from '../quickPicks';
import * as path from 'path';

export class DiffWithBranchCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithBranch);
    }

    async execute(editor: TextEditor, uri?: Uri, goBackCommand?: CommandQuickPickItem): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const line = (editor && editor.selection.active.line) || 0;

        const gitUri = await GitUri.fromUri(uri, this.git);

        const branches = await this.git.getBranches(gitUri.repoPath);
        const pick = await BranchesQuickPick.show(branches, `Compare ${path.basename(gitUri.fsPath)} to \u2026`, goBackCommand);
        if (!pick) return undefined;

        if (pick instanceof CommandQuickPickItem) {
            return pick.execute();
        }

        const branch = pick.branch.name;
        if (!branch) return undefined;

        try {
            const compare = await this.git.getVersionedFile(gitUri.repoPath, gitUri.fsPath, branch);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), gitUri.fileUri(), `${path.basename(gitUri.fsPath)} (${branch}) ↔ ${path.basename(gitUri.fsPath)}`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithBranchCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}