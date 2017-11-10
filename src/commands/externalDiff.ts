'use strict';
import { Arrays } from '../system';
import { commands, SourceControlResourceState, Uri, window } from 'vscode';
import { Command, Commands } from './common';
import { BuiltInCommands } from '../constants';
import { CommandContext } from '../commands';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

enum Status {
    INDEX_MODIFIED,
    INDEX_ADDED,
    INDEX_DELETED,
    INDEX_RENAMED,
    INDEX_COPIED,

    MODIFIED,
    DELETED,
    UNTRACKED,
    IGNORED,

    ADDED_BY_US,
    ADDED_BY_THEM,
    DELETED_BY_US,
    DELETED_BY_THEM,
    BOTH_ADDED,
    BOTH_DELETED,
    BOTH_MODIFIED
}

enum ResourceGroupType {
    Merge,
    Index,
    WorkingTree
}

interface Resource extends SourceControlResourceState {
    readonly resourceGroupType: ResourceGroupType;
    readonly type: Status;
}

class ExternalDiffFile {

    constructor(
        public readonly uri: Uri,
        public readonly staged: boolean
    ) { }
}

export interface ExternalDiffCommandArgs {
    files?: ExternalDiffFile[];
}

export class ExternalDiffCommand extends Command {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.ExternalDiff);
    }

    protected async preExecute(context: CommandContext, args: ExternalDiffCommandArgs = {}): Promise<any> {
        if (context.type === 'scm-states') {
            args = { ...args };
            args.files = context.scmResourceStates
                .map(r => new ExternalDiffFile(r.resourceUri, (r as Resource).resourceGroupType === ResourceGroupType.Index));

            return this.execute(args);
        }
        else if (context.type === 'scm-groups') {
            args = { ...args };
            args.files = Arrays.filterMap(context.scmResourceGroups[0].resourceStates,
                r => this.isModified(r) ? new ExternalDiffFile(r.resourceUri, (r as Resource).resourceGroupType === ResourceGroupType.Index) : undefined);

            return this.execute(args);
        }

        return this.execute(args);
    }

    private isModified(resource: SourceControlResourceState) {
        const status = (resource as Resource).type;
        return status === Status.BOTH_MODIFIED || status === Status.INDEX_MODIFIED || status === Status.MODIFIED;
    }

    async execute(args: ExternalDiffCommandArgs = {}) {
        try {
            const repoPath = await this.git.getRepoPath(undefined);
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open changed files`);

            const tool = await this.git.getDiffTool(repoPath);
            if (tool === undefined) {
                const result = await window.showWarningMessage(`Unable to open file compare because there is no Git diff tool configured`, 'View Git Docs');
                if (!result) return undefined;

                return commands.executeCommand(BuiltInCommands.Open, Uri.parse('https://git-scm.com/docs/git-config#git-config-difftool'));
            }

            if (args.files === undefined) {
                const status = await this.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to open changed files`);

                args.files = [];

                for (const file of status.files) {
                    if (file.indexStatus === 'M') {
                        args.files.push(new ExternalDiffFile(file.Uri, true));
                    }

                    if (file.workTreeStatus === 'M') {
                        args.files.push(new ExternalDiffFile(file.Uri, false));
                    }
                }
            }

            for (const file of args.files) {
                this.git.openDiffTool(repoPath, file.uri, file.staged, tool);
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ExternalDiffCommand');
            return window.showErrorMessage(`Unable to open external diff. See output channel for more details`);
        }
    }
}