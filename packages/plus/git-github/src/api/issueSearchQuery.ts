import type {
	IssueSearchCriteria,
	IssueSearchRelationship,
	IssueSortField,
	IssueSorting,
} from '@gitlens/git/models/issue.js';

/**
 * Translation of the provider-neutral issue-search criteria into GitHub search qualifiers, and the sanitizing
 * that keeps user input from becoming one.
 *
 * A module of its own because it is pure string building with no client, no token and no network — the part of the
 * search that is worth reading, testing and reasoning about on its own, and the part where a mistake is a
 * SECURITY mistake rather than a failed request: an unsanitized value that escapes its qualifier re-scopes
 * someone's search. Keeping it out of the 4000-line API client is what makes that reviewable.
 */

/**
 * Neutralizes everything in a user-supplied value that could break out of the qualifier it lands in: the double
 * quote that would close its own `"…"`, and the control characters that cannot appear in a GitHub search query
 * and exist here only as a smuggling vector.
 *
 * Not a general escape — GitHub search has no escape syntax — so the only safe transformation is removal. But a
 * control character is REPLACED WITH A SPACE rather than deleted, because deleting it FUSES the words it separated:
 * a pasted or multi-line `graph\nperformance` became the single token `graphperformance`, which matches nothing —
 * turning a search that had results into a silent zero (measured: 2 results vs 0). Quotes are still deleted
 * outright; they separate nothing, so a space there would only pad the value.
 *
 * Runs of whitespace are collapsed afterwards so the emitted qualifier stays canonical — a doubled space inside
 * `label:"a  b"` would not match the label `a b`.
 */
