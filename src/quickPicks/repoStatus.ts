'use strict';
import { Iterables, Strings } from '../system';
import { commands, QuickPickOptions, TextDocumentShowOptions, Uri, window } from 'vscode';
import { Commands, DiffWithWorkingCommandArgs, OpenChangedFilesCommandArgs, ShowQuickBranchHistoryCommandArgs, ShowQuickRepoStatusCommandArgs, ShowQuickStashListCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFileCommandQuickPickItem, QuickPickItem } from './common';
import { GlyphChars } from '../constants';
import { GitService, GitStatus, GitStatusFile, GitUri } from '../gitService';
import { Keyboard, Keys } from '../keyboard';
import * as path from 'path';

export class OpenStatusFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(
        status: GitStatusFile,
        item?: QuickPickItem
    ) {
        const octicon = status.getOcticon();
        const description = status.getFormattedDirectory(true);

        super(status.Uri, item || {
            label: `${status.staged ? '$(check)' : GlyphChars.Space.repeat(3)}${Strings.pad(octicon, 2, 2)} ${path.basename(status.fileName)}`,
            description: description
        });
    }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        return commands.executeCommand(Commands.DiffWithWorking,
            this.uri,
            {
                showOptions: {
                    preserveFocus: true,
                    preview: false
                } as TextDocumentShowOptions
            } as DiffWithWorkingCommandArgs) as Promise<{} | undefined>;
    }
}

export class OpenStatusFilesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(
        statuses: GitStatusFile[],
        item?: QuickPickItem
    ) {
        const uris = statuses.map(f => f.Uri);

        super(item || {
            label: `$(file-symlink-file) Open Changed Files`,
            description: ''
            // detail: `Opens all of the changed files in the repository`
        }, Commands.OpenChangedFiles, [
                undefined,
                {
                    uris
                } as OpenChangedFilesCommandArgs
            ]);
    }
}

interface ComputedStatus {
    staged: number;
    stagedAddsAndChanges: GitStatusFile[];
    stagedStatus: string;

    unstaged: number;
    unstagedAddsAndChanges: GitStatusFile[];
    unstagedStatus: string;
}

export class RepoStatusQuickPick {

    private static computeStatus(files: GitStatusFile[]): ComputedStatus {
        let stagedAdds = 0;
        let unstagedAdds = 0;
        let stagedChanges = 0;
        let unstagedChanges = 0;
        let stagedDeletes = 0;
        let unstagedDeletes = 0;

        const stagedAddsAndChanges: GitStatusFile[] = [];
        const unstagedAddsAndChanges: GitStatusFile[] = [];

        for (const f of files) {
            switch (f.status) {
                case 'A':
                case '?':
                    if (f.staged) {
                        stagedAdds++;
                        stagedAddsAndChanges.push(f);
                    }
                    else {
                        unstagedAdds++;
                        unstagedAddsAndChanges.push(f);
                    }
                    break;

                case 'D':
                    if (f.staged) {
                        stagedDeletes++;
                    }
                    else {
                        unstagedDeletes++;
                    }
                    break;

                default:
                    if (f.staged) {
                        stagedChanges++;
                        stagedAddsAndChanges.push(f);
                    }
                    else {
                        unstagedChanges++;
                        unstagedAddsAndChanges.push(f);
                    }
                    break;
            }
        }

        const staged = stagedAdds + stagedChanges + stagedDeletes;
        const unstaged = unstagedAdds + unstagedChanges + unstagedDeletes;

        return {
            staged: staged,
            stagedStatus: staged > 0 ? `+${stagedAdds} ~${stagedChanges} -${stagedDeletes}` : '',
            stagedAddsAndChanges: stagedAddsAndChanges,
            unstaged: unstaged,
            unstagedStatus: unstaged > 0 ? `+${unstagedAdds} ~${unstagedChanges} -${unstagedDeletes}` : '',
            unstagedAddsAndChanges: unstagedAddsAndChanges
        };
    }

