'use strict';
import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { Container } from '../container';
import { GlyphChars } from '../constants';

export interface ModesQuickPickItem extends QuickPickItem {
    key: string | undefined;
}

export class ModesQuickPick {

    static async show(): Promise<ModesQuickPickItem | undefined> {
        const modes = Object.keys(Container.config.modes);
        if (modes.length === 0) return undefined;

        const mode = Container.config.mode.active;

        const items = modes.map(key => {
            const modeCfg = Container.config.modes[key];
            return {
                label: `${mode === key ? '$(check)\u00a0\u00a0' : '\u00a0\u00a0\u00a0\u00a0\u00a0'}${modeCfg.name} mode`,
                description: modeCfg.description ? `\u00a0${GlyphChars.Dash}\u00a0 ${modeCfg.description}` : '',
                key: key
            } as ModesQuickPickItem;
        });

        if (mode) {
            items.splice(0, 0, {
                label: `Exit ${Container.config.modes[mode].name} mode`,
                key: undefined
            } as ModesQuickPickItem);
        }

        const pick = await window.showQuickPick(items, {
            placeHolder: 'select a GitLens mode to enter'
        } as QuickPickOptions);

        return pick;
    }
}