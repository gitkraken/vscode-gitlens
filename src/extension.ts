'use strict';
import { commands, ExtensionContext, languages, window, workspace } from 'vscode';
import BlameActiveLineController from './blameActiveLineController';
import BlameAnnotationController from './blameAnnotationController';
import { configureCssCharacters } from './blameAnnotationFormatter';
import CopyMessageToClipboardCommand from './commands/copyMessageToClipboard';
import CopyShaToClipboardCommand from './commands/copyShaToClipboard';
import DiffLineWithPreviousCommand from './commands/diffLineWithPrevious';
import DiffLineWithWorkingCommand from './commands/diffLineWithWorking';
import DiffWithPreviousCommand from './commands/diffWithPrevious';
import DiffWithWorkingCommand from './commands/diffWithWorking';
import ShowBlameCommand from './commands/showBlame';
import ShowBlameHistoryCommand from './commands/showBlameHistory';
import ShowFileHistoryCommand from './commands/showFileHistory';
import ShowQuickCommitDetailsCommand from './commands/showQuickCommitDetails';
import ShowQuickFileHistoryCommand from './commands/showQuickFileHistory';
import ShowQuickRepoHistoryCommand from './commands/showQuickRepoHistory';
import ToggleBlameCommand from './commands/toggleBlame';
import ToggleCodeLensCommand from './commands/toggleCodeLens';
import { IAdvancedConfig, IBlameConfig } from './configuration';
import { BuiltInCommands, WorkspaceState } from './constants';
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

    const config = workspace.getConfiguration('gitlens');
    const gitPath = config.get<IAdvancedConfig>('advanced').git;

    configureCssCharacters(config.get<IBlameConfig>('blame'));

    let repoPath: string;
    try {
        repoPath = await Git.repoPath(rootPath, gitPath);
    }
    catch (ex) {
        Logger.error(ex);
        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(`GitLens: Unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'gitlens.advanced.git' is pointed to its installed location.`);
        }
        commands.executeCommand(BuiltInCommands.SetContext, 'gitlens:enabled', false);
        return;
    }

    let gitEnabled = workspace.getConfiguration('git').get<boolean>('enabled');
    commands.executeCommand(BuiltInCommands.SetContext, 'gitlens:enabled', gitEnabled);
    context.subscriptions.push(workspace.onDidChangeConfiguration(() => {
        if (gitEnabled !== workspace.getConfiguration('git').get<boolean>('enabled')) {
            gitEnabled = !gitEnabled;
            commands.executeCommand(BuiltInCommands.SetContext, 'gitlens:enabled', gitEnabled);
        }
    }, this));

    context.workspaceState.update(WorkspaceState.RepoPath, repoPath);

    const git = new GitProvider(context);
    context.subscriptions.push(git);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));

    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider(context, git)));

    const annotationController = new BlameAnnotationController(context, git);
    context.subscriptions.push(annotationController);

    const activeLineController = new BlameActiveLineController(context, git, annotationController);
    context.subscriptions.push(activeLineController);

    context.subscriptions.push(new CopyMessageToClipboardCommand(git, repoPath));
    context.subscriptions.push(new CopyShaToClipboardCommand(git, repoPath));
    context.subscriptions.push(new DiffWithWorkingCommand(git));
    context.subscriptions.push(new DiffLineWithWorkingCommand(git));
    context.subscriptions.push(new DiffWithPreviousCommand(git));
    context.subscriptions.push(new DiffLineWithPreviousCommand(git));
    context.subscriptions.push(new ShowBlameCommand(annotationController));
    context.subscriptions.push(new ToggleBlameCommand(annotationController));
    context.subscriptions.push(new ShowBlameHistoryCommand(git));
    context.subscriptions.push(new ShowFileHistoryCommand(git));
    context.subscriptions.push(new ShowQuickCommitDetailsCommand(git));
    context.subscriptions.push(new ShowQuickFileHistoryCommand(git));
    context.subscriptions.push(new ShowQuickRepoHistoryCommand(git, repoPath));
    context.subscriptions.push(new ToggleCodeLensCommand(git));
}

// this method is called when your extension is deactivated
export function deactivate() { }