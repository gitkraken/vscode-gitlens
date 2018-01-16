'use strict';
export * from './config';
export { ExtensionKey };

import { Functions } from './system';
import { ConfigurationChangeEvent, ConfigurationTarget, Event, EventEmitter, ExtensionContext, Uri, workspace } from 'vscode';
import { IConfig, KeyMap } from './config';
import { CommandContext, ExtensionKey, setCommandContext } from './constants';
import { Container } from './container';
import { clearGravatarCache } from './gitService';

const emptyConfig: any = new Proxy<any>({} as IConfig, {
    get(target, propKey, receiver) {
        return emptyConfig;
    }
});

export class Configuration {

    static configure(context: ExtensionContext) {
        context.subscriptions.push(workspace.onDidChangeConfiguration(configuration.onConfigurationChanged, configuration));
    }

    private _onDidChange = new EventEmitter<ConfigurationChangeEvent>();
    get onDidChange(): Event<ConfigurationChangeEvent> {
        return this._onDidChange.event;
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (!e.affectsConfiguration(ExtensionKey, null!)) return;

        Container.resetConfig();

        if (configuration.changed(e, configuration.name('defaultGravatarsStyle').value)) {
            clearGravatarCache();
        }

        const section = configuration.name('keymap').value;
        if (configuration.changed(e, section)) {
            setCommandContext(CommandContext.KeyMap, this.get<KeyMap>(section));
        }

        this._onDidChange.fire(e);
    }

    readonly initializingChangeEvent: ConfigurationChangeEvent = {
        affectsConfiguration: (section: string, resource?: Uri) => false
    };

    get<T>(section?: string, resource?: Uri | null, defaultValue?: T) {
        return defaultValue === undefined
            ? workspace.getConfiguration(section === undefined ? undefined : ExtensionKey, resource!).get<T>(section === undefined ? ExtensionKey : section)!
            : workspace.getConfiguration(section === undefined ? undefined : ExtensionKey, resource!).get<T>(section === undefined ? ExtensionKey : section, defaultValue)!;
    }

    changed(e: ConfigurationChangeEvent, section: string, resource?: Uri | null) {
        return e.affectsConfiguration(`${ExtensionKey}.${section}`, resource!);
    }

    initializing(e: ConfigurationChangeEvent) {
        return e === this.initializingChangeEvent;
    }

    inspect(section?: string, resource?: Uri | null) {
        return workspace.getConfiguration(section === undefined ? undefined : ExtensionKey, resource!).inspect(section === undefined ? ExtensionKey : section);
    }

    name<K extends keyof IConfig>(name: K) {
        return Functions.propOf(emptyConfig as IConfig, name);
    }

    update(section: string, value: any, target: ConfigurationTarget) {
        return workspace.getConfiguration(ExtensionKey).update(section, value, target);
    }
}

export const configuration = new Configuration();