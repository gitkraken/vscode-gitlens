import type { Uri } from 'vscode';
import { setContext } from '../../../system/-webview/context.js';
import type { ReviewReadingAction } from './graphService.js';

/** The graph instance whose review the editor-side reading commands drive. One at a time, like
 *  focus: the instance that last set its review files owns them until it clears them or is disposed. */
export interface ReviewReadingOwner {
	reviewStep(action: ReviewReadingAction, uri?: Uri): Promise<void>;
}

let owner: ReviewReadingOwner | undefined;

export function claimReviewFiles(next: ReviewReadingOwner, files: Uri[]): void {
	owner = next;
	void setContext('gitlens:review:reading', true);
	void setContext('gitlens:review:files', files);
}

/** Releases the files if `from` still owns them — a disposing instance must not clear another's. */
export function releaseReviewFiles(from: ReviewReadingOwner): void {
	if (owner !== from) return;

	owner = undefined;
	void setContext('gitlens:review:reading', false);
	void setContext('gitlens:review:files', undefined);
}

export function stepReviewReading(action: ReviewReadingAction, uri?: Uri): Promise<void> {
	return owner?.reviewStep(action, uri) ?? Promise.resolve();
}
