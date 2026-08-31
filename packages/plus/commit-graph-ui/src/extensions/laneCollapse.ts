import { branchHintFor, createLaneCollapseAdornmentProvider } from '../adornments/laneCollapseAdornmentProvider.js';
import type { CommitGraphLaneCollapseExtension } from '../runtime.js';

export const laneCollapseExtension: CommitGraphLaneCollapseExtension = Object.freeze({
	id: 'lane-collapse',
	createProvider: createLaneCollapseAdornmentProvider,
	branchHintFor: branchHintFor,
});
