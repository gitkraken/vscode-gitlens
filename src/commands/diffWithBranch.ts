'use strict';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { BuiltInCommands, GlyphChars } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesQuickPick, CommandQuickPickItem } from '../quickPicks';
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

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithBranchCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);
        if (!gitUri.repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open branch compare`);

        const branches = await this.git.getBranches(gitUri.repoPath);
        const pick = await BranchesQuickPick.show(branches, `Compare ${path.basename(gitUri.fsPath)} to ${GlyphChars.Ellipsis}`, args.goBackCommand);
        if (pick === undefined) return undefined;

        if (pick instanceof CommandQuickPickItem) return pick.execute();

        const branch = pick.branch.name;
        if (branch === undefined) return undefined;

        try {
            const compare = await this.git.getVersionedFile(gitUri.repoPath, gitUri.fsPath, branch);

            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(compare),
                gitUri.fileUri(),
                `${path.basename(gitUri.fsPath)} (${branch}) ${GlyphChars.ArrowLeftRight} ${path.basename(gitUri.fsPath)}`,
                args.showOptions);
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithBranchCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open branch compare. See output channel for more details`);
        }
    }
}