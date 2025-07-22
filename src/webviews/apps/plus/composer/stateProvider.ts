import { ContextProvider } from '@lit/context';
import type { State } from '../../../plus/composer/protocol';
import {
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
		console.log('ComposerStateProvider constructor - received state:', state);
		this._state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: this._state });

		// Handle IPC messages from the webview provider
		this.disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidStartGeneratingNotification.is(msg): {
					// Set loading state when AI generation starts
					const updatedState = {
						...this._state,
						generating: true,
						timestamp: Date.now(),
					};

					(this as any)._state = updatedState;
					this.provider.setValue(this._state, true);
					console.log('Started AI generation - set loading state');
					break;
				}
				case DidStartGeneratingCommitMessageNotification.is(msg): {
					// Set loading state for specific commit message generation
					const updatedState = {
						...this._state,
						generatingCommitMessage: msg.params.commitId,
						timestamp: Date.now(),
					};

					(this as any)._state = updatedState;
					this.provider.setValue(this._state, true);
					console.log('Started commit message generation for commit:', msg.params.commitId);
					break;
				}
				case DidGenerateCommitsNotification.is(msg): {
					// Update commits when AI generation completes and clear loading state
					const updatedState = {
						...this._state,
						generating: false,
						commits: msg.params.commits,
						hunks: this._state.hunks.map(hunk => ({
							...hunk,
							assigned: true,
						})),
						unassignedChanges: {
							mode: 'staged-unstaged' as const,
							staged: [],
							unstaged: [],
						},
						timestamp: Date.now(),
					};

					(this as any)._state = updatedState;
					this.provider.setValue(this._state, true);
					console.log('Updated state with AI-generated commits:', msg.params.commits);
					break;
				}
				case DidGenerateCommitMessageNotification.is(msg): {
					// Update specific commit message and clear loading state
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
					console.log(
						'Updated commit message for commit:',
						msg.params.commitId,
						'with message:',
						msg.params.message,
					);
					break;
				}
				case DidStartCommittingNotification.is(msg): {
					// Set committing state when finish and commit starts
					const updatedState = {
						...this._state,
						committing: true,
						timestamp: Date.now(),
					};

					(this as any)._state = updatedState;
					this.provider.setValue(this._state, true);
					console.log('Started committing - set loading state');
					break;
				}
				case DidFinishCommittingNotification.is(msg): {
					// Clear committing state when finish and commit completes
					const updatedState = {
						...this._state,
						committing: false,
						timestamp: Date.now(),
					};

					(this as any)._state = updatedState;
					this.provider.setValue(this._state, true);
					console.log('Finished committing - cleared loading state');
					break;
				}
			}
		});
	}

	// Methods to update state
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

		// Clear unassigned changes selection
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
				this._state.commitMessageExpanded = expanded;
				break;
			case 'aiExplanation':
				this._state.aiExplanationExpanded = expanded;
				break;
			case 'filesChanged':
				this._state.filesChangedExpanded = expanded;
				break;
		}

		this._state.timestamp = Date.now();
		this.provider.setValue(this._state, true);
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
