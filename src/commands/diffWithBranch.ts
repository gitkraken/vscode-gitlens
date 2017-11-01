'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { DiffWithCommandArgs } from './diffWith';
import { GitService, GitUri } from '../gitService';
import { Messages } from '../messages';
import { BranchesQuickPick, CommandQuickPickItem } from '../quickPicks';
import * as path from 'path';

export interface DiffWithBranchCommandArgs {
    line?: number;
    showOptions?: TextDocumentShowOptions;

    goBackCommand?: CommandQuickPickItem;
}

export class DiffWithBranchCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
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

        let renamedUri: Uri | undefined;
        let renamedTitle: string | undefined;

        // Check to see if this file has been renamed
        const statuses = await this.git.getDiffStatus(gitUri.repoPath, 'HEAD', branch, { filter: 'R' });
        if (statuses !== undefined) {
            const fileName = GitService.normalizePath(path.relative(gitUri.repoPath, gitUri.fsPath));
            const rename = statuses.find(s => s.fileName === fileName);
            if (rename !== undefined && rename.originalFileName !== undefined) {
                renamedUri = Uri.file(path.join(gitUri.repoPath, rename.originalFileName));
                renamedTitle = `${path.basename(rename.originalFileName)} (${branch})`;
            }
        }

        const diffArgs: DiffWithCommandArgs = {
            repoPath: gitUri.repoPath,
            lhs: {
                sha: pick.branch.remote ? `remotes/${branch}` : branch,
                uri: renamedUri || gitUri as Uri,
                title: renamedTitle || `${path.basename(gitUri.fsPath)} (${branch})`
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