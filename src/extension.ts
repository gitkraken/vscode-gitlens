'use strict';
import {CodeLens, DocumentSelector, ExtensionContext, languages, workspace} from 'vscode';
import GitCodeLensProvider, {GitBlameCodeLens} from './codeLensProvider';
import GitContentProvider from './contentProvider';
import GitProvider from './gitProvider';
import {BlameCommand} from './commands';
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

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));

        context.subscriptions.push(new BlameCommand(git));

        const selector: DocumentSelector = { scheme: 'file' };
        context.subscriptions.push(languages.registerCodeLensProvider(selector, new GitCodeLensProvider(context, git)));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}