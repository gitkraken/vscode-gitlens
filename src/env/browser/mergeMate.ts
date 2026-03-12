import type { Storage } from '../../system/-webview/storage.js';
import type { MergeMateService } from '../node/mergeMate/mergeMateService.js';

export type { MergeMateService };

export function getSupportedMergeMateService(_storage: Storage): Promise<MergeMateService | undefined> {
	return Promise.resolve(undefined);
}
