'use strict';
import { ConfigurationTarget } from 'vscode';
import { configuration } from '../configuration';
import { Container } from '../container';
import { ModesQuickPick } from '../quickpicks';
import { command, Command, Commands } from './common';

@command()
export class SwitchModeCommand extends Command {
    constructor() {
        super(Commands.SwitchMode);
    }

    async execute() {
        const pick = await ModesQuickPick.show();
        if (pick === undefined) return;

        const active = Container.config.mode.active;
        if (active === pick.key) return;

        // Check if we have applied any annotations and clear them if we won't be applying them again
        if (active != null && active.length !== 0) {
            const activeAnnotations = Container.config.modes[active].annotations;
            if (activeAnnotations != null) {
                const newAnnotations = pick.key != null ? Container.config.modes[pick.key].annotations : undefined;
                if (activeAnnotations !== newAnnotations) {
                    await Container.fileAnnotations.clearAll();
                }
            }
        }

        await configuration.update(configuration.name('mode')('active').value, pick.key, ConfigurationTarget.Global);
    }
}

@command()
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

@command()
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
