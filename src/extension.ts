'use strict';
import { Objects, Versions } from './system';
import { ConfigurationTarget, ExtensionContext, extensions, languages, window, workspace } from 'vscode';
import { configuration, Configuration, IConfig } from './configuration';
import { CommandContext, ExtensionKey, GlobalState, QualifiedExtensionId, setCommandContext } from './constants';
import { configureCommands } from './commands';
import { Container } from './container';
import { GitContentProvider } from './gitContentProvider';
import { GitRevisionCodeLensProvider } from './gitRevisionCodeLensProvider';
import { GitService } from './gitService';
import { Logger } from './logger';
import { Messages, SuppressedMessages } from './messages';
// import { Telemetry } from './telemetry';

// this method is called when your extension is activated
export async function activate(context: ExtensionContext) {
    const start = process.hrtime();

    Logger.configure(context);

    const gitlens = extensions.getExtension(QualifiedExtensionId)!;
    const gitlensVersion = gitlens.packageJSON.version;

    const enabled = workspace.getConfiguration('git', null!).get<boolean>('enabled', true);
    setCommandContext(CommandContext.Enabled, enabled);

    if (!enabled) {
        Logger.log(`GitLens(v${gitlensVersion}) was NOT activated -- "git.enabled": false`);

        return;
    }

    Configuration.configure(context);

    const cfg = configuration.get<IConfig>();

    try {
        await GitService.initialize(cfg.advanced.git);
    }
    catch (ex) {
        Logger.error(ex, `GitLens(v${gitlensVersion}).activate`);
        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(`GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that '${ExtensionKey}.${configuration.name('advanced')('git').value}' is pointed to its installed location.`);
        }
        setCommandContext(CommandContext.Enabled, false);
        return;
    }

    const gitVersion = GitService.getGitVersion();

    // Telemetry.configure(ApplicationInsightsKey);

    // const telemetryContext: { [id: string]: any } = Object.create(null);
    // telemetryContext.version = gitlensVersion;
    // telemetryContext['git.version'] = gitVersion;
    // Telemetry.setContext(telemetryContext);

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);

    await migrateSettings(context, previousVersion);
    notifyOnUnsupportedGitVersion(context, gitVersion);
    notifyOnNewGitLensVersion(context, gitlensVersion, previousVersion);

    context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    Container.initialize(context, cfg);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider()));
    context.subscriptions.push(languages.registerCodeLensProvider(GitRevisionCodeLensProvider.selector, new GitRevisionCodeLensProvider()));

    context.subscriptions.push(window.registerTreeDataProvider('gitlens.gitExplorer', Container.gitExplorer));
    context.subscriptions.push(window.registerTreeDataProvider('gitlens.resultsExplorer', Container.resultsExplorer));

    configureCommands();

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

    setCommandContext(CommandContext.KeyMap, configuration.get(configuration.name('keymap').value));
    // Slightly delay enabling the explorer to not stop the rest of GitLens from being usable
    setTimeout(() => setCommandContext(CommandContext.GitExplorer, true), 1000);

    const duration = process.hrtime(start);
    Logger.log(`GitLens(v${gitlensVersion}) activated in ${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms`);
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
    if (previousVersion === undefined) return;

    const previous = Versions.fromString(previousVersion);

    try {
        if (Versions.compare(previous, Versions.from(6, 1, 2)) !== 1) {
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
                Logger.error(ex, 'migrateSettings - messages');
            }
        }

        if (Versions.compare(previous, Versions.from(7, 1, 0)) !== 1) {
            // https://github.com/eamodio/vscode-gitlens/issues/239
            const section = configuration.name('advanced')('quickPick')('closeOnFocusOut').value;
            const inspection = configuration.inspect(section);
            if (inspection !== undefined) {
                if (inspection.globalValue !== undefined) {
                    await configuration.update(section, !inspection.globalValue, ConfigurationTarget.Global);
                }
                else if (inspection.workspaceFolderValue !== undefined) {
                    await configuration.update(section, !inspection.workspaceFolderValue, ConfigurationTarget.WorkspaceFolder);
                }
            }
        }

        if (Versions.compare(previous, Versions.from(7, 3, 0, 'beta2')) !== 1) {
            const oldSection = 'advanced.maxQuickHistory';
            const inspection = configuration.inspect(oldSection);
            if (inspection !== undefined) {
                const section = configuration.name('advanced')('maxListItems').value;

                if (inspection.globalValue !== undefined) {
                    await configuration.update(section, inspection.globalValue, ConfigurationTarget.Global);
                }
                else if (inspection.workspaceFolderValue !== undefined) {
                    await configuration.update(section, inspection.workspaceFolderValue, ConfigurationTarget.WorkspaceFolder);
                }
            }
        }

        if (Versions.compare(previous, Versions.from(7, 3, 0, 'beta4')) !== 1) {
            const oldSection = 'gitExplorer.gravatarsDefault';
            const inspection = configuration.inspect(oldSection);
            if (inspection !== undefined) {
                const section = configuration.name('defaultGravatarsStyle').value;

                if (inspection.globalValue !== undefined) {
                    await configuration.update(section, inspection.globalValue, ConfigurationTarget.Global);
                }
                else if (inspection.workspaceFolderValue !== undefined) {
                    await configuration.update(section, inspection.workspaceFolderValue, ConfigurationTarget.WorkspaceFolder);
                }
            }
        }
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