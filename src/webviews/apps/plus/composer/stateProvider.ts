import { ContextProvider } from '@lit/context';
import type { State } from '../../../plus/composer/protocol';
import {
	DidCancelGenerateCommitMessageNotification,
	DidCancelGenerateCommitsNotification,
	DidChangeAiEnabledNotification,
	DidChangeAiModelNotification,
	DidClearAIOperationErrorNotification,
	DidErrorAIOperationNotification,
	DidFinishCommittingNotification,
	DidGenerateCommitMessageNotification,
	DidGenerateCommitsNotification,
	DidIndexChangeNotification,
	DidLoadingErrorNotification,
	DidReloadComposerNotification,
	DidSafetyErrorNotification,
	DidStartCommittingNotification,
	DidStartGeneratingCommitMessageNotification,
	DidStartGeneratingNotification,
	DidWorkingDirectoryChangeNotification,
} from '../../../plus/composer/protocol';
import type { IpcMessage } from '../../../protocol';
import type { ReactiveElementHost } from '../../shared/appHost';
import { StateProviderBase } from '../../shared/stateProviderBase';
import { stateContext } from './context';

export class ComposerStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidStartGeneratingNotification.is(msg): {
				const updatedState = {
					...this._state,
					generatingCommits: true,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidStartGeneratingCommitMessageNotification.is(msg): {
				const updatedState = {
					...this._state,
					generatingCommitMessage: msg.params.commitId,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidGenerateCommitsNotification.is(msg): {
				// if the message params contain replaced commit ids, we only want to replace those commits in state with the new ones. Otherwise replace all of them
				let newCommits;
				if (msg.params.replacedCommitIds) {
					newCommits = [...this._state.commits];
					// Updates the replaced commits in state with the new commits replacing them
					const firstRemovedIndex = newCommits.findIndex(c => msg.params.replacedCommitIds!.includes(c.id));
					newCommits = newCommits.filter(c => !msg.params.replacedCommitIds!.includes(c.id));
					newCommits.splice(firstRemovedIndex, 0, ...msg.params.commits);
					// Updates hunk index references on all other commits to match the new hunk indices
					const oldHunkMap = new Map(
						this._state.hunks.map(hunk => [hunk.index, `${hunk.diffHeader}\n${hunk.hunkHeader}`]),
					);
					const newHunkMap = new Map(
						msg.params.hunks!.map(hunk => [`${hunk.diffHeader}\n${hunk.hunkHeader}`, hunk.index]),
					);
					const newCommitIds = msg.params.commits.map(c => c.id);
					for (const commit of newCommits) {
						if (!newCommitIds.includes(commit.id)) {
							commit.locked = true;
							const commitHunkHeaders = commit.hunkIndices.map(i => oldHunkMap.get(i)!);
							commit.hunkIndices = commitHunkHeaders.map(h => newHunkMap.get(h)).filter(i => i != null);
						}
					}
				} else {
					newCommits = msg.params.commits;
				}

				const updatedState = {
					...this._state,
					generatingCommits: false,
					commits: newCommits,
					hunks: (msg.params.hunks ?? this._state.hunks).map(hunk => ({
						...hunk,
						assigned: true,
					})),
					hasUsedAutoCompose: true,
					timestamp: Date.now(),
					recompose: this._state.recompose?.enabled
						? {
								...this._state.recompose,
								locked: false,
							}
						: this._state.recompose,
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidGenerateCommitMessageNotification.is(msg): {
				const updatedCommits = this._state.commits.map(commit =>
					commit.id === msg.params.commitId
						? { ...commit, message: { content: msg.params.message, isGenerated: true } }
						: commit,
				);

				const updatedState = {
					...this._state,
					generatingCommitMessage: null,
					commits: updatedCommits,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidStartCommittingNotification.is(msg): {
				const updatedState = {
					...this._state,
					committing: true,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidFinishCommittingNotification.is(msg): {
				const updatedState = {
					...this._state,
					committing: false,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidSafetyErrorNotification.is(msg): {
				const updatedState = {
					...this._state,
					safetyError: msg.params.error,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidReloadComposerNotification.is(msg): {
				const updatedState = {
					...this._state,
					hunks: msg.params.hunks,
					commits: msg.params.commits,
					baseCommit: msg.params.baseCommit,
					loadingError: msg.params.loadingError,
					hasChanges: msg.params.hasChanges,
					safetyError: null, // Clear any existing safety errors
					// Clear any ongoing operations
					generatingCommits: false,
					generatingCommitMessage: null,
					committing: false,
					// Reset working directory change flag on reload
					workingDirectoryHasChanged: false,
					indexHasChanged: false,
					timestamp: Date.now(),
					hasUsedAutoCompose: false,
					repositoryState: msg.params.repositoryState,
					recompose: this._state.recompose?.enabled
						? {
								...this._state.recompose,
								locked: true,
							}
						: this._state.recompose,
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidWorkingDirectoryChangeNotification.is(msg): {
				const updatedState = {
					...this._state,
					workingDirectoryHasChanged: true,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidIndexChangeNotification.is(msg): {
				const updatedState = {
					...this._state,
					indexHasChanged: true,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidLoadingErrorNotification.is(msg): {
				const updatedState = {
					...this._state,
					loadingError: msg.params.error,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidErrorAIOperationNotification.is(msg): {
				const updatedState = {
					...this._state,
					aiOperationError: {
						operation: msg.params.operation,
						error: msg.params.error,
					},
					// Clear any loading states since the operation failed
					generatingCommits: false,
					generatingCommitMessage: null,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidClearAIOperationErrorNotification.is(msg): {
				const updatedState = {
					...this._state,
					aiOperationError: null,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidCancelGenerateCommitsNotification.is(msg): {
				// Clear loading state and reset to pre-generation state
				const updatedState = {
					...this._state,
					generatingCommits: false,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidCancelGenerateCommitMessageNotification.is(msg): {
				// Clear loading state for commit message generation
				const updatedState = {
					...this._state,
					generatingCommitMessage: null,
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidChangeAiEnabledNotification.is(msg): {
				const updatedState = {
					...this._state,
					aiEnabled: {
						...this._state.aiEnabled,
						...(msg.params.org !== undefined && { org: msg.params.org }),
						...(msg.params.config !== undefined && { config: msg.params.config }),
					},
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
			case DidChangeAiModelNotification.is(msg): {
				const updatedState = {
					...this._state,
					ai: {
						...this._state.ai,
						model: msg.params.model,
					},
					timestamp: Date.now(),
				};

				(this as any)._state = updatedState;
				this.provider.setValue(this._state, true);
				break;
			}
		}
	}
}
