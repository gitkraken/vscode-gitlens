import type { CommitGraphLaneCollapseExtension } from '../profile.js';
import { branchHintFor, createLaneCollapseAdornmentProvider } from './laneCollapse/adornmentProvider.js';

export const laneCollapseExtension: CommitGraphLaneCollapseExtension = Object.freeze({
	createProvider: createLaneCollapseAdornmentProvider,
	branchHintFor: branchHintFor,
});
