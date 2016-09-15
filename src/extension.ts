'use strict';
import {CodeLens, DocumentSelector, ExtensionContext, extensions, languages, OverviewRulerLane, window, workspace} from 'vscode';
import GitContentProvider from './gitContentProvider';
import GitBlameCodeLensProvider from './gitBlameCodeLensProvider';
import GitBlameContentProvider from './gitBlameContentProvider';
import GitBlameController from './gitBlameController';
import GitProvider from './gitProvider';
import Git from './git';
import {DiffWithPreviousCommand, DiffWithWorkingCommand, ShowBlameCommand, ShowBlameHistoryCommand, ToggleBlameCommand} from './commands';
import {ICodeLensesConfig} from './configuration';
import {WorkspaceState} from './constants';

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        console.warn('GitLens inactive: no rootPath');

        return;
    }

    console.log(`GitLens active: ${workspace.rootPath}`);

    Git.repoPath(workspace.rootPath).then(repoPath => {
        context.workspaceState.update(WorkspaceState.RepoPath, repoPath);
        context.workspaceState.update(WorkspaceState.HasGitHistoryExtension, extensions.getExtension('donjayamanne.githistory') !== undefined);

        const git = new GitProvider(context);
        context.subscriptions.push(git);

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));
        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitBlameContentProvider.scheme, new GitBlameContentProvider(context, git)));

        const config = workspace.getConfiguration('gitlens').get<ICodeLensesConfig>('codeLens');
        if (config.recentChange.enabled || config.authors.enabled) {
            context.subscriptions.push(languages.registerCodeLensProvider(GitBlameCodeLensProvider.selector, new GitBlameCodeLensProvider(context, git)));
        }

        const blameController = new GitBlameController(context, git);
        context.subscriptions.push(blameController);

        context.subscriptions.push(new DiffWithWorkingCommand(git));
        context.subscriptions.push(new DiffWithPreviousCommand(git));
        context.subscriptions.push(new ShowBlameCommand(git, blameController));
        context.subscriptions.push(new ToggleBlameCommand(git, blameController));
        context.subscriptions.push(new ShowBlameHistoryCommand(git));
    }).catch(reason => console.warn('[GitLens]', reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}