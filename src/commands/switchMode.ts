import { ConfigurationTarget } from 'vscode';
import type { Container } from '../container.js';
import { showModePicker } from '../quickpicks/modePicker.js';
import { command } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { debug } from '../system/decorators/log.js';
import { getScopedLogger } from '../system/logger.scope.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class SwitchModeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.switchMode');
	}

	@debug({ args: false, onlyExit: true, timing: false })
	async execute(): Promise<void> {
		const scope = getScopedLogger();

		const pick = await showModePicker();
		if (pick === undefined) return;

		scope?.addExitInfo(`mode=${pick.key ?? ''}`);

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
		super('gitlens.toggleReviewMode');
	}

	@debug({ args: false, onlyExit: true, timing: false })
	async execute(): Promise<void> {
		const modes = configuration.get('modes');
		if (modes == null || !Object.keys(modes).includes('review')) return;

		const mode = configuration.get('mode.active') === 'review' ? undefined : 'review';
		await configuration.update('mode.active', mode, ConfigurationTarget.Global);
	}
}

@command()
export class ToggleZenModeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.toggleZenMode');
	}

	@debug({ args: false, onlyExit: true, timing: false })
	async execute(): Promise<void> {
		const modes = configuration.get('modes');
		if (modes == null || !Object.keys(modes).includes('zen')) return;

		const mode = configuration.get('mode.active') === 'zen' ? undefined : 'zen';
		await configuration.update('mode.active', mode, ConfigurationTarget.Global);
	}
}
