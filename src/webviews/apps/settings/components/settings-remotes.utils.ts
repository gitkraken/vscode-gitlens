import { areEqual } from '@gitlens/utils/object.js';
import type { RemotesUrlsConfig } from '../../../../config.js';
import type { RemoteRuleDraft } from '../actions.js';

export type MatcherMode = 'domain' | 'regex';

/** Local editing copy of one row — carries the matcher mode so a toggle to an empty regex/domain sticks. */
export type RemoteDraft = RemoteRuleDraft & { matcherMode: MatcherMode };

/** The 9 schema-required `urls` fields — a `type: Custom` entry with any of these empty is silently dropped by the consumer. */
const requiredUrlFields = [
	'repository',
	'branches',
	'branch',
	'commit',
	'file',
	'fileInBranch',
	'fileInCommit',
	'fileLine',
	'fileRange',
] as const satisfies readonly (keyof RemotesUrlsConfig)[];

/**
 * Whether an already-persisted entry actually resolves in the consumer — it has a
 * matcher, and a `type: Custom` entry also has a complete `urls` block. Mirrors
 * {@link isPersistable} but reads a plain persisted entry (no matcher-mode marker):
 * such an entry carries exactly one of `regex`/`domain`, so either counts as a matcher.
 */
export function isEntryLive(entry: RemoteRuleDraft | undefined): boolean {
	if (entry == null) return false;
	if (!entry.regex && !entry.domain) return false;
	if (entry.type === 'Custom') return urlsComplete(entry.urls);

	return true;
}

/**
 * Index of the first entry deep-equal (key-order-insensitive) to `target`, or -1.
 * Relocates an open draft after an external `settings.json` edit shifts the array,
 * so a later commit can't rewrite the wrong (shifted) entry.
 */
export function findEntryIndex(entries: readonly RemoteRuleDraft[], target: RemoteRuleDraft | undefined): number {
	if (target == null) return -1;

	return entries.findIndex(entry => areEqual(entry, target));
}

/** True once every schema-required `urls` field is non-empty. */
export function urlsComplete(urls: RemotesUrlsConfig | undefined): boolean {
	if (urls == null) return false;

	const record = urls as unknown as Record<string, string | undefined>;
	return requiredUrlFields.every(f => Boolean(record[f]?.trim()));
}

/**
 * Whether a draft would survive the permissive consumer, so it's safe to write:
 * it must have a matcher, and a `type: Custom` entry must also have a complete
 * `urls` block. A non-compiling regex still qualifies (write-and-warn — the
 * consumer skips it safely; the UI flags it).
 */
export function isPersistable(draft: RemoteDraft): boolean {
	const hasMatcher = draft.matcherMode === 'regex' ? Boolean(draft.regex) : Boolean(draft.domain);
	if (!hasMatcher) return false;
	if (draft.type === 'Custom') return urlsComplete(draft.urls);

	return true;
}

/**
 * Projects the editing draft onto the schema-safe entry that gets written: drops the
 * matcher-mode marker, omits the inactive matcher entirely (see `RemoteRuleDraft`),
 * and keeps `urls` only for `type: Custom`.
 */
export function projectEntry(draft: RemoteDraft): RemoteRuleDraft {
	const entry: RemoteRuleDraft = { type: draft.type };
	if (draft.matcherMode === 'regex') {
		if (draft.regex) {
			entry.regex = draft.regex;
		}
	} else if (draft.domain) {
		entry.domain = draft.domain;
	}

	if (draft.name) {
		entry.name = draft.name;
	}
	// The schema default is `https`; only persist an explicit non-default protocol
	if (draft.protocol && draft.protocol !== 'https') {
		entry.protocol = draft.protocol;
	}

	if (draft.ignoreSSLErrors) {
		entry.ignoreSSLErrors = draft.ignoreSSLErrors;
	}

	if (draft.type === 'Custom' && draft.urls != null) {
		entry.urls = draft.urls;
	}

	return entry;
}
