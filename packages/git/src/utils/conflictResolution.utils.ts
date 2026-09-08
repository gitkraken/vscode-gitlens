import * as l10n from '@vscode/l10n';
import type { GitFileConflictStatus } from '../models/fileStatus.js';

export type ConflictResolutionAction = 'take-ours' | 'take-theirs' | 'delete' | 'unsupported';

/**
 * A richer description of a conflict than the raw XY status code — used to label conflicts the
 * AI text resolver can't parse (binary, symlink, submodule, mode-only, add/add) and to surface
 * rename conflicts. Derived by {@link classifyConflictKind} from the XY status plus, when
 * available, the per-stage file modes/oids and rename/binary hints the caller computes.
 */
export type ConflictKind =
	| 'text'
	| 'binary'
	| 'symlink'
	| 'submodule'
	| 'mode-only'
	| 'add-add'
	| 'delete-modify'
	| 'both-deleted'
	| 'rename-rename'
	| 'rename-delete'
	| 'rename-modify'
	| 'unknown';

export type ConflictRenameKind = 'rename-rename' | 'rename-delete' | 'rename-modify';

const symlinkMode = '120000';
const submoduleMode = '160000';

/**
 * Classifies a conflict into a {@link ConflictKind}. Pure — all detection that needs git/IO
 * (rename correlation, binary sniffing) is computed by the caller and passed via `hints`. When
 * `modes`/`oids` are omitted (e.g. a webview caller that only has the XY status), it still returns
 * a useful coarse kind; pass the per-stage data for the fine-grained symlink/submodule/mode-only split.
 */
export function classifyConflictKind(
	status: GitFileConflictStatus,
	modes?: { base?: string; current?: string; incoming?: string },
	oids?: { base?: string; current?: string; incoming?: string },
	hints?: { binary?: boolean; rename?: ConflictRenameKind },
): ConflictKind {
	if (hints?.rename != null) return hints.rename;

	if (status === 'DD') return 'both-deleted';
	if (status === 'UD' || status === 'DU') return 'delete-modify';

	const presentModes = [modes?.current, modes?.incoming, modes?.base].filter((m): m is string => m != null);
	if (presentModes.includes(submoduleMode)) return 'submodule';
	if (presentModes.includes(symlinkMode)) return 'symlink';

	if (hints?.binary) return 'binary';

	// Both sides present with identical content (same oid) but different mode → only the file mode
	// conflicts (e.g. one side flipped the executable bit).
	if (
		modes?.current != null &&
		modes?.incoming != null &&
		modes.current !== modes.incoming &&
		oids?.current != null &&
		oids.current === oids?.incoming
	) {
		return 'mode-only';
	}

	if (status === 'AA' || status === 'AU' || status === 'UA') return 'add-add';

	return 'text';
}

export function classifyConflictAction(
	status: GitFileConflictStatus,
	resolution: 'current' | 'incoming',
): ConflictResolutionAction {
	const takeCurrent = resolution === 'current';

	if (status === 'DD') return 'delete';
	if (status === 'UD' && !takeCurrent) return 'delete';
	if (status === 'DU' && takeCurrent) return 'delete';

	// `git checkout --{ours,theirs}` fails when the requested stage is absent.
	// Single-file UI filters these out; bulk resolve surfaces them as failures.
	if (status === 'UA' && takeCurrent) return 'unsupported';
	if (status === 'AU' && !takeCurrent) return 'unsupported';

	return takeCurrent ? 'take-ours' : 'take-theirs';
}

// Stage Current is invalid when the current side has no content to take (added/deleted only by them, or both deleted)
export function canStageCurrent(status: GitFileConflictStatus): boolean {
	return status !== 'UA' && status !== 'DD';
}

// Stage Incoming is invalid when the incoming side has no content to take (added/deleted only by us, or both deleted)
export function canStageIncoming(status: GitFileConflictStatus): boolean {
	return status !== 'AU' && status !== 'DD';
}

/** A short label, complete description, and standalone reason for a {@link ConflictKind}, used to
 *  explain conflicts the AI resolver can't auto-merge (and rename conflicts) wherever they're surfaced. */
