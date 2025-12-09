import type { Uri } from 'vscode';
import { Disposable, ViewColumn } from 'vscode';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { registerCommand } from '../../../system/-webview/command';
import type { WebviewPanelsProxy, WebviewsController } from '../../webviewsController';
import type { State } from './protocol';

export interface ComposerCommandArgs {
	repoPath?: string | Uri;
	source?: Sources;
	mode?: 'experimental' | 'preview';
	includedUnstagedChanges?: boolean;
	branchName?: string;
	/** Optional filter: if provided, only these commits are selectable for composition */
	commitShas?: string[];
	/** If provided, defines the commit range directly (skips merge target resolution) */
	range?: { base: string; head: string };
}

export type ComposerWebviewShowingArgs = [ComposerCommandArgs];

export function registerComposerWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.composer', ComposerWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.composer', State, State, ComposerWebviewShowingArgs>(
		{ id: 'gitlens.showComposerPage', options: { preserveInstance: true } },
		{
			id: 'gitlens.composer',
			fileName: 'composer.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Commit Composer',
			contextKeyPrefix: `gitlens:webview:composer`,
			trackingFeature: 'composerWebview',
			type: 'composer',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: true,
				enableFindWidget: true,
			},
		},
		async (container, host) => {
			const { ComposerWebviewProvider } = await import(
				/* webpackChunkName: "webview-composer" */ './composerWebview'
			);
			return new ComposerWebviewProvider(container, host);
		},
	);
}

export function registerComposerWebviewCommands<T>(
	_container: Container,
	panels: WebviewPanelsProxy<'gitlens.composer', ComposerWebviewShowingArgs, T>,
): Disposable {
	return Disposable.from(
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(`${panels.id}.maximize`, () => void (panels.getActiveInstance() as any)?.maximize()),
	);
}
