import { ConfigurationTarget } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { showModePicker } from '../quickpicks/modePicker';
import { log } from '../system/decorators/log';
import { getLogScope, setLogScopeExit } from '../system/logger.scope';
import { command } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { GlCommandBase } from './base';

@command()
export class SwitchModeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.SwitchMode);
	}

	@log({ args: false, scoped: true, singleLine: true, timed: false })
	async execute() {
		const scope = getLogScope();

		const pick = await showModePicker();
		if (pick === undefined) return;

		setLogScopeExit(scope, ` \u2022 mode=${pick.key ?? ''}`);

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
export class ToggleReviewModeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ToggleReviewMode);
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
export class ToggleZenModeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ToggleZenMode);
	}

	@log({ args: false, singleLine: true, timed: false })
	async execute() {
		const modes = configuration.get('modes');
		if (modes == null || !Object.keys(modes).includes('zen')) return;

		const mode = configuration.get('mode.active') === 'zen' ? undefined : 'zen';
		await configuration.update('mode.active', mode, ConfigurationTarget.Global);
	}
}
