import { Arrays } from '../system';
import { commands, Disposable, TextDocumentShowOptions, Uri, workspace } from 'vscode';
import { ExtensionKey } from '../constants';
import { GitExplorer, GitExplorerView } from '../views/gitExplorer';
import { configuration, GitExplorerFilesLayout } from '../configuration';
import { CommitFileNode, CommitNode, StashNode } from './explorerNodes';
import { Commands, DiffWithCommandArgs, DiffWithCommandArgsRevision, DiffWithPreviousCommandArgs, DiffWithWorkingCommandArgs, openEditor, OpenFileInRemoteCommandArgs, OpenFileRevisionCommandArgs } from '../commands';
import { GitService, GitUri } from '../gitService';

export class ExplorerCommands extends Disposable {

    private _disposable: Disposable | undefined;

    constructor(
        private explorer: GitExplorer
    ) {
        super(() => this.dispose());

        commands.registerCommand('gitlens.gitExplorer.setAutoRefreshToOn', () => this.explorer.setAutoRefresh(configuration.get<boolean>(configuration.name('gitExplorer')('autoRefresh').value), true), this);
        commands.registerCommand('gitlens.gitExplorer.setAutoRefreshToOff', () => this.explorer.setAutoRefresh(configuration.get<boolean>(configuration.name('gitExplorer')('autoRefresh').value), false), this);
        commands.registerCommand('gitlens.gitExplorer.setFilesLayoutToAuto', () => this.setFilesLayout(GitExplorerFilesLayout.Auto), this);
        commands.registerCommand('gitlens.gitExplorer.setFilesLayoutToList', () => this.setFilesLayout(GitExplorerFilesLayout.List), this);
        commands.registerCommand('gitlens.gitExplorer.setFilesLayoutToTree', () => this.setFilesLayout(GitExplorerFilesLayout.Tree), this);
        commands.registerCommand('gitlens.gitExplorer.switchToHistoryView', () => this.explorer.switchTo(GitExplorerView.History), this);
        commands.registerCommand('gitlens.gitExplorer.switchToRepositoryView', () => this.explorer.switchTo(GitExplorerView.Repository), this);
        commands.registerCommand('gitlens.gitExplorer.refresh', this.explorer.refresh, this);
        commands.registerCommand('gitlens.gitExplorer.refreshNode', this.explorer.refreshNode, this);
        commands.registerCommand('gitlens.gitExplorer.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.gitExplorer.openChangesWithWorking', this.openChangesWithWorking, this);
        commands.registerCommand('gitlens.gitExplorer.openFile', this.openFile, this);
        commands.registerCommand('gitlens.gitExplorer.openFileRevision', this.openFileRevision, this);
        commands.registerCommand('gitlens.gitExplorer.openFileRevisionInRemote', this.openFileRevisionInRemote, this);
        commands.registerCommand('gitlens.gitExplorer.openChangedFiles', this.openChangedFiles, this);
        commands.registerCommand('gitlens.gitExplorer.openChangedFileChanges', this.openChangedFileChanges, this);
        commands.registerCommand('gitlens.gitExplorer.openChangedFileChangesWithWorking', this.openChangedFileChangesWithWorking, this);
        commands.registerCommand('gitlens.gitExplorer.openChangedFileRevisions', this.openChangedFileRevisions, this);
        commands.registerCommand('gitlens.gitExplorer.applyChanges', this.applyChanges, this);
    }

     dispose() {
        this._disposable && this._disposable.dispose();
    }

     private async applyChanges(node: CommitNode | StashNode) {
        await this.explorer.git.checkoutFile(node.uri);
        return this.openFile(node);
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
        return commands.executeCommand(Commands.DiffWithWorking, new GitUri(node.commit.uri, node.commit), args);
    }

    private openFile(node: CommitNode | StashNode) {
        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openFileRevision(node: CommitNode | StashNode | CommitFileNode, options: OpenFileRevisionCommandArgs = { showOptions: { preserveFocus: true, preview: false } }) {
        return openEditor(options.uri || GitService.toGitContentUri(node.uri), options.showOptions || { preserveFocus: true, preview: false });
    }

    private async openChangedFileChanges(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const repoPath = node.commit.repoPath;
        const uris = node.commit.fileStatuses
            .map(s => GitUri.fromFileStatus(s, repoPath));
        for (const uri of uris) {
            await this.openDiffWith(repoPath,
                { uri: uri, sha: node.commit.previousSha !== undefined ? node.commit.previousSha : GitService.deletedSha },
                { uri: uri, sha: node.commit.sha }, options);
        }
    }

    private async openChangedFileChangesWithWorking(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
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
            f => f.status !== 'D' ? GitUri.fromFileStatus(f, repoPath) : undefined);
        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openChangedFileRevisions(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const uris = Arrays.filterMap(node.commit.fileStatuses,
            f => f.status !== 'D' ? GitService.toGitContentUri(node.commit.sha, f.fileName, node.commit.repoPath, f.originalFileName) : undefined);
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

    private async openFileRevisionInRemote(node: CommitNode | StashNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, new GitUri(node.commit.uri, node.commit), { range: false } as OpenFileInRemoteCommandArgs);
    }

    private async setFilesLayout(layout: GitExplorerFilesLayout) {
        return workspace.getConfiguration(ExtensionKey).update(configuration.name('gitExplorer')('files')('layout').value, layout, true);
    }
}