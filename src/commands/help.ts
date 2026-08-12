import { urls } from '../constants.js';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class WhatsNewCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.whatsNew');
	}

	execute(): void {
		void openUrl(urls.releaseNotes);
	}
}

@command()
export class HelpCenterCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.helpCenter');
	}

	execute(): void {
		void openUrl(urls.helpCenter);
	}
}

@command()
export class ReportIssueCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.reportIssue');
	}

	execute(): void {
		void openUrl(urls.githubNewIssue);
	}
}

@command()
export class ShareFeedbackCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.shareFeedback');
	}

	execute(): void {
		void openUrl(urls.githubDiscussions);
	}
}
