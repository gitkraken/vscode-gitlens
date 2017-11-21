'use strict';
import { ExtensionContext, extensions, languages, window, workspace } from 'vscode';
import { AnnotationController } from './annotations/annotationController';
import { Configuration, IConfig } from './configuration';
import { ApplicationInsightsKey, CommandContext, ExtensionKey, GlobalState, QualifiedExtensionId, setCommandContext } from './constants';
import { CodeLensController } from './codeLensController';
import { configureCommands } from './commands';
import { CurrentLineController } from './currentLineController';
import { GitContentProvider } from './gitContentProvider';
import { GitExplorer } from './views/gitExplorer';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { GitContextTracker, GitService } from './gitService';
import { Keyboard } from './keyboard';
import { Logger } from './logger';
import { Messages, SuppressedKeys } from './messages';
import { Telemetry } from './telemetry';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    Configuration.configure(context);
    Logger.configure(context);
    Messages.configure(context);
    Telemetry.configure(ApplicationInsightsKey);

    const gitlens = extensions.getExtension(QualifiedExtensionId)!;
    const gitlensVersion = gitlens.packageJSON.version;

    Logger.log(`GitLens(v${gitlensVersion}) active`);

    const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

    try {
        await GitService.initialize(cfg.advanced.git);
    }
    catch (ex) {
        Logger.error(ex, 'Extension.activate');
        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(`GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'gitlens.advanced.git' is pointed to its installed location.`);
        }
        setCommandContext(CommandContext.Enabled, false);
        return;
    }

    const gitVersion = GitService.getGitVersion();
    Logger.log(`Git version: ${gitVersion}`);

    const telemetryContext: { [id: string]: any } = Object.create(null);
    telemetryContext.version = gitlensVersion;
    telemetryContext['git.version'] = gitVersion;
    Telemetry.setContext(telemetryContext);

    notifyOnUnsupportedGitVersion(context, gitVersion);
    notifyOnNewGitLensVersion(context, gitlensVersion);

    await context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    const git = new GitService();
    context.subscriptions.push(git);

    const gitContextTracker = new GitContextTracker(git);
    context.subscriptions.push(gitContextTracker);

    const annotationController = new AnnotationController(context, git, gitContextTracker);
    context.subscriptions.push(annotationController);

    const currentLineController = new CurrentLineController(context, git, gitContextTracker, annotationController);
    context.subscriptions.push(currentLineController);

    const codeLensController = new CodeLensController(context, git, gitContextTracker);
    context.subscriptions.push(codeLensController);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));
    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider(context, git)));
    context.subscriptions.push(window.registerTreeDataProvider('gitlens.gitExplorer', new GitExplorer(context, git)));

    context.subscriptions.push(new Keyboard());

    configureCommands(context, git, annotationController, currentLineController, codeLensController);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

    // Slightly delay enabling the explorer to not stop the rest of GitLens from being usable
    setTimeout(() => setCommandContext(CommandContext.GitExplorer, true), 1000);
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function notifyOnNewGitLensVersion(context: ExtensionContext, version: string) {
    if (context.globalState.get(SuppressedKeys.UpdateNotice, false)) return;

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);

    if (previousVersion === undefined) {
        Logger.log(`GitLens first-time install`);
        await Messages.showWelcomeMessage();
        return;
    }

    if (previousVersion !== version) {
        Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);
    }

    const [major, minor] = version.split('.');
    const [prevMajor, prevMinor] = previousVersion.split('.');
    if (major === prevMajor && minor === prevMinor) return;
    // Don't notify on downgrades
    if (major < prevMajor || (major === prevMajor && minor < prevMinor)) return;

    await Messages.showUpdateMessage(version);
}

async function notifyOnUnsupportedGitVersion(context: ExtensionContext, version: string) {
    if (GitService.validateGitVersion(2, 2)) return;

    // If git is less than v2.2.0
    await Messages.showUnsupportedGitVersionErrorMessage(version);
}