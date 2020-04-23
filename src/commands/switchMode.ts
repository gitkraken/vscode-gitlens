'use strict';
import { ConfigurationTarget } from 'vscode';
import { command, Command, Commands } from './common';
import { configuration } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';
import { ModePicker } from '../quickpicks';
import { log } from '../system';

@command()
export class SwitchModeCommand extends Command {
	constructor() {
		super(Commands.SwitchMode);
	}

	@log({ args: false, correlate: true, singleLine: true, timed: false })
	async execute() {
		const cc = Logger.getCorrelationContext();

		const pick = await ModePicker.show();
		if (pick === undefined) return;

		if (cc) {
			cc.exitDetails = ` \u2014 mode=${pick.key || ''}`;
		}

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

		await configuration.update('mode', 'active', pick.key, ConfigurationTarget.Global);
	}
}

@command()
export class ToggleReviewModeCommand extends Command {
	constructor() {
		super(Commands.ToggleReviewMode);
	}

	@log({ args: false, singleLine: true, timed: false })
	async execute() {
		if (!Object.keys(Container.config.modes).includes('review')) return;

		const mode = Container.config.mode.active === 'review' ? undefined : 'review';
		await configuration.update('mode', 'active', mode, ConfigurationTarget.Global);
	}
}

@command()
export class ToggleZenModeCommand extends Command {
	constructor() {
		super(Commands.ToggleZenMode);
	}

	@log({ args: false, singleLine: true, timed: false })
	async execute() {
		if (!Object.keys(Container.config.modes).includes('zen')) return;

		const mode = Container.config.mode.active === 'zen' ? undefined : 'zen';
		await configuration.update('mode', 'active', mode, ConfigurationTarget.Global);
	}
}
