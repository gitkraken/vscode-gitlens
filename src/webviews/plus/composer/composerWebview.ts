import type { WebviewTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import { mockBaseCommit, mockCommits, mockHunkMap, mockHunks } from './mockData';
import type { GenerateCommitsParams, State } from './protocol';
import { DidGenerateCommitsNotification, GenerateCommitsCommand } from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	private _args?: ComposerWebviewShowingArgs[0];

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.composer'>,
	) {}

	dispose(): void {}

	onMessageReceived(e: IpcMessage): void {
		switch (true) {
			case GenerateCommitsCommand.is(e):
				void this.onGenerateCommits(e.params);
				break;
		}
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	includeBootstrap(): State {
		// Use real data if provided, otherwise fall back to mock data
		const args = this._args;
		const hunks = args?.hunks ?? mockHunks;
		const commits = args?.commits ?? mockCommits;
		const hunkMap = args?.hunkMap ?? mockHunkMap;
		const baseCommit = args?.baseCommit ?? mockBaseCommit;

		const state = {
			...this.host.baseWebviewState,
			hunks: hunks,
			commits: commits,
			hunkMap: hunkMap,
			baseCommit: baseCommit,

			// UI state
			selectedCommitId: null,
			selectedCommitIds: new Set<string>(),
			selectedUnassignedSection: null,
			selectedHunkIds: new Set<string>(),

			// Section expansion state
			commitMessageExpanded: true,
			aiExplanationExpanded: true,
			filesChangedExpanded: true,

			// Unassigned changes - use real hunks if provided
			unassignedChanges: {
				mode: 'staged-unstaged' as const,
				staged: hunks.filter(h => h.source === 'staged'),
				unstaged: hunks.filter(h => h.source === 'unstaged'),
			},
		};

		return state;
	}

	onShowing(
		_loading: boolean,
		_options: any,
		...args: ComposerWebviewShowingArgs
	): [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined] {
		// Store the args for use in includeBootstrap
		if (args?.[0]) {
			this._args = args[0];
		}
		return [true, undefined];
	}

	private async onGenerateCommits(params: GenerateCommitsParams): Promise<void> {
		try {
			console.log('ComposerWebviewProvider onGenerateCommits called with:', params);

			// Transform the data for the AI service
			const hunks = params.hunks.map(hunk => ({
				index: hunk.index,
				fileName: hunk.fileName,
				diffHeader: hunk.diffHeader || `diff --git a/${hunk.fileName} b/${hunk.fileName}`,
				hunkHeader: hunk.hunkHeader,
				content: hunk.content,
				source: hunk.source,
			}));

			const existingCommits = params.commits.map(commit => ({
				id: commit.id,
				message: commit.message,
				aiExplanation: commit.aiExplanation,
				hunkIndices: commit.hunkIndices,
			}));

			// Call the AI service
			const result = await this.container.ai.generateCommits(hunks, existingCommits, params.hunkMap, {
				source: 'ai',
			});

			if (result && result !== 'cancelled') {
				// Transform AI result back to ComposerCommit format
				const newCommits = result.commits.map((commit, index) => ({
					id: `ai-commit-${index}`,
					message: commit.message,
					aiExplanation: commit.explanation,
					hunkIndices: commit.hunks.map(h => h.hunk),
				}));

				// Notify the webview with the generated commits
				await this.host.notify(DidGenerateCommitsNotification, { commits: newCommits });
				console.log('Successfully generated and sent commits:', newCommits);
			} else {
				console.log('AI generation was cancelled or failed');
			}
		} catch (error) {
			console.error('Error in onGenerateCommits:', error);
		}
	}
}