export function getConflictKindLabel(
	kind: ConflictKind,
	renameOf?: string,
): { label: string; description: string; reason: string } {
	switch (kind) {
		case 'binary':
			return {
				label: l10n.t('Binary conflict'),
				description: l10n.t('Binary file changed on both sides — choose a side to keep'),
				reason: l10n.t('Binary file changed on both sides'),
			};
		case 'symlink':
			return {
				label: l10n.t('Symlink conflict'),
				description: l10n.t('Symbolic link changed on both sides — choose a side to keep'),
				reason: l10n.t('Symbolic link changed on both sides'),
			};
		case 'submodule':
			return {
				label: l10n.t('Submodule conflict'),
				description: l10n.t('Submodule reference changed on both sides — choose a side to keep'),
				reason: l10n.t('Submodule reference changed on both sides'),
			};
		case 'mode-only':
			return {
				label: l10n.t('File mode conflict'),
				description: l10n.t('Only the file mode differs (e.g. the executable bit) — choose a side to keep'),
				reason: l10n.t('Only the file mode differs (e.g. the executable bit)'),
			};
		case 'add-add':
			// Covers AA (added on both sides) as well as AU/UA (added on one side) — keep the wording
			// accurate for all three rather than asserting "both sides".
			return {
				label: l10n.t('Add conflict'),
				description: l10n.t('Conflicting file additions — choose a side to keep'),
				reason: l10n.t('Conflicting file additions'),
			};
		case 'delete-modify':
			return {
				label: l10n.t('Modified and deleted'),
				description: l10n.t('Deleted on one side and modified on the other — keep the file or delete it'),
				reason: l10n.t('Deleted on one side and modified on the other'),
			};
		case 'both-deleted':
			return {
				label: l10n.t('Deleted on both sides'),
				description: l10n.t('Deleted on both sides — confirm the deletion'),
				reason: l10n.t('Deleted on both sides'),
			};
		case 'rename-rename':
			return renameOf
				? {
						label: l10n.t('Renamed differently'),
						description: l10n.t(
							'"{file}" was renamed differently on each side — choose which name to keep.',
							{ file: renameOf },
						),
						reason: l10n.t('"{file}" was renamed differently on each side', { file: renameOf }),
					}
				: {
						label: l10n.t('Renamed differently'),
						description: l10n.t(
							'The file was renamed differently on each side — choose which name to keep.',
						),
						reason: l10n.t('The file was renamed differently on each side'),
					};
		case 'rename-delete':
			return renameOf
				? {
						label: l10n.t('Renamed and deleted'),
						description: l10n.t(
							'"{file}" was renamed on one side and deleted on the other — keep the file or delete it.',
							{ file: renameOf },
						),
						reason: l10n.t('"{file}" was renamed on one side and deleted on the other', {
							file: renameOf,
						}),
					}
				: {
						label: l10n.t('Renamed and deleted'),
						description: l10n.t(
							'The file was renamed on one side and deleted on the other — keep the file or delete it.',
						),
						reason: l10n.t('The file was renamed on one side and deleted on the other'),
					};
		case 'rename-modify':
			return renameOf
				? {
						label: l10n.t('Renamed and modified'),
						description: l10n.t('"{file}" was renamed on one side and modified on the other', {
							file: renameOf,
						}),
						reason: l10n.t('"{file}" was renamed on one side and modified on the other', {
							file: renameOf,
						}),
					}
				: {
						label: l10n.t('Renamed and modified'),
						description: l10n.t('The file was renamed on one side and modified on the other'),
						reason: l10n.t('The file was renamed on one side and modified on the other'),
					};
		case 'text':
			return {
				label: l10n.t('Text conflict'),
				description: l10n.t('Conflicting changes on both sides'),
				reason: l10n.t('Conflicting changes on both sides'),
			};
		default:
			return {
				label: l10n.t('Conflict'),
				description: l10n.t('Resolve this conflict manually'),
				reason: l10n.t('Resolve this conflict manually'),
			};
	}
}
