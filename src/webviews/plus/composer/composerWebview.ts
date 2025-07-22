import type { WebviewTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import { mockBaseCommit, mockCallbacks, mockCommits, mockHunkMap, mockHunks } from './mockData';
import type { State } from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	private _args?: ComposerWebviewShowingArgs[0];

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
		// Use real data if provided, otherwise fall back to mock data
		const args = this._args;
		const hunks = args?.hunks ?? mockHunks;
		const commits = args?.commits ?? mockCommits;
		const hunkMap = args?.hunkMap ?? mockHunkMap;
		const baseCommit = args?.baseCommit ?? mockBaseCommit;

		return {
			...this.host.baseWebviewState,
			hunks: hunks,
			commits: commits,
			hunkMap: hunkMap,
			baseCommit: baseCommit,
			callbacks: mockCallbacks, // Keep mock callbacks for now

			// UI state
			selectedCommitId: null,
			selectedCommitIds: new Set(),
			selectedUnassignedSection: null,
			selectedHunkIds: new Set(),

			// Section expansion state
			commitMessageExpanded: true,
			aiExplanationExpanded: true,
			filesChangedExpanded: true,

			// Unassigned changes - use real hunks if provided
			unassignedChanges: {
				mode: 'staged-unstaged',
				staged: hunks.filter(h => h.source === 'staged'),
				unstaged: hunks.filter(h => h.source === 'unstaged'),
			},
		};
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
}
