import type { Uri } from 'vscode';
import { setContext } from '../../../system/-webview/context.js';
import type { ReviewWalkAction } from './graphService.js';

/** The graph instance whose review walk the editor-side commands drive. One at a time, like focus:
 *  the instance that last started a walk owns it until it ends the walk or is disposed. */
export interface ReviewWalkOwner {
	reviewWalk(action: ReviewWalkAction): Promise<void>;
}

let owner: ReviewWalkOwner | undefined;

export function claimReviewWalk(next: ReviewWalkOwner, files: Uri[]): void {
	owner = next;
	void setContext('gitlens:review:walking', true);
	void setContext('gitlens:review:files', files);
}

/** Releases the walk if `from` still owns it — a disposing instance must not clear another's. */
export function releaseReviewWalk(from: ReviewWalkOwner): void {
	if (owner !== from) return;

	owner = undefined;
	void setContext('gitlens:review:walking', false);
	void setContext('gitlens:review:files', undefined);
}

export function stepReviewWalk(action: ReviewWalkAction): Promise<void> {
	return owner?.reviewWalk(action) ?? Promise.resolve();
}
