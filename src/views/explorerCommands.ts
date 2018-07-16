'use strict';
import { commands, Disposable, InputBoxOptions, Terminal, TextDocumentShowOptions, Uri, window } from 'vscode';
import {
    Commands,
    DiffWithCommandArgs,
    DiffWithCommandArgsRevision,
    DiffWithPreviousCommandArgs,
    DiffWithWorkingCommandArgs,
    openEditor,
    OpenFileInRemoteCommandArgs,
    OpenFileRevisionCommandArgs
} from '../commands';
import { CommandContext, extensionTerminalName, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitService, GitUri } from '../gitService';
import { Arrays } from '../system';
import {
    BranchNode,
    CommitFileNode,
    CommitNode,
    ExplorerNode,
    ExplorerRefNode,
    RemoteNode,
    RepositoryNode,
    StashFileNode,
    StashNode,
    StatusFileCommitsNode,
    StatusFileNode,
    StatusNode,
    StatusUpstreamNode,
    TagNode
} from './nodes';

export interface RefreshNodeCommandArgs {
    maxCount?: number;
}

interface ICompareSelected {
    ref: string;
    repoPath: string | undefined;
    type: 'branch' | 'ref';
}

export class ExplorerCommands extends Disposable {
    private _disposable: Disposable | undefined;
    private _terminal: Terminal | undefined;
    private _terminalCwd: string | undefined;

