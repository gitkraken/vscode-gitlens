'use strict';
export * from './ui/config';

import {
    ConfigurationChangeEvent,
    ConfigurationTarget,
    Event,
    EventEmitter,
    ExtensionContext,
    Uri,
    workspace
} from 'vscode';
import { CommandContext, extensionId, setCommandContext } from './constants';
import { Container } from './container';
import { clearGravatarCache } from './git/gitService';
import { Functions } from './system';
import { Config, KeyMap } from './ui/config';

const emptyConfig: any = new Proxy<any>({} as Config, {
    get(target, propKey, receiver) {
        return emptyConfig;
    }
});

export class Configuration {
    static configure(context: ExtensionContext) {
        context.subscriptions.push(
            workspace.onDidChangeConfiguration(configuration.onConfigurationChanged, configuration)
        );
    }

    private _onDidChange = new EventEmitter<ConfigurationChangeEvent>();
    get onDidChange(): Event<ConfigurationChangeEvent> {
        return this._onDidChange.event;
    }

    private readonly _configAffectedByMode: string[];

    constructor() {
        this._configAffectedByMode = [
            `gitlens.${this.name('mode').value}`,
            `gitlens.${this.name('modes').value}`,
            `gitlens.${this.name('codeLens').value}`,
            `gitlens.${this.name('currentLine').value}`,
            `gitlens.${this.name('hovers').value}`,
            `gitlens.${this.name('statusBar').value}`,
            `gitlens.${this.name('views')('fileHistory').value}`,
            `gitlens.${this.name('views')('lineHistory').value}`,
            `gitlens.${this.name('views')('repositories').value}`,
            `gitlens.${this.name('views')('results').value}`
        ];
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (!e.affectsConfiguration(extensionId, null!)) return;

        Container.resetConfig();

        if (configuration.changed(e, configuration.name('defaultGravatarsStyle').value)) {
            clearGravatarCache();
        }

        const section = configuration.name('keymap').value;
        if (configuration.changed(e, section)) {
            setCommandContext(CommandContext.KeyMap, this.get<KeyMap>(section));
        }

        if (
            configuration.changed(e, configuration.name('mode').value) ||
            configuration.changed(e, configuration.name('modes').value)
        ) {
            const original = e.affectsConfiguration;
            e = {
                ...e,
                affectsConfiguration: (section: string, resource?: Uri) => {
                    if (this._configAffectedByMode.some(n => section.startsWith(n))) {
                        return true;
                    }

                    return original(section, resource);
                }
            } as ConfigurationChangeEvent;
        }

        this._onDidChange.fire(e);
    }

    readonly initializingChangeEvent: ConfigurationChangeEvent = {
        affectsConfiguration: (section: string, resource?: Uri) => false
    };

    get<T>(section?: string, resource?: Uri | null, defaultValue?: T) {
        return defaultValue === undefined
            ? workspace
                  .getConfiguration(section === undefined ? undefined : extensionId, resource!)
                  .get<T>(section === undefined ? extensionId : section)!
            : workspace
                  .getConfiguration(section === undefined ? undefined : extensionId, resource!)
                  .get<T>(section === undefined ? extensionId : section, defaultValue)!;
    }

    changed(e: ConfigurationChangeEvent, section: string, resource?: Uri | null) {
        return e.affectsConfiguration(`${extensionId}.${section}`, resource!);
    }

    initializing(e: ConfigurationChangeEvent) {
        return e === this.initializingChangeEvent;
    }

    inspect(section?: string, resource?: Uri | null) {
        return workspace
            .getConfiguration(section === undefined ? undefined : extensionId, resource!)
            .inspect(section === undefined ? extensionId : section);
    }

