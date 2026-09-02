import type { CommitGraphWipStatsExtension } from '../profile.js';
import { createWipStatsAdornmentProvider } from './wipStats/adornmentProvider.js';

export const wipStatsExtension: CommitGraphWipStatsExtension = Object.freeze({
	createProvider: createWipStatsAdornmentProvider,
});
