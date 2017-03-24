'use strict';
import { commands, ExtensionContext, extensions, languages, Uri, window, workspace } from 'vscode';
import { BlameabilityTracker } from './blameabilityTracker';
import { BlameActiveLineController } from './blameActiveLineController';
import { BlameAnnotationController } from './blameAnnotationController';
import { configureCssCharacters } from './blameAnnotationFormatter';
import { CommandContext, setCommandContext } from './commands';
import { CloseUnchangedFilesCommand, OpenChangedFilesCommand } from './commands';
import { OpenCommitInRemoteCommand, OpenFileInRemoteCommand, OpenInRemoteCommand } from './commands';
import { CopyMessageToClipboardCommand, CopyShaToClipboardCommand } from './commands';
import { DiffDirectoryCommand, DiffLineWithPreviousCommand, DiffLineWithWorkingCommand, DiffWithBranchCommand, DiffWithNextCommand, DiffWithPreviousCommand, DiffWithWorkingCommand} from './commands';
import { ShowBlameCommand, ToggleBlameCommand } from './commands';
import { ShowBlameHistoryCommand, ShowFileHistoryCommand } from './commands';
import { ShowLastQuickPickCommand, ShowQuickBranchHistoryCommand, ShowQuickCurrentBranchHistoryCommand, ShowQuickCommitDetailsCommand, ShowQuickCommitFileDetailsCommand, ShowQuickFileHistoryCommand, ShowQuickRepoStatusCommand} from './commands';
import { ToggleCodeLensCommand } from './commands';
import { Keyboard } from './commands';
import { IAdvancedConfig, IBlameConfig } from './configuration';
import { BuiltInCommands, WorkspaceState } from './constants';
import { GitContentProvider } from './gitContentProvider';
import { Git, GitService } from './gitService';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { Logger } from './logger';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    Logger.configure(context);

    const gitlens = extensions.getExtension('eamodio.gitlens');
    const gitlensVersion = gitlens.packageJSON.version;

    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        Logger.warn(`GitLens(v${gitlensVersion}) inactive: no rootPath`);

        return;
    }

    const rootPath = workspace.rootPath.replace(/\\/g, '/');
    Logger.log(`GitLens(v${gitlensVersion}) active: ${rootPath}`);

    const config = workspace.getConfiguration('gitlens');
    const gitPath = config.get<IAdvancedConfig>('advanced').git;

    configureCssCharacters(config.get<IBlameConfig>('blame'));

    let repoPath: string;
    try {
        repoPath = await Git.getRepoPath(rootPath, gitPath);
    }
    catch (ex) {
        Logger.error(ex);
        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(`GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'gitlens.advanced.git' is pointed to its installed location.`);
        }
        setCommandContext(CommandContext.Enabled, false);
        return;
    }

    const gitVersion = Git.gitInfo().version;
    Logger.log(`Git version: ${gitVersion}`);

    notifyOnUnsupportedGitVersion(context, gitVersion);
    notifyOnNewGitLensVersion(context, gitlensVersion);

    let gitEnabled = workspace.getConfiguration('git').get<boolean>('enabled');
    setCommandContext(CommandContext.Enabled, gitEnabled);
    context.subscriptions.push(workspace.onDidChangeConfiguration(() => {
        if (gitEnabled !== workspace.getConfiguration('git').get<boolean>('enabled')) {
            gitEnabled = !gitEnabled;
            setCommandContext(CommandContext.Enabled, gitEnabled);
        }
    }, this));

    context.workspaceState.update(WorkspaceState.RepoPath, repoPath);

    const git = new GitService(context);
    context.subscriptions.push(git);

    const blameabilityTracker = new BlameabilityTracker(git);
    context.subscriptions.push(blameabilityTracker);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));

    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider(context, git)));

    const annotationController = new BlameAnnotationController(context, git, blameabilityTracker);
    context.subscriptions.push(annotationController);

    const activeLineController = new BlameActiveLineController(context, git, blameabilityTracker, annotationController);
    context.subscriptions.push(activeLineController);

    context.subscriptions.push(new Keyboard());

    context.subscriptions.push(new CloseUnchangedFilesCommand(git, repoPath));
    context.subscriptions.push(new OpenChangedFilesCommand(git, repoPath));
    context.subscriptions.push(new CopyMessageToClipboardCommand(git, repoPath));
    context.subscriptions.push(new CopyShaToClipboardCommand(git, repoPath));
    context.subscriptions.push(new DiffDirectoryCommand(git, repoPath));
    context.subscriptions.push(new DiffLineWithPreviousCommand(git));
    context.subscriptions.push(new DiffLineWithWorkingCommand(git));
    context.subscriptions.push(new DiffWithBranchCommand(git));
    context.subscriptions.push(new DiffWithNextCommand(git));
    context.subscriptions.push(new DiffWithPreviousCommand(git));
    context.subscriptions.push(new DiffWithWorkingCommand(git));
    context.subscriptions.push(new OpenCommitInRemoteCommand(git, repoPath));
    context.subscriptions.push(new OpenFileInRemoteCommand(git, repoPath));
    context.subscriptions.push(new OpenInRemoteCommand());
    context.subscriptions.push(new ShowBlameCommand(annotationController));
    context.subscriptions.push(new ToggleBlameCommand(annotationController));
    context.subscriptions.push(new ShowBlameHistoryCommand(git));
    context.subscriptions.push(new ShowFileHistoryCommand(git));
    context.subscriptions.push(new ShowLastQuickPickCommand());
    context.subscriptions.push(new ShowQuickBranchHistoryCommand(git, repoPath));
    context.subscriptions.push(new ShowQuickCurrentBranchHistoryCommand(git));
    context.subscriptions.push(new ShowQuickCommitDetailsCommand(git, repoPath));
    context.subscriptions.push(new ShowQuickCommitFileDetailsCommand(git));
    context.subscriptions.push(new ShowQuickFileHistoryCommand(git));
    context.subscriptions.push(new ShowQuickRepoStatusCommand(git, repoPath));
    context.subscriptions.push(new ToggleCodeLensCommand(git));
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function notifyOnNewGitLensVersion(context: ExtensionContext, version: string) {
    const previousVersion = context.globalState.get<string>(WorkspaceState.GitLensVersion);

    await context.globalState.update(WorkspaceState.GitLensVersion, version);

    if (previousVersion) {
        const [major, minor] = version.split('.');
        const [prevMajor, prevMinor] = previousVersion.split('.');
        if (major === prevMajor && minor === prevMinor) return;
    }

    const result = await window.showInformationMessage(`GitLens has been updated to v${version}`, 'View Release Notes');
    if (result === 'View Release Notes') {
        commands.executeCommand(BuiltInCommands.Open, Uri.parse('https://marketplace.visualstudio.com/items/eamodio.gitlens/changelog'));
    }
}

async function notifyOnUnsupportedGitVersion(context: ExtensionContext, version: string) {
    if (context.globalState.get(WorkspaceState.SuppressGitVersionWarning, false)) return;

    const [major, minor] = version.split('.');
    // If git is less than v2.2.0
    if (parseInt(major, 10) < 2 || parseInt(minor, 10) < 2) {
        const result = await window.showErrorMessage(`GitLens requires a newer version of Git (>= 2.2.0) than is currently installed (${version}). Please install a more recent version of Git.`, `Don't Show Again`);
        if (result === `Don't Show Again`) {
            context.globalState.update(WorkspaceState.SuppressGitVersionWarning, true);
        }
    }
}