    async migrate<TFrom, TTo>(
        from: string,
        to: string,
        options: { fallbackValue?: TTo; migrationFn?(value: TFrom): TTo } = {}
    ): Promise<boolean> {
        const inspection = configuration.inspect(from);
        if (inspection === undefined) return false;

        let migrated = false;
        if (inspection.globalValue !== undefined) {
            await this.update(
                to,
                options.migrationFn ? options.migrationFn(inspection.globalValue as TFrom) : inspection.globalValue,
                ConfigurationTarget.Global
            );
            migrated = true;
            // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
            // if (from !== to) {
            //     try {
            //         await this.update(from, undefined, ConfigurationTarget.Global);
            //     }
            //     catch { }
            // }
        }

        if (inspection.workspaceValue !== undefined) {
            await this.update(
                to,
                options.migrationFn
                    ? options.migrationFn(inspection.workspaceValue as TFrom)
                    : inspection.workspaceValue,
                ConfigurationTarget.Workspace
            );
            migrated = true;
            // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
            // if (from !== to) {
            //     try {
            //         await this.update(from, undefined, ConfigurationTarget.Workspace);
            //     }
            //     catch { }
            // }
        }

        if (inspection.workspaceFolderValue !== undefined) {
            await this.update(
                to,
                options.migrationFn
                    ? options.migrationFn(inspection.workspaceFolderValue as TFrom)
                    : inspection.workspaceFolderValue,
                ConfigurationTarget.WorkspaceFolder
            );
            migrated = true;
            // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
            // if (from !== to) {
            //     try {
            //         await this.update(from, undefined, ConfigurationTarget.WorkspaceFolder);
            //     }
            //     catch { }
            // }
        }

        if (!migrated && options.fallbackValue !== undefined) {
            await this.update(to, options.fallbackValue, ConfigurationTarget.Global);
            migrated = true;
        }

        return migrated;
    }

    async migrateIfMissing<TFrom, TTo>(from: string, to: string, options: { migrationFn?(value: TFrom): TTo } = {}) {
        const fromInspection = configuration.inspect(from);
        if (fromInspection === undefined) return;

        const toInspection = configuration.inspect(to);
        if (fromInspection.globalValue !== undefined) {
            if (toInspection === undefined || toInspection.globalValue === undefined) {
                await this.update(
                    to,
                    options.migrationFn
                        ? options.migrationFn(fromInspection.globalValue as TFrom)
                        : fromInspection.globalValue,
                    ConfigurationTarget.Global
                );
                // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
                // if (from !== to) {
                //     try {
                //         await this.update(from, undefined, ConfigurationTarget.Global);
                //     }
                //     catch { }
                // }
            }
        }

        if (fromInspection.workspaceValue !== undefined) {
            if (toInspection === undefined || toInspection.workspaceValue === undefined) {
                await this.update(
                    to,
                    options.migrationFn
                        ? options.migrationFn(fromInspection.workspaceValue as TFrom)
                        : fromInspection.workspaceValue,
                    ConfigurationTarget.Workspace
                );
                // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
                // if (from !== to) {
                //     try {
                //         await this.update(from, undefined, ConfigurationTarget.Workspace);
                //     }
                //     catch { }
                // }
            }
        }

        if (fromInspection.workspaceFolderValue !== undefined) {
            if (toInspection === undefined || toInspection.workspaceFolderValue === undefined) {
                await this.update(
                    to,
                    options.migrationFn
                        ? options.migrationFn(fromInspection.workspaceFolderValue as TFrom)
                        : fromInspection.workspaceFolderValue,
                    ConfigurationTarget.WorkspaceFolder
                );
                // Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
                // if (from !== to) {
                //     try {
                //         await this.update(from, undefined, ConfigurationTarget.WorkspaceFolder);
                //     }
                //     catch { }
                // }
            }
        }
    }

    name<K extends keyof Config>(name: K) {
        return Functions.propOf(emptyConfig as Config, name);
    }

    update(section: string, value: any, target: ConfigurationTarget, resource?: Uri | null) {
        return workspace
            .getConfiguration(extensionId, target === ConfigurationTarget.Global ? undefined : resource!)
            .update(section, value, target);
    }

    async updateEffective(section: string, value: any, resource: Uri | null = null) {
        const inspect = await configuration.inspect(section, resource)!;
        if (inspect.workspaceFolderValue !== undefined) {
            if (value === inspect.workspaceFolderValue) return;

            return await configuration.update(section, value, ConfigurationTarget.WorkspaceFolder, resource);
        }

        if (inspect.workspaceValue !== undefined) {
            if (value === inspect.workspaceValue) return;

            return await configuration.update(section, value, ConfigurationTarget.Workspace);
        }

        if (inspect.globalValue === value || (inspect.globalValue === undefined && value === inspect.defaultValue)) {
            return;
        }

        return await configuration.update(
            section,
            value === inspect.defaultValue ? undefined : value,
            ConfigurationTarget.Global
        );
    }
}

export const configuration = new Configuration();
