'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri } from './common';
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

    async run(context: CommandContext, args: DiffWithBranchCommandArgs = {}): Promise<any> {
        // Since we can change the args and they could be cached -- make a copy
        switch (context.type) {
            case 'uri':
                return this.execute(context.editor, context.uri, { ...args });
            case 'scm-states':
                const resource = context.scmResourceStates[0];
                return this.execute(undefined, resource.resourceUri, { ...args });
            case 'scm-groups':
                return undefined;
            default:
                return this.execute(context.editor, undefined, { ...args });
        }
    }

    async execute(editor: TextEditor | undefined, uri?: Uri, args: DiffWithBranchCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

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

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(compare),
                gitUri.fileUri(),
                `${path.basename(gitUri.fsPath)} (${branch}) ${GlyphChars.ArrowLeftRight} ${path.basename(gitUri.fsPath)}`,
                args.showOptions);

            if (args.line === undefined || args.line === 0) return undefined;

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithBranchCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open branch compare. See output channel for more details`);
        }
    }
}