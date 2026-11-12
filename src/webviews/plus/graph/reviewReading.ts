import type { Uri } from 'vscode';
import { setContext } from '../../../system/-webview/context.js';
import type { ReviewReadingAction } from './graphService.js';

/** The graph instance whose review the editor-side reading commands drive. One at a time, like
 *  focus: the instance that last set its review files owns them until it clears them, is disposed, or
 *  another instance claims them — which the one it took them from is told. */
export interface ReviewReadingOwner {
	reviewStep(action: ReviewReadingAction, uri?: Uri, inListOrder?: boolean): Promise<void>;
	/** Another instance took the editor over — this one's reading no longer shows there. */
	reviewFilesReleased(): void;
}

let owner: ReviewReadingOwner | undefined;

export function claimReviewFiles(next: ReviewReadingOwner, files: Uri[]): void {
	const previous = owner;
	owner = next;
	void setContext('gitlens:review:reading', true);
	void setContext('gitlens:review:files', files);
	// Told after the hand-over, so what it lets go of on its way out is no longer its to clear
	if (previous != null && previous !== next) {
		previous.reviewFilesReleased();
	}
}

/** Releases the files if `from` still owns them — a disposing instance must not clear another's. */
export function releaseReviewFiles(from: ReviewReadingOwner): void {
	if (owner !== from) return;

	owner = undefined;
	void setContext('gitlens:review:reading', false);
	void setContext('gitlens:review:files', undefined);
}

export function stepReviewReading(action: ReviewReadingAction, uri?: Uri, inListOrder?: boolean): Promise<void> {
	return owner?.reviewStep(action, uri, inListOrder) ?? Promise.resolve();
}

/** The nearest file not yet viewed that way, looping; the list-order neighbor when asked or when all others are viewed */
export function getReviewStepTarget(
	paths: readonly string[],
	index: number,
	direction: 1 | -1,
	viewed: ReadonlySet<string>,
	inListOrder: boolean,
): string | undefined {
	const count = paths.length;
	if (count < 2) return undefined;

	if (!inListOrder) {
		for (let step = 1; step < count; step++) {
			const path = paths[(index + direction * step + count) % count];
			if (!viewed.has(path)) return path;
		}
	}
	return paths[(index + direction + count) % count];
}
