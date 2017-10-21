'use strict';
// import { Objects } from './system';
import { commands, ExtensionContext, extensions, languages, window, workspace } from 'vscode';
import { AnnotationController } from './annotations/annotationController';
import { CodeLensLocations, IConfig, LineHighlightLocations } from './configuration';
import { ApplicationInsightsKey, CommandContext, ExtensionKey, GlobalState, QualifiedExtensionId, setCommandContext } from './constants';
import { CodeLensController } from './codeLensController';
import { configureCommands } from './commands';
import { CurrentLineController, LineAnnotationType } from './currentLineController';
import { GitContentProvider } from './gitContentProvider';
import { GitExplorer } from './views/gitExplorer';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { GitContextTracker, GitService, RemoteProviderFactory } from './gitService';
import { Keyboard } from './keyboard';
import { Logger } from './logger';
import { Messages, SuppressedKeys } from './messages';
import { Telemetry } from './telemetry';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    Logger.configure(context);
    Messages.configure(context);
    Telemetry.configure(ApplicationInsightsKey);
    RemoteProviderFactory.configure(context);

    const gitlens = extensions.getExtension(QualifiedExtensionId)!;
    const gitlensVersion = gitlens.packageJSON.version;

    Logger.log(`GitLens(v${gitlensVersion}) active`);

    const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
    const gitPath = cfg.advanced.git;

    try {
        await GitService.getGitPath(gitPath);
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

    await migrateSettings(context);
    notifyOnUnsupportedGitVersion(context, gitVersion);
    notifyOnNewGitLensVersion(context, gitlensVersion);

    await context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    const git = new GitService();
    context.subscriptions.push(git);

    const gitContextTracker = new GitContextTracker(git);
    context.subscriptions.push(gitContextTracker);

    const annotationController = new AnnotationController(context, git, gitContextTracker);
    context.subscriptions.push(annotationController);

    const codeLensController = new CodeLensController(context, git);
    context.subscriptions.push(codeLensController);

    const currentLineController = new CurrentLineController(context, git, gitContextTracker, annotationController);
    context.subscriptions.push(currentLineController);

    context.subscriptions.push(new Keyboard());

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, git)));
    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider(context, git)));
    context.subscriptions.push(window.registerTreeDataProvider('gitlens.gitExplorer', new GitExplorer(context, git)));
    context.subscriptions.push(commands.registerTextEditorCommand('gitlens.computingFileAnnotations', () => { }));

    configureCommands(context, git, annotationController, currentLineController, codeLensController);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function migrateSettings(context: ExtensionContext) {
    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);
    if (previousVersion === undefined) return;

    const [major] = previousVersion.split('.');
    if (parseInt(major, 10) >= 4) return;

    try {
        const cfg = workspace.getConfiguration(ExtensionKey);
        const prevCfg = workspace.getConfiguration().get<any>(ExtensionKey)!;

        if (prevCfg.blame !== undefined && prevCfg.blame.annotation !== undefined) {
            switch (prevCfg.blame.annotation.activeLine) {
                case 'off':
                    await cfg.update('blame.line.enabled', false, true);
                    break;
                case 'hover':
                    await cfg.update('blame.line.annotationType', LineAnnotationType.Hover, true);
                    break;
            }

            if (prevCfg.blame.annotation.activeLineDarkColor != null) {
                await cfg.update('theme.annotations.line.trailing.dark.foregroundColor', prevCfg.blame.annotation.activeLineDarkColor, true);
            }

            if (prevCfg.blame.annotation.activeLineLightColor != null) {
                await cfg.update('theme.annotations.line.trailing.light.foregroundColor', prevCfg.blame.annotation.activeLineLightColor, true);
            }

            switch (prevCfg.blame.annotation.highlight) {
                case 'none':
                    await cfg.update('blame.file.lineHighlight.enabled', false);
                    break;
                case 'gutter':
                    await cfg.update('blame.file.lineHighlight.locations', [LineHighlightLocations.Gutter, LineHighlightLocations.OverviewRuler], true);
                    break;
                case 'line':
                    await cfg.update('blame.file.lineHighlight.locations', [LineHighlightLocations.Line, LineHighlightLocations.OverviewRuler], true);
                    break;
                case 'both':
            }

            if (prevCfg.blame.annotation.dateFormat != null) {
                await cfg.update('annotations.file.gutter.dateFormat', prevCfg.blame.annotation.dateFormat, true);
                await cfg.update('annotations.line.trailing.dateFormat', prevCfg.blame.annotation.dateFormat, true);
            }
        }

        if (prevCfg.codeLens !== undefined) {
            switch (prevCfg.codeLens.visibility) {
                case 'ondemand':
                case 'off':
                    await cfg.update('codeLens.enabled', false);
            }

            switch (prevCfg.codeLens.location) {
                case 'all':
                    await cfg.update('codeLens.locations', [CodeLensLocations.Document, CodeLensLocations.Containers, CodeLensLocations.Blocks], true);
                    break;
                case 'document+containers':
                    await cfg.update('codeLens.locations', [CodeLensLocations.Document, CodeLensLocations.Containers], true);
                    break;
                case 'document':
                    await cfg.update('codeLens.locations', [CodeLensLocations.Document], true);
                    break;
            }

            if (prevCfg.codeLens.locationCustomSymbols != null) {
                await cfg.update('codeLens.customLocationSymbols', prevCfg.codeLens.locationCustomSymbols, true);
            }
        }

        if ((prevCfg.menus && prevCfg.menus.diff && prevCfg.menus.diff.enabled) === false) {
            await cfg.update('advanced.menus', {
                editorContext: {
                    blame: true,
                    copy: true,
                    details: true,
                    fileDiff: false,
                    history: true,
                    lineDiff: false,
                    remote: true
                },
                editorTitle: {
                    blame: true,
                    fileDiff: false,
                    history: true,
                    remote: true,
                    status: true
                },
                editorTitleContext: {
                    blame: true,
                    fileDiff: false,
                    history: true,
                    remote: true
                },
                explorerContext: {
                    fileDiff: false,
                    history: true,
                    remote: true
                }
            }, true);
        }

        switch (prevCfg.statusBar && prevCfg.statusBar.date) {
            case 'off':
                await cfg.update('statusBar.format', '${author}', true);
                break;
            case 'absolute':
                await cfg.update('statusBar.format', '${author}, ${date}', true);
                break;
        }
    }
    catch (ex) {
        Logger.error(ex, 'migrateSettings');
    }
    finally {
        window.showInformationMessage(`GitLens v4 adds many new settings and removes a few old ones, so please review your settings to ensure they are configured properly.`);
    }
}

async function notifyOnNewGitLensVersion(context: ExtensionContext, version: string) {
    if (context.globalState.get(SuppressedKeys.UpdateNotice, false)) return;

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);

    if (previousVersion === undefined) {
        Logger.log(`GitLens first-time install`);
        await Messages.showWelcomeMessage();
        return;
    }

    Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);

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