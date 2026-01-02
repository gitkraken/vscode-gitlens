import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class ToggleCodeLensCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.toggleCodeLens');
	}

	execute(): void {
		this.container.codeLens.toggleCodeLens();
	}
}
