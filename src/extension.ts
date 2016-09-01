'use strict';
import {CodeLens, DocumentSelector, ExtensionContext, extensions, languages, workspace} from 'vscode';
import GitCodeLensProvider from './gitCodeLensProvider';
import GitBlameCodeLensProvider from './gitBlameCodeLensProvider';
import GitBlameContentProvider from './gitBlameContentProvider';
import GitProvider from './gitProvider';
import {BlameCommand, DiffWithPreviousCommand, DiffWithWorkingCommand} from './commands';
import {WorkspaceState} from './constants';

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        console.warn('GitLens inactive: no rootPath');

        return;
    }

    console.log(`GitLens active: ${workspace.rootPath}`);

    const git = new GitProvider(context);
    context.subscriptions.push(git);

    git.getRepoPath(workspace.rootPath).then(repoPath => {
        context.workspaceState.update(WorkspaceState.RepoPath, repoPath);
        context.workspaceState.update(WorkspaceState.HasGitHistoryExtension, extensions.getExtension('donjayamanne.githistory') !== undefined);

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitBlameContentProvider.scheme, new GitBlameContentProvider(context, git)));
        context.subscriptions.push(languages.registerCodeLensProvider(GitCodeLensProvider.selector, new GitCodeLensProvider(context, git)));
        context.subscriptions.push(languages.registerCodeLensProvider(GitBlameCodeLensProvider.selector, new GitBlameCodeLensProvider(context, git)));
        context.subscriptions.push(new BlameCommand(git));
        context.subscriptions.push(new DiffWithPreviousCommand(git));
        context.subscriptions.push(new DiffWithWorkingCommand(git));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}