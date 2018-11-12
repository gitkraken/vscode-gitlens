'use strict';
import * as paths from 'path';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithBranchCommandArgs {
    line?: number;
    showOptions?: TextDocumentShowOptions;

    goBackCommand?: CommandQuickPickItem;
}

@command()
export class DiffWithBranchCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.DiffWithBranch);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithBranchCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        const gitUri = await GitUri.fromUri(uri);
        if (!gitUri.repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open file compare`);

        const pick = await new BranchesAndTagsQuickPick(gitUri.repoPath).show(
            `Compare ${paths.basename(gitUri.fsPath)} with${GlyphChars.Ellipsis}`,
            {
                allowCommitId: true,
                goBack: args.goBackCommand
            }
        );
        if (pick === undefined) return undefined;

        if (pick instanceof CommandQuickPickItem) return pick.execute();

        const ref = pick.ref;
        if (ref === undefined) return undefined;

        let renamedUri: Uri | undefined;
        let renamedTitle: string | undefined;

        // Check to see if this file has been renamed
        const files = await Container.git.getDiffStatus(gitUri.repoPath, 'HEAD', ref, { filter: 'R' });
        if (files !== undefined) {
            const fileName = Strings.normalizePath(paths.relative(gitUri.repoPath, gitUri.fsPath));
            const rename = files.find(s => s.fileName === fileName);
            if (rename !== undefined && rename.originalFileName !== undefined) {
                renamedUri = Uri.file(paths.join(gitUri.repoPath, rename.originalFileName));
                renamedTitle = `${paths.basename(rename.originalFileName)} (${ref})`;
            }
        }

        const diffArgs: DiffWithCommandArgs = {
            repoPath: gitUri.repoPath,
            lhs: {
                sha: pick.remote ? `remotes/${ref}` : ref,
                uri: renamedUri || (gitUri as Uri),
                title: renamedTitle || `${paths.basename(gitUri.fsPath)} (${ref})`
            },
            rhs: {
                sha: '',
                uri: gitUri as Uri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}
