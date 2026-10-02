import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import type { BatchSlot } from '../models/integration.js';
import type { ProviderResult, ProviderWarning, ProviderWarningKind } from '../results.js';
import { appendDedupedWarning, toProviderWarning } from '../results.js';

/**
 * The etag flow shared by the batch reads (`getPullRequestsBatch`, and both forms of `getIssuesBatch`): targets that
 * carry the etag of the caller's copy are first asked a cheap "what is your change state" question, and only the ones
 * that moved are read in full.
 *
 * - No target carries an etag, or the integration has no cheap check: ONE full read of every target, exactly as
 *   before etags existed, with an etag added to each row.
 * - Otherwise up to three integration calls: the full read of the targets with no etag starts at once, in parallel
 *   with the cheap check of the others, and the targets whose etag no longer matches get a second full read as soon
 *   as the check settles. A call takes the longer of the two paths, never their sum.
 *
 * The cheap check never answers for a target it couldn't check: a target it failed falls through to the full read,
 * which then has the final word (and supplies the warning, should it fail too) — except when the failure was a
 * refused credential or a spent rate limit, which the full read would only hit again; those targets are dropped with
 * the cheap check's warning, as a failed full read drops them. Each target is judged by its own slot's reason, so one
 * target's rate limit never drops another target the check merely failed to answer, nor sends a rate-limited target
 * to the full read; the check's wrappers return every slot as it settled, failing as a whole only on a refused
 * credential (or when the request itself failed).
 *
 * Failure budget: the cheap check spends no strike toward disconnecting, and shows no notice, unless the credential
 * is refused. Only the full reads spend, each at most one, so a call spends at most two: in a total outage of a batch
 * whose every target carries an etag, one, for the full read every target falls through to.
 */

/** One integration call's slots, as `runCaptured` captures them. */
export interface CapturedBatch<T> {
	value?: BatchSlot<T | undefined>[];
	warning?: ProviderWarning;
}

/**
 * One target's answer: read in full (`value`, or proven absent without one), or `unchanged`, when the cheap check
 * proved the caller's copy current. Every row with a `value` carries its `etag`, as does every `unchanged` one.
 */
export interface EtaggedBatchRow<T> {
	key: string;
	value?: T;
	etag?: string;
	unchanged?: true;
}

/** Failures a full read would only hit again: a refused credential, a spent rate limit, a connection that's gone. */
const noRetryKinds: readonly ProviderWarningKind[] = ['auth', 'rate-limit', 'no-connection'];

export async function readEtaggedBatch<Target extends { key: string; etag?: string }, Item, Fields>(options: {
	providerId: IntegrationIds;
	domain: string | undefined;
	connectionId: string | undefined;
	targets: readonly Target[];
	/** Whether the integration has a cheap check. Decided up front, so a host without one makes one call. */
	supportsEtags: boolean;
	readFull: (targets: readonly Target[]) => Promise<CapturedBatch<Item>>;
	readEtagFields: (targets: readonly Target[]) => Promise<CapturedBatch<Fields>>;
	itemEtag: (item: Item) => string;
	fieldsEtag: (fields: Fields) => string;
	/** The warning for a full read that answered neither slots nor an error: the provider can't batch at all. */
	unsupportedWarning: () => ProviderWarning;
}): Promise<ProviderResult<EtaggedBatchRow<Item>>> {
	const { providerId, domain, connectionId, targets } = options;
	const warnings: ProviderWarning[] = [];
	const rows = new Map<number, EtaggedBatchRow<Item>>();
	let fetchFailed = false;

	const settleFull = (indices: readonly number[], { value: slots, warning }: CapturedBatch<Item>): void => {
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}

		if (slots == null) {
			// Dropped, never reported absent: "unknown" and "proven absent" must stay distinguishable.
			if (warning == null) {
				appendDedupedWarning(warnings, options.unsupportedWarning());
			}
			fetchFailed = true;
			return;
		}

		for (let i = 0; i < indices.length; i++) {
			const slot = slots[i];
			if (slot.status === 'rejected') {
				// Dropped, never reported absent, like a whole-call failure: only THIS target failed.
				appendBatchSlotWarning(warnings, providerId, domain, connectionId, slot);
				fetchFailed = true;
				continue;
			}

			const item = slot.value;
			const key = targets[indices[i]].key;
			rows.set(indices[i], item != null ? { key: key, value: item, etag: options.itemEtag(item) } : { key: key });
		}
	};

	const cheap: number[] = [];
	const full: number[] = [];
	for (let i = 0; i < targets.length; i++) {
		(options.supportsEtags && targets[i].etag ? cheap : full).push(i);
	}

	const select = (indices: readonly number[]): Target[] => indices.map(i => targets[i]);

	if (!cheap.length) {
		settleFull(full, await options.readFull(targets));
	} else {
		// Started before the cheap check is even sent, so the targets it can't answer never wait on it.
		const fullRead = full.length ? options.readFull(select(full)) : undefined;

		const changed: number[] = [];
		const { value: slots, warning } = await options.readEtagFields(select(cheap));
		if (warning != null && noRetryKinds.includes(warning.kind)) {
			appendDedupedWarning(warnings, warning);
			fetchFailed = true;
		} else if (slots == null) {
			// The check failed some other way, or the provider declined it; the full read decides instead.
			changed.push(...cheap);
		} else {
			for (let i = 0; i < cheap.length; i++) {
				const index = cheap[i];
				const slot = slots[i];
				if (slot.status === 'rejected') {
					// A scoped refusal (`failure`) is the credential refused for that target's scope, which a full read
					// would hit as well.
					if (slot.failure != null) {
						appendBatchSlotWarning(warnings, providerId, domain, connectionId, slot);
						fetchFailed = true;
						continue;
					}

					const slotWarning = toProviderWarning(providerId, domain, connectionId, slot.reason);
					if (noRetryKinds.includes(slotWarning.kind)) {
						appendDedupedWarning(warnings, slotWarning);
						fetchFailed = true;
					} else {
						changed.push(index);
					}
					continue;
				}

				const key = targets[index].key;
				const fields = slot.value;
				if (fields == null) {
					rows.set(index, { key: key });
					continue;
				}

				const etag = options.fieldsEtag(fields);
				if (etag === targets[index].etag) {
					rows.set(index, { key: key, unchanged: true, etag: etag });
				} else {
					changed.push(index);
				}
			}
		}

		const changedRead = changed.length ? options.readFull(select(changed)) : undefined;
		if (fullRead != null) {
			settleFull(full, await fullRead);
		}
		if (changedRead != null) {
			settleFull(changed, await changedRead);
		}
	}

	const items: EtaggedBatchRow<Item>[] = [];
	for (let i = 0; i < targets.length; i++) {
		const row = rows.get(i);
		if (row != null) {
			items.push(row);
		}
	}
	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

/**
 * Appends the warning for a batch target that could not be checked, shared by every batch read: for a refusal, the
 * scope failure it was recorded as (see `IntegrationBase.settleBatchRefusals`), published as an account-wide read
 * publishes one, scoped and with its cause; otherwise, the reason itself.
 */
export function appendBatchSlotWarning(
	warnings: ProviderWarning[],
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	slot: Extract<BatchSlot<unknown>, { status: 'rejected' }>,
): void {
	if (slot.failure != null) {
		mergeAssessmentInto(warnings, providerId, domain, connectionId, {
			completeness: 'partial',
			failures: [slot.failure],
		});
		return;
	}

	appendDedupedWarning(warnings, toProviderWarning(providerId, domain, connectionId, slot.reason));
}
