import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

@command()
export class RefreshHoverCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.refreshHover');
	}

	async execute(): Promise<void> {
		// TODO@eamodio figure out how to really refresh/update a hover
		await executeCoreCommand('editor.action.showHover');
	}
}
