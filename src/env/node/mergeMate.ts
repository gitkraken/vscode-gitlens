import type { Storage } from '../../system/-webview/storage.js';
import { MergeMateService } from './mergeMate/mergeMateService.js';

export type { MergeMateService };

export function getSupportedMergeMateService(storage: Storage): Promise<MergeMateService | undefined> {
	try {
		return Promise.resolve(new MergeMateService(storage));
	} catch {
		return Promise.resolve(undefined);
	}
}
