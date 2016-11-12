'use strict';
import { ExtensionContext, extensions, languages, window, workspace } from 'vscode';
import BlameAnnotationController from './blameAnnotationController';
import BlameStatusBarController from './blameStatusBarController';
import DiffLineWithPreviousCommand from './commands/diffLineWithPrevious';
import DiffLineWithWorkingCommand from './commands/diffLineWithWorking';
import DiffWithPreviousCommand from './commands/diffWithPrevious';
import DiffWithWorkingCommand from './commands/diffWithWorking';
import ShowBlameCommand from './commands/showBlame';
import ShowBlameHistoryCommand from './commands/showBlameHistory';
import ShowFileHistoryCommand from './commands/showFileHistory';
import ToggleBlameCommand from './commands/toggleBlame';
import ToggleCodeLensCommand from './commands/toggleCodeLens';
import { IAdvancedConfig } from './configuration';
import { WorkspaceState } from './constants';
import GitContentProvider from './gitContentProvider';
import GitProvider, { Git } from './gitProvider';
import GitRevisionCodeLensProvider from './gitRevisionCodeLensProvider';
import { Logger } from './logger';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        Logger.warn('GitLens inactive: no rootPath');

        return;
    }

    const rootPath = workspace.rootPath.replace(/\\/g, '/');
    Logger.log(`GitLens active: ${rootPath}`);

    const gitPath = workspace.getConfiguration('gitlens').get<IAdvancedConfig>('advanced').git;

    let repoPath: string;
    try {
        repoPath = await Git.repoPath(rootPath, gitPath);
    }
    catch (ex) {
        Logger.error(ex);
        await window.showErrorMessage(`GitLens: Unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'gitlens.advanced.git' is pointed to its installed location.`);
        return;
    }

    context.workspaceState.update(WorkspaceState.RepoPath, repoPath);
    context.workspaceState.update(WorkspaceState.HasGitHistoryExtension, extensions.getExtension('donjayamanne.githistory') !== undefined);

    const git = new GitProvider(context);
    context.subscriptions.push(git);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));

    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider(context, git)));

    const annotationController = new BlameAnnotationController(context, git);
    context.subscriptions.push(annotationController);

    const statusBarController = new BlameStatusBarController(context, git);
    context.subscriptions.push(statusBarController);

    context.subscriptions.push(new DiffWithWorkingCommand(git));
    context.subscriptions.push(new DiffLineWithWorkingCommand(git));
    context.subscriptions.push(new DiffWithPreviousCommand(git));
    context.subscriptions.push(new DiffLineWithPreviousCommand(git));
    context.subscriptions.push(new ShowBlameCommand(annotationController));
    context.subscriptions.push(new ToggleBlameCommand(annotationController));
    context.subscriptions.push(new ShowBlameHistoryCommand(git));
    context.subscriptions.push(new ShowFileHistoryCommand(git));
    context.subscriptions.push(new ToggleCodeLensCommand(git));
}

// this method is called when your extension is deactivated
export function deactivate() { }