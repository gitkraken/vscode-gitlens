'use strict';
import { commands, SourceControlResourceState, Uri, window } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Arrays } from '../system';
import { Command, CommandContext, Commands, getRepoPathOrActiveOrPrompt } from './common';

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
    ) {}
}

export interface ExternalDiffCommandArgs {
    files?: ExternalDiffFile[];
}

export class ExternalDiffCommand extends Command {
    constructor() {
        super(Commands.ExternalDiff);
    }

    protected async preExecute(context: CommandContext, args: ExternalDiffCommandArgs = {}): Promise<any> {
        if (context.type === 'scm-states') {
            args = { ...args };
            args.files = context.scmResourceStates.map(
                r => new ExternalDiffFile(r.resourceUri, (r as Resource).resourceGroupType === ResourceGroupType.Index)
            );

            return this.execute(args);
        }
        else if (context.type === 'scm-groups') {
            args = { ...args };
            args.files = Arrays.filterMap(
                context.scmResourceGroups[0].resourceStates,
                r =>
                    this.isModified(r)
                        ? new ExternalDiffFile(
                              r.resourceUri,
                              (r as Resource).resourceGroupType === ResourceGroupType.Index
                          )
                        : undefined
            );

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
            const repoPath = await getRepoPathOrActiveOrPrompt(
                undefined,
                undefined,
                `Open changes from which repository${GlyphChars.Ellipsis}`
            );
            if (!repoPath) return undefined;

            const tool = await Container.git.getDiffTool(repoPath);
            if (tool === undefined) {
                const result = await window.showWarningMessage(
                    `Unable to open changes in diff tool because there is no Git diff tool configured`,
                    'View Git Docs'
                );
                if (!result) return undefined;

                return commands.executeCommand(
                    BuiltInCommands.Open,
                    Uri.parse('https://git-scm.com/docs/git-config#git-config-difftool')
                );
            }

            if (args.files === undefined) {
                const status = await Container.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to open changes in diff tool`);

                args.files = [];

                for (const file of status.files) {
                    if (file.indexStatus === 'M') {
                        args.files.push(new ExternalDiffFile(file.uri, true));
                    }

                    if (file.workTreeStatus === 'M') {
                        args.files.push(new ExternalDiffFile(file.uri, false));
                    }
                }
            }

            for (const file of args.files) {
                Container.git.openDiffTool(repoPath, file.uri, file.staged, tool);
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ExternalDiffCommand');
            return window.showErrorMessage(`Unable to open changes in diff tool. See output channel for more details`);
        }
    }
}
