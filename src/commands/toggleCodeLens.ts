import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

@command()
export class ToggleCodeLensCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.toggleCodeLens');
	}

	execute(): void {
		this.container.codeLens.toggleCodeLens();
	}
}
