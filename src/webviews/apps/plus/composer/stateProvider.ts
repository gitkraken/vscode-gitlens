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
import type { ReactiveElementHost, StateProvider } from '../../shared/appHost';
import type { Disposable } from '../../shared/events';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from './context';

export class ComposerStateProvider implements StateProvider<State> {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: State }, ReactiveElementHost>;

	private readonly _state: State;
	get state(): State {
		return this._state;
	}

	constructor(
		host: ReactiveElementHost,
		state: State,
		private readonly _ipc: HostIpc,
	) {
		this._state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: this._state });

		this.disposable = this._ipc.onReceiveMessage(msg => {
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
					const updatedState = {
						...this._state,
						generatingCommits: false,
						commits: msg.params.commits,
						hunks: this._state.hunks.map(hunk => ({
							...hunk,
							assigned: true,
						})),
						hasUsedAutoCompose: true,
						timestamp: Date.now(),
					};

					(this as any)._state = updatedState;
					this.provider.setValue(this._state, true);
					break;
				}
				case DidGenerateCommitMessageNotification.is(msg): {
					const updatedCommits = this._state.commits.map(commit =>
						commit.id === msg.params.commitId ? { ...commit, message: msg.params.message } : commit,
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
						// Reset UI state to defaults
						selectedCommitId: null,
						selectedCommitIds: new Set<string>(),
						selectedUnassignedSection: null,
						selectedHunkIds: new Set<string>(),
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
		});
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
