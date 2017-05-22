'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { BuiltInCommands } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, BranchesQuickPick } from '../quickPicks';
import * as path from 'path';

export interface DiffWithBranchCommandArgs {
    line?: number;
    showOptions?: TextDocumentShowOptions;

    goBackCommand?: CommandQuickPickItem;
}

export class DiffWithBranchCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithBranch);
    }

    async execute(editor: TextEditor, uri?: Uri, args: DiffWithBranchCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args.line = args.line || (editor === undefined ? 0 : editor.selection.active.line);

        const gitUri = await GitUri.fromUri(uri, this.git);
        if (!gitUri.repoPath) return window.showWarningMessage(`Unable to open branch compare`);

        const branches = await this.git.getBranches(gitUri.repoPath);
        const pick = await BranchesQuickPick.show(branches, `Compare ${path.basename(gitUri.fsPath)} to \u2026`, args.goBackCommand);
        if (pick === undefined) return undefined;

        if (pick instanceof CommandQuickPickItem) return pick.execute();

        const branch = pick.branch.name;
        if (branch === undefined) return undefined;

        try {
            const compare = await this.git.getVersionedFile(gitUri.repoPath, gitUri.fsPath, branch);

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(compare),
                gitUri.fileUri(),
                `${path.basename(gitUri.fsPath)} (${branch}) \u2194 ${path.basename(gitUri.fsPath)}`,
                args.showOptions);

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithBranchCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open branch compare. See output channel for more details`);
        }
    }
}