    static async show(status: GitStatus, goBackCommand?: CommandQuickPickItem): Promise<OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem | undefined> {
        // Sort the status by staged and then filename
        const files = status.files;
        files.sort((a, b) => (a.staged ? -1 : 1) - (b.staged ? -1 : 1) || a.fileName.localeCompare(b.fileName));

        const items = [...Iterables.map(files, s => new OpenStatusFileCommandQuickPickItem(s))] as (OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem)[];

        const currentCommand = new CommandQuickPickItem({
            label: `go back ${GlyphChars.ArrowBack}`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to ${GlyphChars.Space}$(git-branch) ${status.branch} status`
        }, Commands.ShowQuickRepoStatus, [
                undefined,
                {
                    goBackCommand
                } as ShowQuickRepoStatusCommandArgs
            ]);

        const computed = this.computeStatus(files);
        if (computed.staged > 0) {
            let index = 0;
            const unstagedIndex = computed.unstaged > 0 ? files.findIndex(f => !f.staged) : -1;
            if (unstagedIndex > -1) {
                items.splice(unstagedIndex, 0, new CommandQuickPickItem({
                    label: `Unstaged Files`,
                    description: computed.unstagedStatus
                }, Commands.ShowQuickRepoStatus, [
                        undefined,
                        {
                            goBackCommand
                        } as ShowQuickRepoStatusCommandArgs
                    ]));

                items.splice(unstagedIndex, 0, new OpenStatusFilesCommandQuickPickItem(computed.stagedAddsAndChanges, {
                    label: `${GlyphChars.Space.repeat(4)} $(file-symlink-file) Open Staged Files`,
                    description: ''
                }));

                items.push(new OpenStatusFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
                    label: `${GlyphChars.Space.repeat(4)} $(file-symlink-file) Open Unstaged Files`,
                    description: ''
                }));
            }

            items.splice(index++, 0, new CommandQuickPickItem({
                label: `Staged Files`,
                description: computed.stagedStatus
            }, Commands.ShowQuickRepoStatus, [
                    undefined,
                    {
                        goBackCommand
                    } as ShowQuickRepoStatusCommandArgs
                ]));
        }
        else if (files.some(f => !f.staged)) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `Unstaged Files`,
                description: computed.unstagedStatus
            }, Commands.ShowQuickRepoStatus, [
                    undefined,
                    {
                        goBackCommand
                    } as ShowQuickRepoStatusCommandArgs
                ]));
        }

        if (files.length) {
            items.push(new OpenStatusFilesCommandQuickPickItem(computed.stagedAddsAndChanges.concat(computed.unstagedAddsAndChanges)));
            items.push(new CommandQuickPickItem({
                label: '$(x) Close Unchanged Files',
                description: ''
            }, Commands.CloseUnchangedFiles));
        }
        else {
            items.push(new CommandQuickPickItem({
                label: `No changes in the working tree`,
                description: ''
            }, Commands.ShowQuickRepoStatus, [
                    undefined,
                    {
                        goBackCommand
                    } as ShowQuickRepoStatusCommandArgs
                ]));
        }

        items.splice(0, 0, new CommandQuickPickItem({
            label: `$(inbox) Show Stashed Changes`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows stashed changes in the repository`
        }, Commands.ShowQuickStashList, [
                new GitUri(Uri.file(status.repoPath), { fileName: '', repoPath: status.repoPath }),
                {
                    goBackCommand: currentCommand
                } as ShowQuickStashListCommandArgs
            ]));

        if (status.upstream && status.state.ahead) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(cloud-upload)${GlyphChars.Space} ${status.state.ahead} Commit${status.state.ahead > 1 ? 's' : ''} ahead of ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows commits in ${GlyphChars.Space}$(git-branch) ${status.branch} but not ${GlyphChars.Space}$(git-branch) ${status.upstream}`
            }, Commands.ShowQuickBranchHistory, [
                    new GitUri(Uri.file(status.repoPath), { fileName: '', repoPath: status.repoPath, sha: `${status.upstream}..${status.branch}` }),
                    {
                        branch: status.branch,
                        maxCount: 0,
                        goBackCommand: currentCommand
                    } as ShowQuickBranchHistoryCommandArgs
                ]));
        }

        if (status.upstream && status.state.behind) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(cloud-download)${GlyphChars.Space} ${status.state.behind} Commit${status.state.behind > 1 ? 's' : ''} behind ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows commits in ${GlyphChars.Space}$(git-branch) ${status.upstream} but not ${GlyphChars.Space}$(git-branch) ${status.branch}${status.sha ? ` (since ${GlyphChars.Space}$(git-commit) ${GitService.shortenSha(status.sha)})` : ''}`
            }, Commands.ShowQuickBranchHistory, [
                    new GitUri(Uri.file(status.repoPath), { fileName: '', repoPath: status.repoPath, sha: `${status.branch}..${status.upstream}` }),
                    {
                        branch: status.upstream,
                        maxCount: 0,
                        goBackCommand: currentCommand
                    } as ShowQuickBranchHistoryCommandArgs
                ]));
        }

        if (status.upstream && !status.state.ahead && !status.state.behind) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(git-branch) ${status.branch} is up-to-date with ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
                description: ''
            }, Commands.ShowQuickRepoStatus, [
                    undefined,
                    {
                        goBackCommand
                    } as ShowQuickRepoStatusCommandArgs
                ]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `status of ${status.branch}${status.upstream ? ` ${Strings.pad(GlyphChars.ArrowLeftRight, 1, 1)} ${status.upstream}` : ''}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}