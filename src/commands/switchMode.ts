import { ConfigurationTarget } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { showModePicker } from '../quickpicks/modePicker';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { log } from '../system/decorators/log';
import { getLogScope } from '../system/logger.scope';
import { Command } from './base';

@command()
export class SwitchModeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.SwitchMode);
	}

	@log({ args: false, scoped: true, singleLine: true, timed: false })
	async execute() {
		const scope = getLogScope();

		const pick = await showModePicker();
		if (pick === undefined) return;

		if (scope != null) {
			scope.exitDetails = ` \u2014 mode=${pick.key ?? ''}`;
		}

		const active = configuration.get('mode.active');
		if (active === pick.key) return;

		// Check if we have applied any annotations and clear them if we won't be applying them again
		if (active != null && active.length !== 0) {
			const modes = configuration.get('modes');
			const activeAnnotations = modes?.[active].annotations;
			if (activeAnnotations != null) {
				const newAnnotations = pick.key != null ? modes?.[pick.key].annotations : undefined;
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
		const modes = configuration.get('modes');
		if (modes == null || !Object.keys(modes).includes('review')) return;

		const mode = configuration.get('mode.active') === 'review' ? undefined : 'review';
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
		const modes = configuration.get('modes');
		if (modes == null || !Object.keys(modes).includes('zen')) return;

		const mode = configuration.get('mode.active') === 'zen' ? undefined : 'zen';
		await configuration.update('mode.active', mode, ConfigurationTarget.Global);
	}
}