export function sanitizeGitHubQualifierValue(value: string): string {
	return (
		value
			.replace(/"/g, '')
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/**
 * Sanitizes free text, which is a different problem from a qualifier value: bare words are the POINT here, so it
 * can't just be quoted. What must not survive is anything that would read as a qualifier — GitHub parses any
 * whitespace-delimited `key:value` token as one, so a user typing `foo org:someone-else` would otherwise re-scope
 * the search to another org.
 *
 * Tokens containing `:` are dropped whole rather than having the colon removed: the remainder would silently
 * change what the user searched for, and a dropped token at least matches nothing extra. The structured criteria
 * are the qualifier channel.
 */
export function sanitizeGitHubSearchText(text: string): string {
	return sanitizeGitHubQualifierValue(text)
		.split(/\s+/)
		.filter(token => token.length > 0 && !token.includes(':'))
		.join(' ');
}

/**
 * How each relationship is expressed: its GitHub search qualifier (`@me` binds to the token's own user), and the
 * GraphQL alias its search runs under.
 *
 * The aliases are LITERALS rather than derived from the relationship name, for two reasons: `any-assignee` is not
 * a valid GraphQL name, and an alias is also a persisted cursor key (see {@link GitHubApi.searchIssuesByAlias}),
 * so it must be stable across releases — spelling them out makes that immovability visible instead of an
 * emergent property of a transform. Being a `Record` over the union, the type fails the build if a relationship
 * is added without both, rather than silently emitting an unconstrained search.
 */
export const gitHubIssueSearchRelationships: Record<IssueSearchRelationship, { qualifier: string; alias: string }> = {
	authored: { qualifier: 'author:@me', alias: 'authored' },
	assigned: { qualifier: 'assignee:@me', alias: 'assigned' },
	mentioned: { qualifier: 'mentions:@me', alias: 'mentioned' },
	'any-assignee': { qualifier: 'assignee:*', alias: 'anyAssignee' },
	unassigned: { qualifier: 'no:assignee', alias: 'unassigned' },
};

/**
 * How each orderable key becomes a GitHub `sort:` qualifier.
 *
 * A literal table rather than a derived transform, for the same reason {@link gitHubIssueSearchRelationships} is
 * one: being a `Record` over the union means adding a sort field without deciding its qualifier FAILS THE BUILD,
 * instead of quietly emitting a search with no ordering constraint at all — which is the one failure mode the
 * ordering contract exists to prevent, and the one a caller cannot detect from the result.
 *
 * `updated:desc` maps to the bare `sort:updated`, not `sort:updated-desc`. The two are the same query to GitHub,
 * but the bare form is what this read has always emitted, so keeping it makes the default byte-identical to
 * today's query — and the exact-query tests and recorded fixtures stay valid. Do not "normalize" it.
 *
 * `reactions` maps to the per-emoji `sort:reactions-+1`, NOT the bare `sort:reactions`. GitHub's bare form orders
 * by the total across every reaction type, but the only reaction count on an `IssueShape` is `thumbsUpCount`,
 * which this client fills from `reactions(content: THUMBS_UP)`. Ordering by the total would rank the page by a
 * number the caller cannot see — and would disagree with `getIssueComparator`, which re-sorts a merged page from
 * `thumbsUpCount`, so the same request would order one way with a single relationship and another way with two.
 * `@gitkraken/provider-apis` maps it the same way for the same reason.
 *
 * Absent keys are absent on purpose: `closed` is NOT here even though `IssueShape.closedDate` exists, because
 * GitHub's search cannot order by close date and a client-side sort over a page cut off at the result ceiling is
 * exactly the lie the contract avoids. `sorts` in `githubIssueSearchCapabilities` is the same set, and a parity
 * test pins the two together.
 */
export const gitHubIssueSortQualifiers: Partial<Record<IssueSorting, string>> = {
	'created:asc': 'sort:created-asc',
	'created:desc': 'sort:created-desc',
	'updated:asc': 'sort:updated-asc',
	'updated:desc': 'sort:updated',
	'comments:asc': 'sort:comments-asc',
	'comments:desc': 'sort:comments-desc',
	'reactions:asc': 'sort:reactions-+1-asc',
	'reactions:desc': 'sort:reactions-+1-desc',
};

/**
 * The `sort:` qualifier for a key, or `undefined` when there is no key or GitHub can't express it.
 *
 * Applies no default of its own: the two callers differ on whether they HAVE one — the filtered search always
 * orders, and `searchMyIssues` has never requested an order at all — so the default belongs at the call site that
 * has one rather than behind a guard at the one that doesn't.
 *
 * `undefined` for an inexpressible key rather than a fallback to something orderable: every caller validated
 * against the declared capability first, so reaching that case means the capability table has outrun this one, and
 * a silently unordered search would change which rows land inside the result ceiling.
 */
export function toGitHubIssueSortQualifier(sort: IssueSorting | undefined): string | undefined {
	return sort != null ? gitHubIssueSortQualifiers[sort] : undefined;
}

/**
 * The sort keys a CEILING SLIDE can continue past, and the qualifier each one continues with.
 *
 * The slide works by re-issuing the search bounded to the far side of what has already been served, which needs
 * two things from the sort key: a value carried on the returned issue (so the boundary can be read off the last
 * item), and a GitHub range qualifier over that same value (so the continuation can be expressed). Only the two
 * date keys have both. `comments`/`reactions` have range qualifiers but their values are unstable under
 * concurrent activity — a comment added mid-walk moves an issue across the boundary, which would drop or repeat
 * it — and `title` has no range qualifier at all. Those keep reporting the ceiling instead, which is correct
 * rather than a gap: the read stays truthful about what it could not reach.
 *
 * A `Partial<Record<…>>` over the union rather than a lookup with a default, so a sort key added later is
 * NOT-slidable by construction and has to be opted in deliberately.
 */
const gitHubSlidableSortFields: Partial<Record<IssueSortField, string>> = {
	created: 'created',
	updated: 'updated',
};

/**
 * The qualifier that continues a search past the provider's result ceiling: everything at or beyond the last
 * item already served, under the same key the search is ordered by.
 *
 * INCLUSIVE (`<=` / `>=`) rather than exclusive, and that is a correctness requirement rather than a preference.
 * GitHub timestamps have one-second resolution and ties genuinely occur (measured: one shared second in a
 * 100-issue sample), so an exclusive bound would silently drop every issue sharing the boundary second with the
 * last one served. Being inclusive re-serves that second instead, which the caller dedupes.
 *
 * Returns `undefined` when the key can't be slid ({@link gitHubSlidableSortFields}), which is the signal to
 * report the ceiling rather than to continue.
 */
export function toGitHubIssueSearchSlideQualifier(sort: IssueSorting, boundary: Date): string | undefined {
	const [field, direction] = sort.split(':') as [IssueSortField, 'asc' | 'desc'];
	const qualifier = gitHubSlidableSortFields[field];
	if (qualifier == null) return undefined;

	// Whole seconds, matching both GitHub's own resolution and what its range qualifiers accept.
	const value = boundary.toISOString().replace(/\.\d{3}Z$/, 'Z');
	// Descending walks toward older, so the remainder is everything at or BEFORE the boundary; ascending is the
	// mirror. Getting this backwards would re-request the half already served, forever.
	return `${qualifier}:${direction === 'desc' ? '<=' : '>='}${value}`;
}

/**
 * The scope half of an issue search query: `org:` plus one `repo:` per repository.
 *
 * Shared by the search and the count probe rather than written twice, because the count is only meaningful if it
 * applies EXACTLY the qualifiers the search would — a count under different constraints is a wrong number, not a
 * missing one. A value emptied by sanitizing is dropped rather than emitted as a bare `org:`/`repo:`, which
 * GitHub rejects; that is the same rule {@link toGitHubIssueSearchQualifiers} applies to its own values.
 */
export function toGitHubIssueSearchScopeQualifiers(
	org: string | undefined,
	repos: readonly string[] | undefined,
): string[] {
	const qualifiers: string[] = [];

	if (org != null) {
		const value = sanitizeGitHubQualifierValue(org);
		if (value.length > 0) {
			qualifiers.push(`org:${value}`);
		}
	}

	for (const repo of repos ?? []) {
		const value = sanitizeGitHubQualifierValue(repo);
		if (value.length > 0) {
			qualifiers.push(`repo:${value}`);
		}
	}

	return qualifiers;
}

/**
 * Translates the provider-neutral criteria into GitHub search qualifiers, EXCLUDING the relationship (which
 * becomes its own aliased search, since GitHub AND-s qualifiers and relationships are OR-ed) and excluding the
 * repository/org scope (which {@link toGitHubIssueSearchScopeQualifiers} owns).
 *
 * A `sort:` qualifier is ALWAYS emitted. Never none: the provider serves at most a bounded window of matches, and
 * without an explicit order GitHub answers in relevance order, so which rows land inside that window would shift
 * with GitHub's ranking even when nothing changed upstream. A key GitHub can't express is refused before this by
 * the facade, so it cannot arrive here.
 *
 * `sort` is passed in rather than read off `criteria` so that the qualifier this emits and the key the caller
 * records elsewhere cannot disagree — see `effectiveIssueSort`.
 *
 * Free-form values go through the sanitizers above, and one emptied by sanitizing is dropped rather than emitted
 * as an empty qualifier.
 */
export function toGitHubIssueSearchQualifiers(criteria: IssueSearchCriteria | undefined, sort: IssueSorting): string[] {
	const qualifiers = ['type:issue'];

	switch (criteria?.state) {
		case 'closed':
			qualifiers.push('is:closed');
			break;
		// Every state — no qualifier constrains it.
		case 'all':
			break;
		default:
			qualifiers.push('is:open');
			break;
	}

	if (criteria?.includeArchived !== true) {
		qualifiers.push('archived:false');
	}

	// One place to keep the "a value emptied by sanitizing is DROPPED, never emitted as an empty qualifier" rule,
	// so a criterion added later can't skip it — a bare `milestone:""` is rejected by GitHub outright.
	const pushSanitized = (value: string | undefined, toQualifier: (sanitized: string) => string): void => {
		if (value == null) return;

		const sanitized = sanitizeGitHubQualifierValue(value);
		if (sanitized.length > 0) {
			qualifiers.push(toQualifier(sanitized));
		}
	};

	for (const label of criteria?.labels ?? []) {
		pushSanitized(label, v => `label:"${v}"`);
	}
	pushSanitized(criteria?.milestone, v => `milestone:"${v}"`);
	pushSanitized(criteria?.updatedAfter, v => `updated:>=${v}`);
	pushSanitized(criteria?.createdAfter, v => `created:>=${v}`);

	if (criteria?.withoutLinkedPullRequest === true) {
		qualifiers.push('-linked:pr');
	}

	if (criteria?.text != null) {
		const text = sanitizeGitHubSearchText(criteria.text);
		if (text.length > 0) {
			qualifiers.push(text);
		}
	}

	// Last, where it has always been: the exact-query tests pin the whole qualifier string, not a set.
	const sortQualifier = toGitHubIssueSortQualifier(sort);
	if (sortQualifier != null) {
		qualifiers.push(sortQualifier);
	}

	return qualifiers;
}
