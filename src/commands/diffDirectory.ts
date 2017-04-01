'use strict';
import { Iterables } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { BuiltInCommands } from '../constants';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, BranchesQuickPick } from '../quickPicks';

export class DiffDirectoryCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffDirectory);
    }

    async execute(editor: TextEditor, uri?: Uri, shaOrBranch1?: string, shaOrBranch2?: string): Promise<any> {
        const diffTool = await this.git.getConfig('diff.tool');
        if (!diffTool) {
            const result = await window.showWarningMessage(`Unable to open directory compare because there is no Git diff tool configured`, 'View Git Docs');
            if (!result) return undefined;
            return commands.executeCommand(BuiltInCommands.Open, Uri.parse('https://git-scm.com/docs/git-config#git-config-difftool'));
        }

        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri);
            if (!repoPath) return window.showWarningMessage(`Unable to open directory compare`);

            if (!shaOrBranch1) {
                const branches = await this.git.getBranches(repoPath);
                const current = Iterables.find(branches, _ => _.current);

                const pick = await BranchesQuickPick.show(branches, `Compare ${current.name} to \u2026`);
                if (!pick) return undefined;

                if (pick instanceof CommandQuickPickItem) {
                    return pick.execute();
                }

                shaOrBranch1 = pick.branch.name;
                if (!shaOrBranch1) return undefined;
            }

            this.git.openDirectoryDiff(repoPath, shaOrBranch1, shaOrBranch2);
            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'DiffDirectoryCommand');
            return window.showErrorMessage(`Unable to open directory compare. See output channel for more details`);
        }
    }
}