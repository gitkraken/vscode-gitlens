import { Disposable } from 'vscode';
import type { WebviewTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { State } from './protocol';
import { SelectTermCommand } from './protocol';
import type { ChangeCloudWebviewShowingArgs } from './registration';

export class ChangeCloudWebviewProvider implements WebviewProvider<State, State, ChangeCloudWebviewShowingArgs> {
	private readonly _disposable: Disposable;

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.changeCloud'>,
	) {
		this._disposable = Disposable.from();
	}

	dispose(): void {
		this._disposable.dispose();
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	onMessageReceived(e: IpcMessage): void {
		switch (true) {
			case SelectTermCommand.is(e):
				break;
		}
	}

	includeBootstrap(_deferrable?: boolean): Promise<State> {
		return Promise.resolve({
			...this.host.baseWebviewState,
			data: {
				terms: [
					{
						term: 'Home View',
						weight: 10,
						category: 'business',
						reasoning: 'Extensive changes, performance improvements, UI updates, and new features.',
					},
					{
						term: 'Branch Card',
						weight: 9,
						category: 'business',
						reasoning: 'Significant UI/UX changes, bug fixes, and feature additions.',
					},
					{
						term: 'Launchpad',
						weight: 8,
						category: 'business',
						reasoning: 'Feature enhancements, status updates, and integration improvements.',
					},
					{
						term: 'Graph View',
						weight: 7,
						category: 'business',
						reasoning: 'Issue integration, UI updates, and new features.',
					},
					{
						term: 'Webviews',
						weight: 7,
						category: 'technical',
						reasoning: 'Extensive changes across multiple webview components.',
					},
					{
						term: 'AI Models',
						weight: 6,
						category: 'technical',
						reasoning: 'Addition of new AI model support and provider implementations.',
					},
					{
						term: 'Git Provider',
						weight: 6,
						category: 'technical',
						reasoning: 'Changes to git provider, service, and related models.',
					},
					{
						term: 'Autolinks',
						weight: 5,
						category: 'technical',
						reasoning: 'Bug fixes and improvements to autolink functionality.',
					},
					{
						term: 'Walkthroughs',
						weight: 5,
						category: 'business',
						reasoning: 'Updates to onboarding and walkthrough content.',
					},
					{
						term: 'Dependencies',
						weight: 4,
						category: 'technical',
						reasoning: 'Dependency updates and potential compatibility issues.',
					},
				],
				summary:
					'This release focuses heavily on UI/UX improvements to the Home View, Branch Card, and Launchpad, with significant changes to webview components. There are also additions of new AI model support and updates to git provider functionality. The primary risk areas are related to the extensive UI changes and the integration of new features.',
				total_files: 128,
				total_commits: 81,
			},
			error: null,
		});
	}
}
