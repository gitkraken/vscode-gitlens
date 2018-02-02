'use strict';
import { Objects, Versions } from './system';
import { commands, ConfigurationTarget, ExtensionContext, extensions, window, workspace } from 'vscode';
import { CodeLensLanguageScope, CodeLensScopes, configuration, Configuration, IConfig, OutputLevel } from './configuration';
import { CommandContext, ExtensionKey, GlobalState, QualifiedExtensionId, setCommandContext } from './constants';
import { Commands, configureCommands } from './commands';
import { Container } from './container';
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
    if (!enabled) {
        Logger.log(`GitLens(v${gitlensVersion}) was NOT activated -- "git.enabled": false`);
        setCommandContext(CommandContext.Enabled, enabled);

        return;
    }

    Configuration.configure(context);

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);
    await migrateSettings(context, previousVersion);

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

    Container.initialize(context, cfg);

    configureCommands();

    const gitVersion = GitService.getGitVersion();

    // Telemetry.configure(ApplicationInsightsKey);

    // const telemetryContext: { [id: string]: any } = Object.create(null);
    // telemetryContext.version = gitlensVersion;
    // telemetryContext['git.version'] = gitVersion;
    // Telemetry.setContext(telemetryContext);

    notifyOnUnsupportedGitVersion(gitVersion);
    notifyOnNewGitLensVersion(gitlensVersion, previousVersion);

    context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

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
            await configuration.migrate<boolean, boolean>(section, section, v => !v);
        }

        if (Versions.compare(previous, Versions.from(7, 3, 0, 'beta2')) !== 1) {
            await configuration.migrate('advanced.maxQuickHistory', configuration.name('advanced')('maxListItems').value);
        }

        if (Versions.compare(previous, Versions.from(7, 3, 0, 'beta4')) !== 1) {
            await configuration.migrate('gitExplorer.gravatarsDefault', configuration.name('defaultGravatarsStyle').value);
        }

        if (Versions.compare(previous, Versions.from(7, 5, 9)) !== 1) {
            await configuration.migrate('annotations.file.gutter.gravatars', configuration.name('blame')('avatars').value);
            await configuration.migrate('annotations.file.gutter.compact', configuration.name('blame')('compact').value);
            await configuration.migrate('annotations.file.gutter.dateFormat', configuration.name('blame')('dateFormat').value);
            await configuration.migrate('annotations.file.gutter.format', configuration.name('blame')('format').value);
            await configuration.migrate('annotations.file.gutter.heatmap.enabled', configuration.name('blame')('heatmap')('enabled').value);
            await configuration.migrate('annotations.file.gutter.heatmap.location', configuration.name('blame')('heatmap')('location').value);
            await configuration.migrate('annotations.file.gutter.lineHighlight.enabled', configuration.name('blame')('highlight')('enabled').value);
            await configuration.migrate('annotations.file.gutter.lineHighlight.locations', configuration.name('blame')('highlight')('locations').value);
            await configuration.migrate('annotations.file.gutter.separateLines', configuration.name('blame')('separateLines').value);

            await configuration.migrate('codeLens.locations', configuration.name('codeLens')('scopes').value);
            await configuration.migrate<{ customSymbols?: string[], language: string | undefined, locations: CodeLensScopes[] }[], CodeLensLanguageScope[]>('codeLens.perLanguageLocations', configuration.name('codeLens')('scopesByLanguage').value,
                v => {
                    const scopes = v.map(ls => {
                        return {
                            language: ls.language,
                            scopes: ls.locations,
                            symbolScopes: ls.customSymbols
                        };
                    });
                    return scopes;
                });
            await configuration.migrate('codeLens.customLocationSymbols', configuration.name('codeLens')('symbolScopes').value);

            await configuration.migrate('annotations.line.trailing.dateFormat', configuration.name('currentLine')('dateFormat').value);
            await configuration.migrate('blame.line.enabled', configuration.name('currentLine')('enabled').value);
            await configuration.migrate('annotations.line.trailing.format', configuration.name('currentLine')('format').value);

            await configuration.migrate('annotations.file.gutter.hover.changes', configuration.name('hovers')('annotations')('changes').value);
            await configuration.migrate('annotations.file.gutter.hover.details', configuration.name('hovers')('annotations')('details').value);
            await configuration.migrate('annotations.file.gutter.hover.details', configuration.name('hovers')('annotations')('enabled').value);
            await configuration.migrate<boolean, 'line' | 'annotation'>('annotations.file.gutter.hover.wholeLine', configuration.name('hovers')('annotations')('over').value, v => v ? 'line' : 'annotation');

            await configuration.migrate('annotations.line.trailing.hover.changes', configuration.name('hovers')('currentLine')('changes').value);
            await configuration.migrate('annotations.line.trailing.hover.details', configuration.name('hovers')('currentLine')('details').value);
            await configuration.migrate('blame.line.enabled', configuration.name('hovers')('currentLine')('enabled').value);
            await configuration.migrate<boolean, 'line' | 'annotation'>('annotations.line.trailing.hover.wholeLine', configuration.name('hovers')('currentLine')('over').value, v => v ? 'line' : 'annotation');

            await configuration.migrate('gitExplorer.gravatars', configuration.name('explorers')('avatars').value);
            await configuration.migrate('gitExplorer.commitFileFormat', configuration.name('explorers')('commitFileFormat').value);
            await configuration.migrate('gitExplorer.commitFormat', configuration.name('explorers')('commitFormat').value);
            await configuration.migrate('gitExplorer.stashFileFormat', configuration.name('explorers')('stashFileFormat').value);
            await configuration.migrate('gitExplorer.stashFormat', configuration.name('explorers')('stashFormat').value);
            await configuration.migrate('gitExplorer.statusFileFormat', configuration.name('explorers')('statusFileFormat').value);

            await configuration.migrate('recentChanges.file.lineHighlight.locations', configuration.name('recentChanges')('highlight')('locations').value);
        }

        if (Versions.compare(previous, Versions.from(8, 0, 0, 'beta2')) !== 1) {
            const section = configuration.name('advanced')('messages').value;
            const messages = configuration.get<{ [key: string]: boolean }>(section);
            messages[SuppressedMessages.WelcomeNotice] = false;
            await configuration.update(section, messages, ConfigurationTarget.Global);

            await configuration.migrate<boolean, OutputLevel>('debug', configuration.name('outputLevel').value, v => v ? OutputLevel.Debug : configuration.get(configuration.name('outputLevel').value));
            await configuration.migrate('debug', configuration.name('debug').value, v => undefined);
        }
    }
    catch (ex) {
        Logger.error(ex, 'migrateSettings');
    }
}

