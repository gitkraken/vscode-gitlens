'use strict';
import {CodeLens, DocumentSelector, ExtensionContext, extensions, languages, OverviewRulerLane, StatusBarAlignment, window, workspace} from 'vscode';
import BlameAnnotationController from './blameAnnotationController';
import BlameStatusBarController from './blameStatusBarController';
import GitContentProvider from './gitContentProvider';
import GitBlameCodeLensProvider from './gitBlameCodeLensProvider';
import GitBlameContentProvider from './gitBlameContentProvider';
import GitProvider, {Git} from './gitProvider';
import {IStatusBarConfig} from './configuration';
import {WorkspaceState} from './constants';
import DiffWithPreviousCommand from './commands/diffWithPrevious';
import DiffWithWorkingCommand from './commands/diffWithWorking';
import ShowBlameCommand from './commands/showBlame';
import ShowBlameHistoryCommand from './commands/showBlameHistory';
import ToggleBlameCommand from './commands/toggleBlame';
import ToggleCodeLensCommand from './commands/toggleCodeLens';

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        console.warn('GitLens inactive: no rootPath');

        return;
    }

    const rootPath = workspace.rootPath.replace(/\\/g, '/');
    console.log(`GitLens active: ${rootPath}`);

    Git.repoPath(rootPath).then(repoPath => {
        context.workspaceState.update(WorkspaceState.RepoPath, repoPath);
        context.workspaceState.update(WorkspaceState.HasGitHistoryExtension, extensions.getExtension('donjayamanne.githistory') !== undefined);

        const git = new GitProvider(context);
        context.subscriptions.push(git);

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));
        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitBlameContentProvider.scheme, new GitBlameContentProvider(context, git)));

        context.subscriptions.push(languages.registerCodeLensProvider(GitBlameCodeLensProvider.selector, new GitBlameCodeLensProvider(context, git)));

        const annotationController = new BlameAnnotationController(context, git);
        context.subscriptions.push(annotationController);

        const statusBarController = new BlameStatusBarController(context, git);
        context.subscriptions.push(statusBarController);

        context.subscriptions.push(new DiffWithWorkingCommand(git));
        context.subscriptions.push(new DiffWithPreviousCommand(git));
        context.subscriptions.push(new ShowBlameCommand(git, annotationController));
        context.subscriptions.push(new ToggleBlameCommand(git, annotationController));
        context.subscriptions.push(new ShowBlameHistoryCommand(git));
        context.subscriptions.push(new ToggleCodeLensCommand(git));
    }).catch(reason => console.warn('[GitLens]', reason));
}

// this method is called when your extension is deactivated
export function deactivate() { }