    constructor() {
        super(() => this.dispose());

        commands.registerCommand('gitlens.explorers.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.explorers.openChangesWithWorking', this.openChangesWithWorking, this);
        commands.registerCommand('gitlens.explorers.openFile', this.openFile, this);
        commands.registerCommand('gitlens.explorers.openFileRevision', this.openFileRevision, this);
        commands.registerCommand('gitlens.explorers.openFileRevisionInRemote', this.openFileRevisionInRemote, this);
        commands.registerCommand('gitlens.explorers.openChangedFiles', this.openChangedFiles, this);
        commands.registerCommand('gitlens.explorers.openChangedFileChanges', this.openChangedFileChanges, this);
        commands.registerCommand(
            'gitlens.explorers.openChangedFileChangesWithWorking',
            this.openChangedFileChangesWithWorking,
            this
        );
        commands.registerCommand('gitlens.explorers.openChangedFileRevisions', this.openChangedFileRevisions, this);
        commands.registerCommand('gitlens.explorers.applyChanges', this.applyChanges, this);
        commands.registerCommand('gitlens.explorers.closeRepository', this.closeRepository, this);
        commands.registerCommand('gitlens.explorers.compareAncestryWithWorking', this.compareAncestryWithWorking, this);
        commands.registerCommand('gitlens.explorers.compareWithHead', this.compareWithHead, this);
        commands.registerCommand('gitlens.explorers.compareWithRemote', this.compareWithRemote, this);
        commands.registerCommand('gitlens.explorers.compareWithSelected', this.compareWithSelected, this);
        commands.registerCommand('gitlens.explorers.compareWithWorking', this.compareWithWorking, this);
        commands.registerCommand('gitlens.explorers.selectForCompare', this.selectForCompare, this);
        commands.registerCommand('gitlens.explorers.terminalCheckoutBranch', this.terminalCheckoutBranch, this);
        commands.registerCommand('gitlens.explorers.terminalCreateBranch', this.terminalCreateBranch, this);
        commands.registerCommand('gitlens.explorers.terminalDeleteBranch', this.terminalDeleteBranch, this);
        commands.registerCommand('gitlens.explorers.terminalMergeBranch', this.terminalMergeBranch, this);
        commands.registerCommand('gitlens.explorers.terminalRebaseBranch', this.terminalRebaseBranch, this);
        commands.registerCommand(
            'gitlens.explorers.terminalRebaseBranchToRemote',
            this.terminalRebaseBranchToRemote,
            this
        );
        commands.registerCommand(
            'gitlens.explorers.terminalSquashBranchIntoCommit',
            this.terminalSquashBranchIntoCommit,
            this
        );
        commands.registerCommand('gitlens.explorers.terminalCherryPickCommit', this.terminalCherryPickCommit, this);
        commands.registerCommand('gitlens.explorers.terminalPushCommit', this.terminalPushCommit, this);
        commands.registerCommand('gitlens.explorers.terminalRebaseCommit', this.terminalRebaseCommit, this);
        commands.registerCommand('gitlens.explorers.terminalResetCommit', this.terminalResetCommit, this);
        commands.registerCommand('gitlens.explorers.terminalRevertCommit', this.terminalRevertCommit, this);
        commands.registerCommand('gitlens.explorers.terminalRemoveRemote', this.terminalRemoveRemote, this);
        commands.registerCommand('gitlens.explorers.terminalCreateTag', this.terminalCreateTag, this);
        commands.registerCommand('gitlens.explorers.terminalDeleteTag', this.terminalDeleteTag, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private async applyChanges(node: CommitFileNode | StashFileNode | StatusFileNode) {
        await Container.git.checkoutFile(node.uri);
        return this.openFile(node);
    }

    private closeRepository(node: RepositoryNode | StatusNode) {
        if (!(node instanceof RepositoryNode) && !(node instanceof StatusNode)) return;

        node.repo.closed = true;
    }

    private compareWithHead(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

        Container.resultsExplorer.showComparisonInResults(node.repoPath, node.ref, 'HEAD');
    }

    private compareWithRemote(node: BranchNode) {
        if (!node.branch.tracking) return;

        Container.resultsExplorer.showComparisonInResults(node.repoPath, node.branch.tracking, node.ref);
    }

    private compareWithWorking(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

        Container.resultsExplorer.showComparisonInResults(node.repoPath, node.ref, '');
    }

    private async compareAncestryWithWorking(node: BranchNode) {
        const branch = await Container.git.getBranch(node.repoPath);
        if (branch === undefined) return;

        const commonAncestor = await Container.git.getMergeBase(node.repoPath, branch.name, node.ref);
        if (commonAncestor === undefined) return;

        Container.resultsExplorer.showComparisonInResults(
            node.repoPath,
            { ref: commonAncestor, label: `ancestry with ${node.ref} (${GitService.shortenSha(commonAncestor)})` },
            ''
        );
    }

    private compareWithSelected(node: ExplorerNode) {
        if (this._selection === undefined || !(node instanceof ExplorerRefNode)) return;
        if (this._selection.repoPath !== node.repoPath) return;

        Container.resultsExplorer.showComparisonInResults(this._selection.repoPath, this._selection.ref, node.ref);
    }

    private _selection: ICompareSelected | undefined;

    private selectForCompare(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

        const type = node instanceof BranchNode ? 'branch' : 'ref';
        this._selection = {
            ref: node.ref,
            repoPath: node.repoPath,
            type: type
        };

        setCommandContext(CommandContext.ExplorersCanCompare, type);
    }

    private openChanges(node: CommitNode | StashNode) {
        const command = node.getCommand();
        if (command === undefined || command.arguments === undefined) return;

        const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
        args.showOptions!.preview = false;
        return commands.executeCommand(command.command, uri, args);
    }

    private openChangesWithWorking(node: CommitNode | StashNode) {
        const args: DiffWithWorkingCommandArgs = {
            commit: node.commit,
            showOptions: {
                preserveFocus: true,
                preview: false
            }
        };
        return commands.executeCommand(Commands.DiffWithWorking, node.commit.toGitUri(), args);
    }

    private openFile(node: CommitFileNode | StashFileNode | StatusFileCommitsNode | StatusFileNode) {
        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openFileRevision(
        node: CommitFileNode | StashFileNode | StatusFileCommitsNode,
        options: OpenFileRevisionCommandArgs = { showOptions: { preserveFocus: true, preview: false } }
    ) {
        const uri =
            options.uri ||
            (node.commit.status === 'D'
                ? GitUri.toRevisionUri(node.commit.previousSha!, node.commit.previousUri.fsPath, node.commit.repoPath)
                : GitUri.toRevisionUri(node.uri));
        return openEditor(uri, options.showOptions || { preserveFocus: true, preview: false });
    }

    private async openChangedFileChanges(
        node: CommitFileNode | StashFileNode | StatusFileCommitsNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        const repoPath = node.commit.repoPath;
        const uris = node.commit.fileStatuses.map(s => GitUri.fromFileStatus(s, repoPath));

        for (const uri of uris) {
            await this.openDiffWith(
                repoPath,
                {
                    uri: uri,
                    sha: node.commit.previousSha !== undefined ? node.commit.previousSha : GitService.deletedSha
                },
                { uri: uri, sha: node.commit.sha },
                options
            );
        }
    }

    private async openChangedFileChangesWithWorking(
        node: CommitFileNode | StashFileNode | StatusFileCommitsNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        const repoPath = node.commit.repoPath;
        const uris = Arrays.filterMap(
            node.commit.fileStatuses,
            f => (f.status !== 'D' ? GitUri.fromFileStatus(f, repoPath) : undefined)
        );

        for (const uri of uris) {
            await this.openDiffWith(repoPath, { uri: uri, sha: node.commit.sha }, { uri: uri, sha: '' }, options);
        }
    }

    private async openChangedFiles(
        node: CommitNode | StashNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        const repoPath = node.commit.repoPath;
        const uris = Arrays.filterMap(node.commit.fileStatuses, f => GitUri.fromFileStatus(f, repoPath));

        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openChangedFileRevisions(
        node: CommitNode | StashNode,
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ) {
        const uris = Arrays.filterMap(node.commit.fileStatuses, f =>
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

    private async openFileRevisionInRemote(node: CommitFileNode | StashFileNode | StatusFileCommitsNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, node.commit.toGitUri(node.commit.status === 'D'), {
            range: false
        } as OpenFileInRemoteCommandArgs);
    }

    async terminalCheckoutBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('checkout', `${node.ref}`, node.repoPath);
    }

    async terminalCreateBranch(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

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
        if (name === undefined || name === '') return;

        this.sendTerminalCommand('branch', `${remoteBranch ? '-t ' : ''}${name} ${node.ref}`, node.repoPath);
    }

    terminalDeleteBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        if (node.branch.remote) {
            this.sendTerminalCommand('push', `${node.branch.getRemote()} :${node.branch.getName()}`, node.repoPath);
        }
        else {
            this.sendTerminalCommand('branch', `-d ${node.ref}`, node.repoPath);
        }
    }

    terminalMergeBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('merge', `${node.ref}`, node.repoPath);
    }

    terminalRebaseBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('rebase', `-i ${node.ref}`, node.repoPath);
    }

    terminalRebaseBranchToRemote(node: ExplorerNode) {
        if (node instanceof BranchNode) {
            if (!node.branch.current || !node.branch.tracking) return;

            this.sendTerminalCommand('rebase', `-i ${node.branch.tracking}`, node.repoPath);
        }
        else if (node instanceof StatusUpstreamNode) {
            this.sendTerminalCommand('rebase', `-i ${node.status.upstream}`, node.status.repoPath);
        }
    }

    terminalSquashBranchIntoCommit(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        this.sendTerminalCommand('merge', `--squash ${node.ref}`, node.repoPath);
    }

    terminalCherryPickCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('cherry-pick', `-e ${node.ref}`, node.repoPath);
    }