async function notifyOnNewGitLensVersion(version: string, previousVersion: string | undefined) {
    if (previousVersion === undefined) {
        Logger.log(`GitLens first-time install`);
    }
    else if (previousVersion !== version) {
        Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);
    }

    if (!Container.config.advanced.messages.suppressWelcomeNotice) {
        const section = configuration.name('advanced')('messages').value;
        const messages = configuration.get<{ [key: string]: boolean }>(section);
        messages[SuppressedMessages.WelcomeNotice] = true;
        await configuration.update(section, messages, ConfigurationTarget.Global);

        await commands.executeCommand(Commands.ShowWelcomePage);

        return;
    }

    if (previousVersion === undefined || Container.config.advanced.messages.suppressUpdateNotice) return;

    const [major, minor] = version.split('.');
    const [prevMajor, prevMinor] = previousVersion.split('.');
    if (major === prevMajor && minor === prevMinor) return;
    // Don't notify on downgrades
    if (major < prevMajor || (major === prevMajor && minor < prevMinor)) return;

    await Messages.showUpdateMessage(version);
}

async function notifyOnUnsupportedGitVersion(version: string) {
    if (GitService.validateGitVersion(2, 2)) return;

    // If git is less than v2.2.0
    await Messages.showUnsupportedGitVersionErrorMessage(version);
}