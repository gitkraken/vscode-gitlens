'use strict';
import { ConfigurationTarget } from 'vscode';
import { Command, Commands } from './common';
import { configuration } from '../configuration';
import { Container } from '../container';
import { ModesQuickPick } from '../quickPicks/quickPicks';

export class SwitchModeCommand extends Command {

    constructor() {
        super(Commands.SwitchMode);
    }

    async execute() {
        const pick = await ModesQuickPick.show();
        if (pick === undefined) return;

        await configuration.update(configuration.name('mode')('active').value, pick.key, ConfigurationTarget.Global);
    }
}

export class ToggleReviewModeCommand extends Command {

    constructor() {
        super(Commands.ToggleReviewMode);
    }

    async execute() {
        if (!Object.keys(Container.config.modes).includes('review')) return;

        const mode = Container.config.mode.active === 'review' ? undefined : 'review';
        await configuration.update(configuration.name('mode')('active').value, mode, ConfigurationTarget.Global);
    }
}

export class ToggleZenModeCommand extends Command {

    constructor() {
        super(Commands.ToggleZenMode);
    }

    async execute() {
        if (!Object.keys(Container.config.modes).includes('zen')) return;

        const mode = Container.config.mode.active === 'zen' ? undefined : 'zen';
        await configuration.update(configuration.name('mode')('active').value, mode, ConfigurationTarget.Global);
    }
}
