import { ConfigurationTarget } from 'vscode';
import { configuration } from '../configuration';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { ModePicker } from '../quickpicks/modePicker';
import { command } from '../system/command';
import { log } from '../system/decorators/log';
import { Command } from './base';

@command()
export class SwitchModeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.SwitchMode);
	}

	@log({ args: false, correlate: true, singleLine: true, timed: false })
	async execute() {
		const cc = Logger.getCorrelationContext();

		const pick = await ModePicker.show();
		if (pick === undefined) return;

		if (cc != null) {
			cc.exitDetails = ` \u2014 mode=${pick.key ?? ''}`;
		}

		const active = this.container.config.mode.active;
		if (active === pick.key) return;

		// Check if we have applied any annotations and clear them if we won't be applying them again
		if (active != null && active.length !== 0) {
			const activeAnnotations = this.container.config.modes?.[active].annotations;
			if (activeAnnotations != null) {
				const newAnnotations =
					pick.key != null ? this.container.config.modes?.[pick.key].annotations : undefined;
				if (activeAnnotations !== newAnnotations) {
					await this.container.fileAnnotations.clearAll();
				}
			}
		}

		await configuration.update('mode.active', pick.key, ConfigurationTarget.Global);
	}
}

@command()
export class ToggleReviewModeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ToggleReviewMode);
	}

	@log({ args: false, singleLine: true, timed: false })
	async execute() {
		if (this.container.config.modes == null || !Object.keys(this.container.config.modes).includes('review')) {
			return;
		}

		const mode = this.container.config.mode.active === 'review' ? undefined : 'review';
		await configuration.update('mode.active', mode, ConfigurationTarget.Global);
	}
}

@command()
export class ToggleZenModeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ToggleZenMode);
	}

	@log({ args: false, singleLine: true, timed: false })
	async execute() {
		if (this.container.config.modes == null || !Object.keys(this.container.config.modes).includes('zen')) {
			return;
		}

		const mode = this.container.config.mode.active === 'zen' ? undefined : 'zen';
		await configuration.update('mode.active', mode, ConfigurationTarget.Global);
	}
}
