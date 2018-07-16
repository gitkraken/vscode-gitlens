'use strict';
import * as path from 'path';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithBranchCommandArgs {
    line?: number;
    showOptions?: TextDocumentShowOptions;

    goBackCommand?: CommandQuickPickItem;
}

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

        const placeHolder = `Compare ${path.basename(gitUri.fsPath)} with${GlyphChars.Ellipsis}`;
        const progressCancellation = BranchesAndTagsQuickPick.showProgress(placeHolder);

        try {
            const [branches, tags] = await Promise.all([
                Container.git.getBranches(gitUri.repoPath),
                Container.git.getTags(gitUri.repoPath)
            ]);

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await BranchesAndTagsQuickPick.show(branches, tags, placeHolder, {
                progressCancellation: progressCancellation,
                goBackCommand: args.goBackCommand
            });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            const ref = pick.name;
            if (ref === undefined) return undefined;

            let renamedUri: Uri | undefined;
            let renamedTitle: string | undefined;

            // Check to see if this file has been renamed
            const statuses = await Container.git.getDiffStatus(gitUri.repoPath, 'HEAD', ref, { filter: 'R' });
            if (statuses !== undefined) {
                const fileName = Strings.normalizePath(path.relative(gitUri.repoPath, gitUri.fsPath));
                const rename = statuses.find(s => s.fileName === fileName);
                if (rename !== undefined && rename.originalFileName !== undefined) {
                    renamedUri = Uri.file(path.join(gitUri.repoPath, rename.originalFileName));
                    renamedTitle = `${path.basename(rename.originalFileName)} (${ref})`;
                }
            }

            const diffArgs: DiffWithCommandArgs = {
                repoPath: gitUri.repoPath,
                lhs: {
                    sha: pick.remote ? `remotes/${ref}` : ref,
                    uri: renamedUri || (gitUri as Uri),
                    title: renamedTitle || `${path.basename(gitUri.fsPath)} (${ref})`
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
        finally {
            progressCancellation.cancel();
        }
    }
}
