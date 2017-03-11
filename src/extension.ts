'use strict';
import { ExtensionContext, languages, window, workspace } from 'vscode';
import { BlameabilityTracker } from './blameabilityTracker';
import { BlameActiveLineController } from './blameActiveLineController';
import { BlameAnnotationController } from './blameAnnotationController';
import { configureCssCharacters } from './blameAnnotationFormatter';
import { CommandContext, setCommandContext } from './commands';
import { CloseUnchangedFilesCommand, OpenChangedFilesCommand } from './commands';
import { CopyMessageToClipboardCommand, CopyShaToClipboardCommand } from './commands';
import { DiffDirectoryCommand, DiffLineWithPreviousCommand, DiffLineWithWorkingCommand, DiffWithNextCommand, DiffWithPreviousCommand, DiffWithWorkingCommand} from './commands';
import { ShowBlameCommand, ToggleBlameCommand } from './commands';
import { ShowBlameHistoryCommand, ShowFileHistoryCommand } from './commands';
import { ShowQuickCommitDetailsCommand, ShowQuickCommitFileDetailsCommand, ShowQuickFileHistoryCommand, ShowQuickRepoHistoryCommand, ShowQuickRepoStatusCommand} from './commands';
import { ToggleCodeLensCommand } from './commands';
import { Keyboard } from './commands';
import { IAdvancedConfig, IBlameConfig } from './configuration';
import { WorkspaceState } from './constants';
import { GitContentProvider } from './gitContentProvider';
import { Git, GitProvider } from './gitProvider';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { Logger } from './logger';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    Logger.configure(context);

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
            await window.showErrorMessage(`GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'gitlens.advanced.git' is pointed to its installed location.`);
        }
        setCommandContext(CommandContext.Enabled, false);
        return;
    }

    const version = Git.gitInfo().version;
    const [major, minor] = version.split('.');
    // If git is less than v2.2.0
    if (parseInt(major, 10) < 2 || parseInt(minor, 10) < 2) {
        await window.showErrorMessage(`GitLens requires a newer version of Git (>= 2.2.0) than is currently installed (${version}). Please install a more recent version of Git.`);
    }

    let gitEnabled = workspace.getConfiguration('git').get<boolean>('enabled');
    setCommandContext(CommandContext.Enabled, gitEnabled);
    context.subscriptions.push(workspace.onDidChangeConfiguration(() => {
        if (gitEnabled !== workspace.getConfiguration('git').get<boolean>('enabled')) {
            gitEnabled = !gitEnabled;
            setCommandContext(CommandContext.Enabled, gitEnabled);
        }
    }, this));

    context.workspaceState.update(WorkspaceState.RepoPath, repoPath);

    const git = new GitProvider(context);
    context.subscriptions.push(git);

    const blameabilityTracker = new BlameabilityTracker(git);
    context.subscriptions.push(blameabilityTracker);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));

    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider(context, git)));

    const annotationController = new BlameAnnotationController(context, git, blameabilityTracker);
    context.subscriptions.push(annotationController);

    const activeLineController = new BlameActiveLineController(context, git, blameabilityTracker, annotationController);
    context.subscriptions.push(activeLineController);

    context.subscriptions.push(new Keyboard(context));

    context.subscriptions.push(new CloseUnchangedFilesCommand(git, repoPath));
    context.subscriptions.push(new OpenChangedFilesCommand(git, repoPath));
    context.subscriptions.push(new CopyMessageToClipboardCommand(git, repoPath));
    context.subscriptions.push(new CopyShaToClipboardCommand(git, repoPath));
    context.subscriptions.push(new DiffDirectoryCommand(git, repoPath));
    context.subscriptions.push(new DiffLineWithPreviousCommand(git));
    context.subscriptions.push(new DiffLineWithWorkingCommand(git));
    context.subscriptions.push(new DiffWithNextCommand(git));
    context.subscriptions.push(new DiffWithPreviousCommand(git));
    context.subscriptions.push(new DiffWithWorkingCommand(git));
    context.subscriptions.push(new ShowBlameCommand(annotationController));
    context.subscriptions.push(new ToggleBlameCommand(annotationController));
    context.subscriptions.push(new ShowBlameHistoryCommand(git));
    context.subscriptions.push(new ShowFileHistoryCommand(git));
    context.subscriptions.push(new ShowQuickCommitDetailsCommand(git, repoPath));
    context.subscriptions.push(new ShowQuickCommitFileDetailsCommand(git));
    context.subscriptions.push(new ShowQuickFileHistoryCommand(git));
    context.subscriptions.push(new ShowQuickRepoHistoryCommand(git, repoPath));
    context.subscriptions.push(new ShowQuickRepoStatusCommand(git, repoPath));
    context.subscriptions.push(new ToggleCodeLensCommand(git));
}

// this method is called when your extension is deactivated
export function deactivate() { }