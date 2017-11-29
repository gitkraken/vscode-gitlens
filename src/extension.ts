'use strict';
import { Objects } from './system';
import { ConfigurationTarget, ExtensionContext, extensions, languages, window, workspace } from 'vscode';
import { AnnotationController } from './annotations/annotationController';
import { configuration, Configuration, IConfig } from './configuration';
import { ApplicationInsightsKey, CommandContext, ExtensionKey, GlobalState, QualifiedExtensionId, setCommandContext } from './constants';
import { CodeLensController } from './codeLensController';
import { configureCommands } from './commands';
import { CurrentLineController } from './currentLineController';
import { ExplorerCommands } from './views/explorerCommands';
import { GitContentProvider } from './gitContentProvider';
import { GitExplorer } from './views/gitExplorer';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { GitContextTracker, GitService } from './gitService';
import { Keyboard } from './keyboard';
import { Logger } from './logger';
import { Messages, SuppressedMessages } from './messages';
import { ResultsExplorer } from './views/resultsExplorer';
import { Telemetry } from './telemetry';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    Configuration.configure(context);
    Logger.configure(context);
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

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);

    await migrateSettings(context, previousVersion);
    notifyOnUnsupportedGitVersion(context, gitVersion);
    notifyOnNewGitLensVersion(context, gitlensVersion, previousVersion);

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

    const explorerCommands = new ExplorerCommands(context, git);
    context.subscriptions.push(explorerCommands);

    context.subscriptions.push(window.registerTreeDataProvider('gitlens.gitExplorer', new GitExplorer(context, explorerCommands, git, gitContextTracker)));
    context.subscriptions.push(window.registerTreeDataProvider('gitlens.resultsExplorer', new ResultsExplorer(context, explorerCommands, git)));

    context.subscriptions.push(new Keyboard());

    configureCommands(context, git, annotationController, currentLineController, codeLensController);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

    // setCommandContext(CommandContext.ResultsExplorer, false);

    // Slightly delay enabling the explorer to not stop the rest of GitLens from being usable
    setTimeout(() => setCommandContext(CommandContext.GitExplorer, true), 1000);
}

// this method is called when your extension is deactivated
export function deactivate() { }

const migration = {
    major: 6,
    minor: 1,
    patch: 2
};

async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
    if (previousVersion === undefined) return;

    const [major, minor, patch] = previousVersion.split('.');
    if (parseInt(major, 10) >= migration.major && parseInt(minor, 10) >= migration.minor && parseInt(patch, 10) >= migration.patch) return;

    try {
        const section = configuration.name('advanced')('messages').value;
        const messages: { [key: string]: boolean } = configuration.get(section);

        let migrated = false;

        for (const m of Objects.values(SuppressedMessages)) {
            const suppressed = context.globalState.get<boolean>(m);
            if (suppressed === undefined) continue;

            migrated = true;
            messages[m] = suppressed;

            context.globalState.update(m, undefined);
        }

        if (!migrated) return;

        await configuration.update(section, messages, ConfigurationTarget.Global);
    }
    catch (ex) {
        Logger.error(ex, 'migrateSettings');
    }
}

async function notifyOnNewGitLensVersion(context: ExtensionContext, version: string, previousVersion: string | undefined) {
    if (configuration.get<boolean>(configuration.name('advanced')('messages')(SuppressedMessages.UpdateNotice).value)) return;

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