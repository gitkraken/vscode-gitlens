import { createWipStatsAdornmentProvider } from '../adornments/wipStatsAdornmentProvider.js';
import type { CommitGraphWipStatsExtension } from '../runtime.js';

export const wipStatsExtension: CommitGraphWipStatsExtension = Object.freeze({
	id: 'wip-stats',
	createProvider: createWipStatsAdornmentProvider,
});
