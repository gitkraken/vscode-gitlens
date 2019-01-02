'use strict';
import * as paths from 'path';
import { commands, Disposable, InputBoxOptions, Terminal, TextDocumentShowOptions, Uri, window } from 'vscode';
import {
    Commands,
    DiffWithCommandArgs,
    DiffWithCommandArgsRevision,
    DiffWithPreviousCommandArgs,
    DiffWithWorkingCommandArgs,
    openEditor,
    OpenFileInRemoteCommandArgs,
    OpenFileRevisionCommandArgs,
    openWorkspace
} from '../commands';
import { BuiltInCommands, CommandContext, extensionTerminalName, setCommandContext } from '../constants';
import { Container } from '../container';
import { toGitLensFSUri } from '../git/fsProvider';
import { GitService, GitUri } from '../git/gitService';
import { Arrays } from '../system';
import {
    BranchNode,
    BranchTrackingStatusNode,
    canDismissNode,
    CommitFileNode,
    CommitNode,
    RemoteNode,
    RepositoryNode,
    ResultsFileNode,
    StashFileNode,
    StashNode,
    StatusFileNode,
    TagNode,
    ViewNode,
    ViewRefNode
} from './nodes';

export interface RefreshNodeCommandArgs {
    maxCount?: number;
}

interface ICompareSelected {
    ref: string;
    repoPath: string | undefined;
    uri?: Uri;
}

export class ViewCommands implements Disposable {
    private _disposable: Disposable | undefined;
    private _terminal: Terminal | undefined;
    private _terminalCwd: string | undefined;

