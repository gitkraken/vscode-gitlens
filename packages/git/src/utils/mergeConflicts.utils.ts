import * as l10n from '@vscode/l10n';
import type { ConflictDetectionErrorReason, ConflictDetectionResult } from '../models/mergeConflicts.js';

export function createConflictDetectionError(reason: ConflictDetectionErrorReason): ConflictDetectionResult {
	return { status: 'error', reason: reason, message: getConflictDetectionErrorMessage(reason) };
}

function getConflictDetectionErrorMessage(reason: ConflictDetectionErrorReason): string {
	switch (reason) {
		case 'unsupported':
			return 'Unable to detect conflicts because Git 2.38 or later is required';
		case 'noParent':
			return 'Unable to detect conflicts because the selection includes the initial commit';
		case 'noMergeBase':
			return "Unable to detect conflicts because the branches don't share a common history";
		case 'refNotFound':
			return "Unable to detect conflicts because the branch or commit doesn't exist";
		case 'other':
		default:
			return 'Unable to detect conflicts';
	}
}

export function getConflictDetectionErrorDisplayMessage(
	reason: ConflictDetectionErrorReason,
	fallback?: string,
): string {
	switch (reason) {
		case 'unsupported':
			return l10n.t('Unable to detect conflicts because Git 2.38 or later is required');
		case 'noParent':
			return l10n.t('Unable to detect conflicts because the selection includes the initial commit');
		case 'noMergeBase':
			return l10n.t("Unable to detect conflicts because the branches don't share a common history");
		case 'refNotFound':
			return l10n.t("Unable to detect conflicts because the branch or commit doesn't exist");
		case 'other':
			return l10n.t('Unable to detect conflicts');
		default:
			return fallback ?? l10n.t('Unable to detect conflicts');
	}
}
