import { ContextProvider } from '@lit/context';
import type { State } from '../../../plus/composer/protocol';
import {
	DidChangeAiEnabledNotification,
	DidFinishCommittingNotification,
	DidGenerateCommitMessageNotification,
	DidGenerateCommitsNotification,
	DidStartCommittingNotification,
	DidStartGeneratingCommitMessageNotification,
	DidStartGeneratingNotification,
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
			}
		});
	}

	updateSelectedCommit(commitId: string | null, multiSelect: boolean = false) {
		if (multiSelect && commitId) {
			const newSelection = new Set(this._state.selectedCommitIds);
			if (newSelection.has(commitId)) {
				newSelection.delete(commitId);
			} else {
				newSelection.add(commitId);
			}
			this._state.selectedCommitIds = newSelection;

			if (newSelection.size > 1) {
				this._state.selectedCommitId = null;
			} else if (newSelection.size === 1) {
				this._state.selectedCommitId = Array.from(newSelection)[0];
				this._state.selectedCommitIds = new Set();
			} else {
				this._state.selectedCommitId = null;
			}
		} else {
			this._state.selectedCommitIds = new Set();
			this._state.selectedCommitId = commitId;
		}

		this._state.selectedUnassignedSection = null;
		this._state.timestamp = Date.now();
		this.provider.setValue(this._state, true);
	}

	updateSelectedUnassignedSection(section: string | null) {
		this._state.selectedUnassignedSection = section;
		this._state.selectedCommitId = null;
		this._state.selectedCommitIds = new Set();
		this._state.timestamp = Date.now();
		this.provider.setValue(this._state, true);
	}

	updateSelectedHunks(hunkId: string, multiSelect: boolean = false) {
		if (multiSelect) {
			const newSelection = new Set(this._state.selectedHunkIds);
			if (newSelection.has(hunkId)) {
				newSelection.delete(hunkId);
			} else {
				newSelection.add(hunkId);
			}
			this._state.selectedHunkIds = newSelection;
		} else {
			this._state.selectedHunkIds = new Set([hunkId]);
		}

		this._state.timestamp = Date.now();
		this.provider.setValue(this._state, true);
	}

	updateSectionExpansion(section: 'commitMessage' | 'aiExplanation' | 'filesChanged', expanded: boolean) {
		switch (section) {
			case 'commitMessage':
				this._state.detailsSectionExpanded.commitMessage = expanded;
				break;
			case 'aiExplanation':
				this._state.detailsSectionExpanded.aiExplanation = expanded;
				break;
			case 'filesChanged':
				this._state.detailsSectionExpanded.filesChanged = expanded;
				break;
		}

		this._state.timestamp = Date.now();
		this.provider.setValue(this._state, true);
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