    constructor() {
        commands.registerCommand(
            'gitlens.views.refreshNode',
            (node: ViewNode, reset?: boolean, args?: RefreshNodeCommandArgs) =>
                node.view.refreshNode(node, reset === undefined ? true : reset, args),
            this
        );
        commands.registerCommand(
            'gitlens.views.expandNode',
            (node: ViewNode) => node.view.reveal(node, { select: false, focus: false, expand: 3 }),
            this
        );
        commands.registerCommand(
            'gitlens.views.dismissNode',
            (node: ViewNode) => canDismissNode(node.view) && node.view.dismissNode(node),
            this
        );

        commands.registerCommand('gitlens.views.fetch', this.fetch, this);
        commands.registerCommand('gitlens.views.pull', this.pull, this);
        commands.registerCommand('gitlens.views.push', this.push, this);
        commands.registerCommand('gitlens.views.pushWithForce', n => this.push(n, true), this);
        commands.registerCommand('gitlens.views.closeRepository', this.closeRepository, this);

        commands.registerCommand('gitlens.views.star', this.star, this);
        commands.registerCommand('gitlens.views.unstar', this.unstar, this);

        commands.registerCommand('gitlens.views.exploreRepoRevision', this.exploreRepoRevision, this);

        commands.registerCommand('gitlens.views.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.views.openChangesWithWorking', this.openChangesWithWorking, this);
        commands.registerCommand('gitlens.views.openFile', this.openFile, this);
        commands.registerCommand('gitlens.views.openFileRevision', this.openFileRevision, this);
        commands.registerCommand('gitlens.views.openFileRevisionInRemote', this.openFileRevisionInRemote, this);
        commands.registerCommand('gitlens.views.openChangedFiles', this.openChangedFiles, this);
        commands.registerCommand('gitlens.views.openChangedFileChanges', this.openChangedFileChanges, this);
        commands.registerCommand(
            'gitlens.views.openChangedFileChangesWithWorking',
            this.openChangedFileChangesWithWorking,
            this
        );
        commands.registerCommand('gitlens.views.openChangedFileRevisions', this.openChangedFileRevisions, this);
        commands.registerCommand('gitlens.views.applyChanges', this.applyChanges, this);
        commands.registerCommand('gitlens.views.checkout', this.checkout, this);

        commands.registerCommand('gitlens.views.stageFile', this.stageFile, this);
        commands.registerCommand('gitlens.views.unstageFile', this.unstageFile, this);

        commands.registerCommand('gitlens.views.compareAncestryWithWorking', this.compareAncestryWithWorking, this);
        commands.registerCommand('gitlens.views.compareWithHead', this.compareWithHead, this);
        commands.registerCommand('gitlens.views.compareWithRemote', this.compareWithRemote, this);
        commands.registerCommand('gitlens.views.compareWithSelected', this.compareWithSelected, this);
        commands.registerCommand('gitlens.views.selectForCompare', this.selectForCompare, this);
        commands.registerCommand('gitlens.views.compareFileWithSelected', this.compareFileWithSelected, this);
        commands.registerCommand('gitlens.views.selectFileForCompare', this.selectFileForCompare, this);
        commands.registerCommand('gitlens.views.compareWithWorking', this.compareWithWorking, this);

        commands.registerCommand('gitlens.views.terminalCheckoutBranch', this.terminalCheckoutBranch, this);
        commands.registerCommand('gitlens.views.terminalCreateBranch', this.terminalCreateBranch, this);
        commands.registerCommand('gitlens.views.terminalDeleteBranch', this.terminalDeleteBranch, this);
        commands.registerCommand('gitlens.views.terminalMergeBranch', this.terminalMergeBranch, this);
        commands.registerCommand('gitlens.views.terminalRebaseBranch', this.terminalRebaseBranch, this);
        commands.registerCommand('gitlens.views.terminalRebaseBranchToRemote', this.terminalRebaseBranchToRemote, this);
        commands.registerCommand(
            'gitlens.views.terminalSquashBranchIntoCommit',
            this.terminalSquashBranchIntoCommit,
            this
        );
        commands.registerCommand('gitlens.views.terminalCheckoutCommit', this.terminalCheckoutCommit, this);
        commands.registerCommand('gitlens.views.terminalCherryPickCommit', this.terminalCherryPickCommit, this);
        commands.registerCommand('gitlens.views.terminalPushCommit', this.terminalPushCommit, this);
        commands.registerCommand('gitlens.views.terminalRebaseCommit', this.terminalRebaseCommit, this);
        commands.registerCommand('gitlens.views.terminalResetCommit', this.terminalResetCommit, this);
        commands.registerCommand('gitlens.views.terminalRevertCommit', this.terminalRevertCommit, this);
        commands.registerCommand('gitlens.views.terminalRemoveRemote', this.terminalRemoveRemote, this);
        commands.registerCommand('gitlens.views.terminalCreateTag', this.terminalCreateTag, this);
        commands.registerCommand('gitlens.views.terminalDeleteTag', this.terminalDeleteTag, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private fetch(node: RemoteNode | RepositoryNode) {
        if (node instanceof RemoteNode) return node.fetch();
        if (node instanceof RepositoryNode) return node.fetch();
        return;
    }

    private pull(node: RepositoryNode | BranchTrackingStatusNode) {
        if (node instanceof BranchTrackingStatusNode) {
            node = node.getParent() as RepositoryNode;
        }
        if (!(node instanceof RepositoryNode)) return;

        return node.pull();
    }

    private push(node: RepositoryNode | BranchTrackingStatusNode, force?: boolean) {
        if (node instanceof BranchTrackingStatusNode) {
            node = node.getParent() as RepositoryNode;
        }
        if (!(node instanceof RepositoryNode)) return;

        return node.push({ force: force });
    }

    private async applyChanges(node: CommitFileNode | StashFileNode | ResultsFileNode) {
        if (
            !(node instanceof CommitFileNode) &&
            !(node instanceof StashFileNode) &&
            !(node instanceof ResultsFileNode)
        ) {
            return;
        }

        void (await this.openFile(node));

        if (node instanceof ResultsFileNode) {
            void (await Container.git.applyChangesToWorkingFile(node.uri, node.ref1, node.ref2));

            return;
        }

        if (node.uri.sha !== undefined && node.uri.sha !== 'HEAD') {
            void (await Container.git.applyChangesToWorkingFile(node.uri));
        }
    }

    private async checkout(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        return Container.git.checkout(node.repoPath, node.ref);
    }

    private closeRepository(node: RepositoryNode) {
        if (!(node instanceof RepositoryNode)) return;

        node.repo.closed = true;
    }

    private compareWithHead(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        return Container.compareView.compare(node.repoPath, node.ref, 'HEAD');
    }

    private compareWithRemote(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;
        if (!node.branch.tracking) return;

        return Container.compareView.compare(node.repoPath, node.branch.tracking, node.ref);
    }

    private compareWithWorking(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        return Container.compareView.compare(node.repoPath, node.ref, '');
    }

    private async compareAncestryWithWorking(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;

        const branch = await Container.git.getBranch(node.repoPath);
        if (branch === undefined) return;

        const commonAncestor = await Container.git.getMergeBase(node.repoPath, branch.ref, node.ref);
        if (commonAncestor === undefined) return;

        return Container.compareView.compare(
            node.repoPath,
            { ref: commonAncestor, label: `ancestry with ${node.ref} (${GitService.shortenSha(commonAncestor)})` },
            ''
        );
    }

    private compareWithSelected(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        Container.compareView.compareWithSelected(node.repoPath, node.ref);
    }

    private selectForCompare(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        Container.compareView.selectForCompare(node.repoPath, node.ref);
    }

    private compareFileWithSelected(node: CommitFileNode | StashFileNode | ResultsFileNode) {
        if (
            this._selectedFile === undefined ||
            (!(node instanceof CommitFileNode) && !(node instanceof ResultsFileNode)) ||
            node.ref === undefined
        ) {
            return;
        }
        if (this._selectedFile.repoPath !== node.repoPath) {
            this.selectFileForCompare(node);
            return;
        }

        const selected = this._selectedFile;

        this._selectedFile = undefined;
        setCommandContext(CommandContext.ViewsCanCompareFile, false);

        const diffArgs: DiffWithCommandArgs = {
            repoPath: selected.repoPath,
            lhs: {
                sha: selected.ref,
                uri: selected.uri!
            },
            rhs: {
                sha: node.ref,
                uri: node.uri
            }
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }

    private _selectedFile: ICompareSelected | undefined;

    private selectFileForCompare(node: CommitFileNode | StashFileNode | ResultsFileNode) {
        if ((!(node instanceof CommitFileNode) && !(node instanceof ResultsFileNode)) || node.ref === undefined) return;

        this._selectedFile = {
            ref: node.ref,
            repoPath: node.repoPath,
            uri: node.uri
        };
        setCommandContext(CommandContext.ViewsCanCompareFile, true);
    }

    private exploreRepoRevision(node: ViewRefNode, options: { openInNewWindow?: boolean } = {}) {
        if (!(node instanceof ViewRefNode)) return;

        const uri = toGitLensFSUri(node.ref, node.repoPath);
        const gitUri = GitUri.fromRevisionUri(uri);

        openWorkspace(uri, `${paths.basename(gitUri.repoPath!)} @ ${gitUri.shortSha}`, options);

        void commands.executeCommand(BuiltInCommands.FocusFilesExplorer);
    }

    private openChanges(node: CommitFileNode | StashFileNode | ResultsFileNode) {
        if (!(node instanceof CommitFileNode) && !(node instanceof ResultsFileNode)) return;

        const command = node.getCommand();
        if (command === undefined || command.arguments === undefined) return;

        const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
        args.showOptions!.preview = false;
        return commands.executeCommand(command.command, uri, args);
    }

    private async openChangesWithWorking(node: CommitFileNode | StashFileNode | ResultsFileNode) {
        if (!(node instanceof CommitFileNode) && !(node instanceof ResultsFileNode)) return;

        const args: DiffWithWorkingCommandArgs = {
            showOptions: {
                preserveFocus: true,
                preview: false
            }
        };

        if (node instanceof ResultsFileNode) {
            args.commit = await Container.git.getLogCommitForFile(node.repoPath, node.uri.fsPath, {
                ref: node.uri.sha,
                firstIfNotFound: true,
                reverse: true
            });
        }

        return commands.executeCommand(Commands.DiffWithWorking, node.uri, args);
    }

    private openFile(node: CommitFileNode | StashFileNode | ResultsFileNode) {
        if (!(node instanceof CommitFileNode) && !(node instanceof ResultsFileNode)) return;

        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openFileRevision(
        node: CommitFileNode | StashFileNode | ResultsFileNode,
        options: OpenFileRevisionCommandArgs = { showOptions: { preserveFocus: true, preview: false } }
    ) {
        if (!(node instanceof CommitFileNode) && !(node instanceof ResultsFileNode)) return;

        let uri = options.uri;
        if (uri == null) {
            if (node instanceof ResultsFileNode) {
                uri = GitUri.toRevisionUri(node.uri);
            }
            else {
                uri =
                    node.commit.status === 'D'
                        ? GitUri.toRevisionUri(
                              node.commit.previousSha!,
                              node.commit.previousUri.fsPath,
                              node.commit.repoPath
                          )
                        : GitUri.toRevisionUri(node.uri);
            }
        }

        return openEditor(uri, options.showOptions || { preserveFocus: true, preview: false });
    }

    private async openChangedFileChanges(
        node: CommitNode | StashNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        if (!(node instanceof CommitNode) && !(node instanceof StashNode)) return;

        const repoPath = node.commit.repoPath;
        const uris = node.commit.files.map(s => GitUri.fromFile(s, repoPath));

        for (const uri of uris) {
            await this.openDiffWith(
                repoPath,
                {
                    uri: uri,
                    sha:
                        node.commit.previousSha !== undefined ? node.commit.previousSha : GitService.deletedOrMissingSha
                },
                { uri: uri, sha: node.commit.sha },
                options
            );
        }
    }

    private async openChangedFileChangesWithWorking(
        node: CommitNode | StashNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        if (!(node instanceof CommitNode) && !(node instanceof StashNode)) return;

        const repoPath = node.commit.repoPath;
        const uris = Arrays.filterMap(node.commit.files, f =>
            f.status !== 'D' ? GitUri.fromFile(f, repoPath) : undefined
        );

        for (const uri of uris) {
            await this.openDiffWith(repoPath, { uri: uri, sha: node.commit.sha }, { uri: uri, sha: '' }, options);
        }
    }

    private async openChangedFiles(
        node: CommitNode | StashNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        if (!(node instanceof CommitNode) && !(node instanceof StashNode)) return;

        const repoPath = node.commit.repoPath;
        const uris = Arrays.filterMap(node.commit.files, f => GitUri.fromFile(f, repoPath));

        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openChangedFileRevisions(
        node: CommitNode | StashNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        if (!(node instanceof CommitNode) && !(node instanceof StashNode)) return;

        const uris = Arrays.filterMap(node.commit.files, f =>
            GitUri.toRevisionUri(
                f.status === 'D' ? node.commit.previousFileSha : node.commit.sha,
                f,
                node.commit.repoPath
            )
        );
        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openDiffWith(
        repoPath: string,
        lhs: DiffWithCommandArgsRevision,
        rhs: DiffWithCommandArgsRevision,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        const diffArgs: DiffWithCommandArgs = {
            repoPath: repoPath,
            lhs: lhs,
            rhs: rhs,
            showOptions: options
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }

    private async openFileRevisionInRemote(node: CommitFileNode | StashFileNode | StatusFileNode) {
        if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

        return commands.executeCommand(Commands.OpenFileInRemote, node.commit.toGitUri(node.commit.status === 'D'), {
            range: false
        } as OpenFileInRemoteCommandArgs);
    }

    private async stageFile(node: CommitFileNode | StatusFileNode) {
        if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

        void (await Container.git.stageFile(node.repoPath, node.file.fileName));
    }

    private async unstageFile(node: CommitFileNode | StatusFileNode) {
        if (!(node instanceof CommitFileNode) && !(node instanceof StatusFileNode)) return;

        void (await Container.git.unStageFile(node.repoPath, node.file.fileName));
    }

    private star(node: BranchNode | RepositoryNode) {
        if (node instanceof BranchNode || node instanceof RepositoryNode) return node.star();
        return;
    }

    private unstar(node: BranchNode | RepositoryNode) {
        if (node instanceof BranchNode || node instanceof RepositoryNode) return node.unstar();
        return;
    }

    async terminalCheckoutBranch(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('checkout', `${node.ref}`, node.repoPath);
    }

    async terminalCreateBranch(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        let remoteBranch = false;
        let value = undefined;
        if (node instanceof BranchNode && node.branch.remote) {
            remoteBranch = true;
            value = node.branch.getName();
        }

        const name = await window.showInputBox({
            prompt: `Please provide a branch name (Press 'Enter' to confirm or 'Escape' to cancel)`,
            placeHolder: `Branch name`,
            value: value
        } as InputBoxOptions);
        if (name === undefined || name.length === 0) return;

        this.sendTerminalCommand('branch', `${remoteBranch ? '-t ' : ''}${name} ${node.ref}`, node.repoPath);
    }

    terminalDeleteBranch(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;

        if (node.branch.remote) {
            this.sendTerminalCommand('push', `${node.branch.getRemote()} :${node.branch.getName()}`, node.repoPath);
        }
        else {
            this.sendTerminalCommand('branch', `-d ${node.ref}`, node.repoPath);
        }
    }

    terminalMergeBranch(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('merge', `${node.ref}`, node.repoPath);
    }

    terminalRebaseBranch(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('rebase', `-i ${node.ref}`, node.repoPath);
    }

    terminalRebaseBranchToRemote(node: BranchNode | BranchTrackingStatusNode) {
        if (node instanceof BranchNode) {
            if (!node.branch.current || !node.branch.tracking) return;

            this.sendTerminalCommand('rebase', `-i ${node.branch.tracking}`, node.repoPath);
        }
        else if (node instanceof BranchTrackingStatusNode) {
            this.sendTerminalCommand('rebase', `-i ${node.status.upstream}`, node.status.repoPath);
        }
    }

    terminalSquashBranchIntoCommit(node: BranchNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('merge', `--squash ${node.ref}`, node.repoPath);
    }

    terminalCheckoutCommit(node: CommitNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('checkout', `${node.ref}`, node.repoPath);
    }

    terminalCherryPickCommit(node: CommitNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('cherry-pick', `-e ${node.ref}`, node.repoPath);
    }

    async terminalPushCommit(node: CommitNode) {
        if (!(node instanceof CommitNode)) return;

        const branch = node.branch || (await Container.git.getBranch(node.repoPath));
        if (branch === undefined) return;

        this.sendTerminalCommand('push', `${branch.getRemote()} ${node.ref}:${branch.getName()}`, node.repoPath);
    }

    terminalRebaseCommit(node: CommitNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('rebase', `-i ${node.ref}^`, node.repoPath);
    }

    terminalResetCommit(node: CommitNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('reset', `--soft ${node.ref}`, node.repoPath);
    }

    terminalRevertCommit(node: CommitNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('revert', `-e ${node.ref}`, node.repoPath);
    }

    terminalRemoveRemote(node: RemoteNode) {
        if (!(node instanceof RemoteNode)) return;

        this.sendTerminalCommand('remote', `remove ${node.remote.name}`, node.remote.repoPath);
    }

    async terminalCreateTag(node: ViewRefNode) {
        if (!(node instanceof ViewRefNode)) return;

        const name = await window.showInputBox({
            prompt: `Please provide a tag name (Press 'Enter' to confirm or 'Escape' to cancel)`,
            placeHolder: `Tag name`
        } as InputBoxOptions);
        if (name === undefined || name.length === 0) return;

        const message = await window.showInputBox({
            prompt: `Please provide an optional message to annotate the tag (Press 'Enter' to confirm or 'Escape' to cancel)`,
            placeHolder: `Tag message`
        } as InputBoxOptions);
        if (message === undefined) return;

        const args = `${message.length !== 0 ? `-a -m "${message}" ` : ''}${name} ${node.ref}`;
        this.sendTerminalCommand('tag', args, node.repoPath);
    }

    terminalDeleteTag(node: TagNode) {
        if (!(node instanceof TagNode)) return;

        this.sendTerminalCommand('tag', `-d ${node.ref}`, node.repoPath);
    }

    private ensureTerminal(cwd: string): Terminal {
        if (this._terminal === undefined) {
            this._terminal = window.createTerminal(extensionTerminalName);
            this._disposable = window.onDidCloseTerminal((e: Terminal) => {
                if (e.name === extensionTerminalName) {
                    this._terminal = undefined;
                    this._disposable!.dispose();
                    this._disposable = undefined;
                }
            }, this);

            Container.context.subscriptions.push(this._disposable);
            this._terminalCwd = undefined;
        }

        if (this._terminalCwd !== cwd) {
            this._terminal.sendText(`cd "${cwd}"`, true);
            this._terminalCwd = cwd;
        }

        return this._terminal;
    }

    private sendTerminalCommand(command: string, args: string, cwd: string) {
        // let git = GitService.getGitPath();
        // if (git.includes(' ')) {
        //     git = `"${git}"`;
        // }

        const terminal = this.ensureTerminal(cwd);
        terminal.show(false);
        terminal.sendText(`git ${command} ${args}`, false);
    }
}
