'use strict';

export const applicationInsightsKey = 'a9c302f8-6483-4d01-b92c-c159c799c679';
export const extensionId = 'gitlens';
export const extensionOutputChannelName = 'GitLens';
export const extensionTerminalName = 'GitLens';
export const qualifiedExtensionId = `eamodio.${extensionId}`;

import { Versions } from './system';
import { commands, ExtensionContext, extensions, window, workspace } from 'vscode';
import { CodeLensLanguageScope, CodeLensScopes, configuration, Configuration, HighlightLocations, IConfig, IMenuConfig, KeyMap, OutputLevel } from './configuration';
import { CommandContext, GlobalState, setCommandContext } from './constants';
import { Commands, configureCommands } from './commands';
import { Container } from './container';
import { GitService } from './gitService';
import { Logger } from './logger';
import { Messages } from './messages';
// import { Telemetry } from './telemetry';

interface GitApi {
    getGitPath(): Promise<string>;
}

export async function activate(context: ExtensionContext) {
    const start = process.hrtime();

    Logger.configure(context);

    const gitlens = extensions.getExtension(qualifiedExtensionId)!;
    const gitlensVersion = gitlens.packageJSON.version;

    const enabled = workspace.getConfiguration('git', null!).get<boolean>('enabled', true);
    if (!enabled) {
        Logger.log(`GitLens(v${gitlensVersion}) was NOT activated -- "git.enabled": false`);
        setCommandContext(CommandContext.Enabled, enabled);

        Messages.showGitDisabledErrorMessage();

        return;
    }

    Configuration.configure(context);

    const previousVersion = context.globalState.get<string>(GlobalState.GitLensVersion);
    await migrateSettings(context, previousVersion);

    const cfg = configuration.get<IConfig>();

    try {
        let gitPath = cfg.advanced.git;
        if (!gitPath) {
            // Try to use the same git as the built-in vscode git extension
            try {
                const gitExtension = extensions.getExtension('vscode.git');
                if (gitExtension !== undefined) {
                    gitPath = await (gitExtension.exports as GitApi).getGitPath();
                }
            }
            catch { }
        }

        await GitService.initialize(gitPath || workspace.getConfiguration('git').get<string>('path'));
    }
    catch (ex) {
        Logger.error(ex, `GitLens(v${gitlensVersion}).activate`);
        if (ex.message.includes('Unable to find git')) {
            await window.showErrorMessage(`GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that '${extensionId}.${configuration.name('advanced')('git').value}' is pointed to its installed location.`);
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
    showWelcomePage(gitlensVersion, previousVersion);
    Messages.showKeyBindingsInfoMessage();

    context.globalState.update(GlobalState.GitLensVersion, gitlensVersion);

    // Constantly over my data cap so stop collecting initialized event
    // Telemetry.trackEvent('initialized', Objects.flatten(cfg, 'config', true));

    const duration = process.hrtime(start);
    Logger.log(`GitLens(v${gitlensVersion}) activated in ${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms`);
}

export function deactivate() { }

async function migrateSettings(context: ExtensionContext, previousVersion: string | undefined) {
    if (previousVersion === undefined) return;

    const previous = Versions.fromString(previousVersion);

    try {
        if (Versions.compare(previous, Versions.from(7, 5, 10)) !== 1) {
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
            await configuration.migrate<{ customSymbols?: string[], language: string | undefined, locations: CodeLensScopes[] }[], CodeLensLanguageScope[]>(
                'codeLens.perLanguageLocations', configuration.name('codeLens')('scopesByLanguage').value, {
                    migrationFn: v => {
                        const scopes = v.map(ls => {
                            return {
                                language: ls.language,
                                scopes: ls.locations,
                                symbolScopes: ls.customSymbols
                            };
                        });
                        return scopes;
                    }
                });
            await configuration.migrate('codeLens.customLocationSymbols', configuration.name('codeLens')('symbolScopes').value);

            await configuration.migrate('annotations.line.trailing.dateFormat', configuration.name('currentLine')('dateFormat').value);
            await configuration.migrate('blame.line.enabled', configuration.name('currentLine')('enabled').value);
            await configuration.migrate('annotations.line.trailing.format', configuration.name('currentLine')('format').value);

            await configuration.migrate('annotations.file.gutter.hover.changes', configuration.name('hovers')('annotations')('changes').value);
            await configuration.migrate('annotations.file.gutter.hover.details', configuration.name('hovers')('annotations')('details').value);
            await configuration.migrate('annotations.file.gutter.hover.details', configuration.name('hovers')('annotations')('enabled').value);
            await configuration.migrate<boolean, 'line' | 'annotation'>(
                'annotations.file.gutter.hover.wholeLine', configuration.name('hovers')('annotations')('over').value,
                { migrationFn: v => v ? 'line' : 'annotation' });

            await configuration.migrate('annotations.line.trailing.hover.changes', configuration.name('hovers')('currentLine')('changes').value);
            await configuration.migrate('annotations.line.trailing.hover.details', configuration.name('hovers')('currentLine')('details').value);
            await configuration.migrate('blame.line.enabled', configuration.name('hovers')('currentLine')('enabled').value);
            await configuration.migrate<boolean, 'line' | 'annotation'>(
                'annotations.line.trailing.hover.wholeLine', configuration.name('hovers')('currentLine')('over').value,
                { migrationFn: v => v ? 'line' : 'annotation' });

            await configuration.migrate('gitExplorer.gravatars', configuration.name('explorers')('avatars').value);
            await configuration.migrate('gitExplorer.commitFileFormat', configuration.name('explorers')('commitFileFormat').value);
            await configuration.migrate('gitExplorer.commitFormat', configuration.name('explorers')('commitFormat').value);
            await configuration.migrate('gitExplorer.stashFileFormat', configuration.name('explorers')('stashFileFormat').value);
            await configuration.migrate('gitExplorer.stashFormat', configuration.name('explorers')('stashFormat').value);
            await configuration.migrate('gitExplorer.statusFileFormat', configuration.name('explorers')('statusFileFormat').value);

            await configuration.migrate('recentChanges.file.lineHighlight.locations', configuration.name('recentChanges')('highlight')('locations').value);
        }

        if (Versions.compare(previous, Versions.from(8, 0, 0, 'beta2')) !== 1) {
            await configuration.migrate<boolean, OutputLevel>(
                'debug', configuration.name('outputLevel').value,
                { migrationFn: v => v ? OutputLevel.Debug : configuration.get<OutputLevel>(configuration.name('outputLevel').value) });
            await configuration.migrate('debug', configuration.name('debug').value, { migrationFn: v => undefined });
        }

        if (Versions.compare(previous, Versions.from(8, 0, 0, 'rc')) !== 1) {
            let section = configuration.name('blame')('highlight')('locations').value;
            await configuration.migrate<('gutter' | 'line' | 'overviewRuler')[], HighlightLocations[]>(section, section, {
                migrationFn: v => {
                    const index = v.indexOf('overviewRuler');
                    if (index !== -1) {
                        v.splice(index, 1, 'overview' as 'overviewRuler');
                    }
                    return v as HighlightLocations[];
                }
            });

            section = configuration.name('recentChanges')('highlight')('locations').value;
            await configuration.migrate<('gutter' | 'line' | 'overviewRuler')[], HighlightLocations[]>(section, section, {
                migrationFn: v => {
                    const index = v.indexOf('overviewRuler');
                    if (index !== -1) {
                        v.splice(index, 1, 'overview' as 'overviewRuler');
                    }
                    return v as HighlightLocations[];
                }
            });
        }

        if (Versions.compare(previous, Versions.from(8, 0, 0)) !== 1) {
            await configuration.migrateIfMissing('annotations.file.gutter.gravatars', configuration.name('blame')('avatars').value);
            await configuration.migrateIfMissing('annotations.file.gutter.compact', configuration.name('blame')('compact').value);
            await configuration.migrateIfMissing('annotations.file.gutter.dateFormat', configuration.name('blame')('dateFormat').value);
            await configuration.migrateIfMissing('annotations.file.gutter.format', configuration.name('blame')('format').value);
            await configuration.migrateIfMissing('annotations.file.gutter.heatmap.enabled', configuration.name('blame')('heatmap')('enabled').value);
            await configuration.migrateIfMissing('annotations.file.gutter.heatmap.location', configuration.name('blame')('heatmap')('location').value);
            await configuration.migrateIfMissing('annotations.file.gutter.lineHighlight.enabled', configuration.name('blame')('highlight')('enabled').value);
            await configuration.migrateIfMissing('annotations.file.gutter.lineHighlight.locations', configuration.name('blame')('highlight')('locations').value);
            await configuration.migrateIfMissing('annotations.file.gutter.separateLines', configuration.name('blame')('separateLines').value);

            await configuration.migrateIfMissing('codeLens.locations', configuration.name('codeLens')('scopes').value);
            await configuration.migrateIfMissing<{ customSymbols?: string[], language: string | undefined, locations: CodeLensScopes[] }[], CodeLensLanguageScope[]>(
                'codeLens.perLanguageLocations', configuration.name('codeLens')('scopesByLanguage').value, {
                    migrationFn: v => {
                        const scopes = v.map(ls => {
                            return {
                                language: ls.language,
                                scopes: ls.locations,
                                symbolScopes: ls.customSymbols
                            };
                        });
                        return scopes;
                    }
                });
            await configuration.migrateIfMissing('codeLens.customLocationSymbols', configuration.name('codeLens')('symbolScopes').value);

            await configuration.migrateIfMissing('annotations.line.trailing.dateFormat', configuration.name('currentLine')('dateFormat').value);
            await configuration.migrateIfMissing('blame.line.enabled', configuration.name('currentLine')('enabled').value);
            await configuration.migrateIfMissing('annotations.line.trailing.format', configuration.name('currentLine')('format').value);

            await configuration.migrateIfMissing('annotations.file.gutter.hover.changes', configuration.name('hovers')('annotations')('changes').value);
            await configuration.migrateIfMissing('annotations.file.gutter.hover.details', configuration.name('hovers')('annotations')('details').value);
            await configuration.migrateIfMissing('annotations.file.gutter.hover.details', configuration.name('hovers')('annotations')('enabled').value);
            await configuration.migrateIfMissing<boolean, 'line' | 'annotation'>(
                'annotations.file.gutter.hover.wholeLine', configuration.name('hovers')('annotations')('over').value,
                { migrationFn: v => v ? 'line' : 'annotation' });

            await configuration.migrateIfMissing('annotations.line.trailing.hover.changes', configuration.name('hovers')('currentLine')('changes').value);
            await configuration.migrateIfMissing('annotations.line.trailing.hover.details', configuration.name('hovers')('currentLine')('details').value);
            await configuration.migrateIfMissing('blame.line.enabled', configuration.name('hovers')('currentLine')('enabled').value);
            await configuration.migrateIfMissing<boolean, 'line' | 'annotation'>(
                'annotations.line.trailing.hover.wholeLine', configuration.name('hovers')('currentLine')('over').value,
                { migrationFn: v => v ? 'line' : 'annotation' });

            await configuration.migrateIfMissing('gitExplorer.gravatars', configuration.name('explorers')('avatars').value);
            await configuration.migrateIfMissing('gitExplorer.commitFileFormat', configuration.name('explorers')('commitFileFormat').value);
            await configuration.migrateIfMissing('gitExplorer.commitFormat', configuration.name('explorers')('commitFormat').value);
            await configuration.migrateIfMissing('gitExplorer.stashFileFormat', configuration.name('explorers')('stashFileFormat').value);
            await configuration.migrateIfMissing('gitExplorer.stashFormat', configuration.name('explorers')('stashFormat').value);
            await configuration.migrateIfMissing('gitExplorer.statusFileFormat', configuration.name('explorers')('statusFileFormat').value);

            await configuration.migrateIfMissing('recentChanges.file.lineHighlight.locations', configuration.name('recentChanges')('highlight')('locations').value);
        }

        if (Versions.compare(previous, Versions.from(8, 0, 2)) !== 1) {
            const section = configuration.name('keymap').value;
            await configuration.migrate<'standard' | 'chorded' | 'none', KeyMap>(section, section, {
                fallbackValue: KeyMap.Alternate,
                migrationFn: v => v === 'standard' ? KeyMap.Alternate : v as KeyMap
            });
        }

        if (Versions.compare(previous, Versions.from(8, 2, 4)) !== 1) {
            await configuration.migrate<{
                explorerContext: {
                    fileDiff: boolean,
                    history: boolean,
                    remote: boolean
                },
                editorContext: {
                    blame: boolean,
                    copy: boolean,
                    details: boolean,
                    fileDiff: boolean,
                    history: boolean,
                    lineDiff: boolean,
                    remote: boolean
                },
                editorTitle: {
                    blame: boolean,
                    fileDiff: boolean,
                    history: boolean,
                    remote: boolean,
                    status: boolean
                },
                editorTitleContext: {
                    blame: boolean,
                    fileDiff: boolean,
                    history: boolean,
                    remote: boolean
                }
            },
                IMenuConfig>(
                    'advanced.menus', configuration.name('menus').value, {
                    migrationFn: m => {
                        return {
                            editor: {
                                blame: !!m.editorContext.blame,
                                clipboard: !!m.editorContext.copy,
                                compare: !!m.editorContext.lineDiff,
                                details: !!m.editorContext.details,
                                history: !!m.editorContext.history,
                                remote: !!m.editorContext.remote
                            },
                            editorGroup: {
                                blame: !!m.editorTitle.blame,
                                compare: !!m.editorTitle.fileDiff,
                                history: !!m.editorTitle.history,
                                remote: !!m.editorTitle.remote
                            },
                            editorTab: {
                                compare: !!m.editorTitleContext.fileDiff,
                                history: !!m.editorTitleContext.history,
                                remote: !!m.editorTitleContext.remote
                            },
                            explorer: {
                                compare: !!m.explorerContext.fileDiff,
                                history: !!m.explorerContext.history,
                                remote: !!m.explorerContext.remote
                            }
                        } as IMenuConfig;
                    }
                });
        }
    }
    catch (ex) {
        Logger.error(ex, 'migrateSettings');
    }
}

function notifyOnUnsupportedGitVersion(version: string) {
    if (GitService.compareGitVersion('2.2.0') !== -1) return;

    // If git is less than v2.2.0
    Messages.showGitVersionUnsupportedErrorMessage(version);
}

async function showWelcomePage(version: string, previousVersion: string | undefined) {
    if (previousVersion === undefined) {
        Logger.log(`GitLens first-time install`);

        if (Container.config.showWhatsNewAfterUpgrades) {
            await commands.executeCommand(Commands.ShowWelcomePage);
        }

        return;
    }

    if (previousVersion !== version) {
        Logger.log(`GitLens upgraded from v${previousVersion} to v${version}`);

        if (Versions.compare(Versions.fromString(previousVersion), Versions.from(8, 0, 0)) === 0) {
            await commands.executeCommand(Commands.ShowWelcomePage);

            return;
        }
    }

    if (!Container.config.showWhatsNewAfterUpgrades) return;

    const [major, minor] = version.split('.');
    const [prevMajor, prevMinor] = previousVersion.split('.');
    if (major === prevMajor && minor === prevMinor) return;
    // Don't notify on downgrades
    if (major < prevMajor || (major === prevMajor && minor < prevMinor)) return;

    await commands.executeCommand(Commands.ShowWelcomePage);
}
