import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';

@command()
export class ShowOutputChannelCommand extends GlCommandBase {
	constructor() {
		super('gitlens.showOutputChannel');
	}

	execute(): void {
		Logger.showOutputChannel();
	}
}
