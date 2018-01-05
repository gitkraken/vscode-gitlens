import { Arrays } from '../system';
import { commands, Disposable, ExtensionContext, InputBoxOptions, Terminal, TextDocumentShowOptions, Uri, window } from 'vscode';
import { CommandContext, ExtensionTerminalName, setCommandContext } from '../constants';
import { BranchNode, ExplorerNode } from '../views/gitExplorer';
import { CommitFileNode, CommitNode, ExplorerRefNode, RemoteNode, StashFileNode, StashNode, StatusFileCommitsNode, StatusUpstreamNode } from './explorerNodes';
import { Commands, DiffWithCommandArgs, DiffWithCommandArgsRevision, DiffWithPreviousCommandArgs, DiffWithWorkingCommandArgs, openEditor, OpenFileInRemoteCommandArgs, OpenFileRevisionCommandArgs } from '../commands';
import { GitService, GitUri } from '../gitService';
import { ResultsExplorer } from './resultsExplorer';

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

    constructor(
        public readonly context: ExtensionContext,
        public readonly git: GitService
    ) {
        super(() => this.dispose());

        commands.registerCommand('gitlens.explorers.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.explorers.openChangesWithWorking', this.openChangesWithWorking, this);
        commands.registerCommand('gitlens.explorers.openFile', this.openFile, this);
        commands.registerCommand('gitlens.explorers.openFileRevision', this.openFileRevision, this);
        commands.registerCommand('gitlens.explorers.openFileRevisionInRemote', this.openFileRevisionInRemote, this);
        commands.registerCommand('gitlens.explorers.openChangedFiles', this.openChangedFiles, this);
        commands.registerCommand('gitlens.explorers.openChangedFileChanges', this.openChangedFileChanges, this);
        commands.registerCommand('gitlens.explorers.openChangedFileChangesWithWorking', this.openChangedFileChangesWithWorking, this);
        commands.registerCommand('gitlens.explorers.openChangedFileRevisions', this.openChangedFileRevisions, this);
        commands.registerCommand('gitlens.explorers.applyChanges', this.applyChanges, this);
        commands.registerCommand('gitlens.explorers.compareSelectedBaseWithWorking', this.compareSelectedBaseWithWorking, this);
        commands.registerCommand('gitlens.explorers.compareWithHead', this.compareWithHead, this);
        commands.registerCommand('gitlens.explorers.compareWithRemote', this.compareWithRemote, this);
        commands.registerCommand('gitlens.explorers.compareWithSelected', this.compareWithSelected, this);
        commands.registerCommand('gitlens.explorers.compareWithWorking', this.compareWithWorking, this);
        commands.registerCommand('gitlens.explorers.selectForCompare', this.selectForCompare, this);
        commands.registerCommand('gitlens.explorers.terminalCheckoutBranch', this.terminalCheckoutBranch, this);
        commands.registerCommand('gitlens.explorers.terminalCreateBranch', this.terminalCreateBranch, this);
        commands.registerCommand('gitlens.explorers.terminalDeleteBranch', this.terminalDeleteBranch, this);
        commands.registerCommand('gitlens.explorers.terminalRebaseBranchToRemote', this.terminalRebaseBranchToRemote, this);
        commands.registerCommand('gitlens.explorers.terminalSquashBranchIntoCommit', this.terminalSquashBranchIntoCommit, this);
        commands.registerCommand('gitlens.explorers.terminalRebaseCommit', this.terminalRebaseCommit, this);
        commands.registerCommand('gitlens.explorers.terminalResetCommit', this.terminalResetCommit, this);
        commands.registerCommand('gitlens.explorers.terminalRemoveRemote', this.terminalRemoveRemote, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private async applyChanges(node: CommitFileNode | StashFileNode) {
        await this.git.checkoutFile(node.uri);
        return this.openFile(node);
    }

    private async compareSelectedBaseWithWorking(node: BranchNode) {
        if (this._selection === undefined || !(node instanceof BranchNode)) return;
        if (this._selection.repoPath !== node.repoPath || this._selection.type !== 'branch') return;

        const base = await this.git.getMergeBase(this._selection.repoPath, this._selection.ref, node.ref);
        if (base === undefined) return;

        ResultsExplorer.instance.showComparisonInResults(this._selection.repoPath, base, '');
    }

    private compareWithHead(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

        ResultsExplorer.instance.showComparisonInResults(node.repoPath, node.ref, 'HEAD');
    }

    private compareWithRemote(node: BranchNode) {
        if (!node.branch.tracking) return;

        ResultsExplorer.instance.showComparisonInResults(node.repoPath, node.branch.tracking, node.ref);
    }

    private compareWithSelected(node: ExplorerNode) {
        if (this._selection === undefined || !(node instanceof ExplorerRefNode)) return;
        if (this._selection.repoPath !== node.repoPath) return;

        ResultsExplorer.instance.showComparisonInResults(this._selection.repoPath, this._selection.ref, node.ref);
    }

    private compareWithWorking(node: ExplorerNode) {
        if (!(node instanceof ExplorerRefNode)) return;

        ResultsExplorer.instance.showComparisonInResults(node.repoPath, node.ref, '');
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

    private openFile(node: CommitFileNode | StashFileNode | StatusFileCommitsNode) {
        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openFileRevision(node: CommitFileNode | StashFileNode | StatusFileCommitsNode, options: OpenFileRevisionCommandArgs = { showOptions: { preserveFocus: true, preview: false } }) {
        const uri = options.uri || (node.commit.status === 'D'
            ? GitUri.toRevisionUri(node.commit.previousSha!, node.commit.previousUri.fsPath, node.commit.repoPath)
            : GitUri.toRevisionUri(node.uri));
        return openEditor(uri, options.showOptions || { preserveFocus: true, preview: false });
    }

    private async openChangedFileChanges(node: CommitFileNode | StashFileNode | StatusFileCommitsNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const repoPath = node.commit.repoPath;
        const uris = node.commit.fileStatuses
            .map(s => GitUri.fromFileStatus(s, repoPath));

        for (const uri of uris) {
            await this.openDiffWith(repoPath,
                { uri: uri, sha: node.commit.previousSha !== undefined ? node.commit.previousSha : GitService.deletedSha },
                { uri: uri, sha: node.commit.sha }, options);
        }
    }

    private async openChangedFileChangesWithWorking(node: CommitFileNode | StashFileNode | StatusFileCommitsNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const repoPath = node.commit.repoPath;
        const uris = Arrays.filterMap(node.commit.fileStatuses,
            f => f.status !== 'D' ? GitUri.fromFileStatus(f, repoPath) : undefined);

        for (const uri of uris) {
            await this.openDiffWith(repoPath, { uri: uri, sha: node.commit.sha }, { uri: uri, sha: '' }, options);
        }
    }

    private async openChangedFiles(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const repoPath = node.commit.repoPath;
        const uris = Arrays.filterMap(node.commit.fileStatuses,
            f => GitUri.fromFileStatus(f, repoPath));

        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openChangedFileRevisions(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const uris = Arrays.filterMap(node.commit.fileStatuses,
            f => GitUri.toRevisionUri(f.status === 'D' ? node.commit.previousFileSha : node.commit.sha, f, node.commit.repoPath));
        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openDiffWith(repoPath: string, lhs: DiffWithCommandArgsRevision, rhs: DiffWithCommandArgsRevision, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const diffArgs: DiffWithCommandArgs = {
            repoPath: repoPath,
            lhs: lhs,
            rhs: rhs,
            showOptions: options
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }

    private async openFileRevisionInRemote(node: CommitFileNode | StashFileNode | StatusFileCommitsNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, node.commit.toGitUri(node.commit.status === 'D'), { range: false } as OpenFileInRemoteCommandArgs);
    }

    async terminalCheckoutBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        const command = `checkout ${node.branch.name}`;
        this.sendTerminalCommand(command, node.branch.repoPath);
    }

    async terminalCreateBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        const name = await window.showInputBox({
            prompt: `Please provide a branch name (Press 'Enter' to confirm or 'Escape' to cancel)`,
            placeHolder: `Branch name`,
            value: node.branch.remote ? node.branch.getName() : undefined
        } as InputBoxOptions);
        if (name === undefined || name === '') return;

        const command = `branch ${node.branch.remote ? '-t ' : ''}${name} ${node.branch.name}`;
        this.sendTerminalCommand(command, node.branch.repoPath);
    }

    terminalDeleteBranch(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        const command = node.branch.remote
            ? `push ${node.branch.remote} :${node.branch.name}`
            : `branch -d ${node.branch.name}`;
        this.sendTerminalCommand(command, node.branch.repoPath);
    }

    terminalRebaseBranchToRemote(node: ExplorerNode) {
        if (node instanceof BranchNode) {
            if (!node.branch.current || !node.branch.tracking) return;

            const command = `rebase -i ${node.branch.tracking}`;
            this.sendTerminalCommand(command, node.branch.repoPath);
        }
        else if (node instanceof StatusUpstreamNode) {
            const command = `rebase -i ${node.status.upstream}`;
            this.sendTerminalCommand(command, node.status.repoPath);
        }
    }

    terminalSquashBranchIntoCommit(node: ExplorerNode) {
        if (!(node instanceof BranchNode)) return;

        const command = `merge --squash ${node.branch.name}`;
        this.sendTerminalCommand(command, node.branch.repoPath);
    }

    terminalRebaseCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        const command = `rebase -i ${node.commit.sha}^`;
        this.sendTerminalCommand(command, node.commit.repoPath);
    }

    terminalResetCommit(node: ExplorerNode) {
        if (!(node instanceof CommitNode)) return;

        const command = `reset --soft ${node.commit.sha}^`;
        this.sendTerminalCommand(command, node.commit.repoPath);
    }

    terminalRemoveRemote(node: ExplorerNode) {
        if (!(node instanceof RemoteNode)) return;

        const command = `remote remove ${node.remote.name}`;
        this.sendTerminalCommand(command, node.remote.repoPath);
    }

    private ensureTerminal(): Terminal {
        if (this._terminal === undefined) {
            this._terminal = window.createTerminal(ExtensionTerminalName);
            this._disposable = window.onDidCloseTerminal((e: Terminal) => {
                if (e.name === ExtensionTerminalName) {
                    this._terminal = undefined;
                    this._disposable!.dispose();
                    this._disposable = undefined;
                }
            }, this);

            this.context.subscriptions.push(this._disposable);
        }

        return this._terminal;
    }

    private sendTerminalCommand(command: string, cwd: string) {
        // let git = GitService.getGitPath();
        // if (git.includes(' ')) {
        //     git = `"${git}"`;
        // }

        const terminal = this.ensureTerminal();
        terminal.show(false);
        terminal.sendText(`git -C ${cwd} ${command}`, false);
    }
}