    async terminalPushCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        const branch = node.branch || (await Container.git.getBranch(node.repoPath));
        if (branch === undefined) return;

        this.sendTerminalCommand('push', `${branch.getRemote()} ${node.ref}:${branch.getName()}`, node.repoPath);
    }

    terminalRebaseCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('rebase', `-i ${node.ref}^`, node.repoPath);
    }

    terminalResetCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('reset', `--soft ${node.ref}`, node.repoPath);
    }

    terminalRevertCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        this.sendTerminalCommand('revert', `-e ${node.ref}`, node.repoPath);
    }

    terminalRemoveRemote(node: ExplorerNode) {
        if (!(node instanceof RemoteNode)) return;

        this.sendTerminalCommand('remote', `remove ${node.remote.name}`, node.remote.repoPath);
    }

    async terminalCreateTag(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

        const name = await window.showInputBox({
            prompt: `Please provide a tag name (Press 'Enter' to confirm or 'Escape' to cancel)`,
            placeHolder: `Tag name`
        } as InputBoxOptions);
        if (name === undefined || name === '') return;

        const message = await window.showInputBox({
            prompt: `Please provide an optional message to annotate the tag (Press 'Enter' to confirm or 'Escape' to cancel)`,
            placeHolder: `Tag message`
        } as InputBoxOptions);
        if (message === undefined) return;

        const args = `${message !== '' ? `-a -m "${message}" ` : ''}${name} ${node.ref}`;
        this.sendTerminalCommand('tag', args, node.repoPath);
    }

    terminalDeleteTag(node: ExplorerNode) {
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
