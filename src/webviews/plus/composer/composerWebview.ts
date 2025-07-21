import type { WebviewTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import { mockBaseCommit, mockCallbacks, mockCommits, mockHunkMap, mockHunks } from './mockData';
import type { State } from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.composer'>,
	) {}

	dispose(): void {}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	includeBootstrap(): State {
		return {
			...this.host.baseWebviewState,
			// Initialize with mock data for now
			hunks: mockHunks,
			commits: mockCommits,
			hunkMap: mockHunkMap,
			baseCommit: mockBaseCommit,
			callbacks: mockCallbacks,

			// UI state
			selectedCommitId: null,
			selectedCommitIds: new Set(),
			selectedUnassignedSection: null,
			selectedHunkIds: new Set(),

			// Section expansion state
			commitMessageExpanded: true,
			aiExplanationExpanded: true,
			filesChangedExpanded: true,

			// Unassigned changes - extract from mock hunks
			unassignedChanges: {
				mode: 'staged-unstaged',
				staged: mockHunks.filter(h => h.source === 'staged'),
				unstaged: mockHunks.filter(h => h.source === 'unstaged'),
			},
		};
	}

	onShowing(): [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined] {
		return [true, undefined];
	}
}
