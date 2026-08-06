import type {
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRefs,
	GraphRefOptData,
	GraphSidebarBranch,
	GraphSidebarRemote,
	GraphSidebarTag,
} from '../../../../plus/graph/protocol.js';
import { emptySetMarker } from '../../../../plus/graph/protocol.js';
import { parseFilterTerms } from '../../../shared/utils/filter-match.js';
import { refPillKey } from './refKey.utils.js';

/**
 * Ref find ("jump to a ref by name") vocabulary, shared by the header trigger and the find widget.
 *
 * Candidates come from the sidebar panels rather than the loaded rows: `refRowIndex` only knows refs
 * whose tips have been paged in, so building from it would silently hide every ref below the window
 * — exactly the refs a name search is most useful for.
 */

/** The ref categories the find widget offers. Stashes are deliberately absent — they aren't named refs. */
export type RefFindKind = 'head' | 'remote' | 'tag';

export interface RefFindCandidate {
	kind: RefFindKind;
	/** Bare ref name (`main`) — with `owner`, the input to `refPillKey`. */
	name: string;
	/** Remote alias (`origin`); remotes only. */
	owner?: string;
	/** What the user sees and what the query matches: `owner/name` for a remote, `name` otherwise. */
	label: string;
	/** Extra names this candidate also answers to (see the in-sync fold in `buildRefFindCandidates`). */
	aliases?: readonly string[];
	sha: string;
	/** Tip commit date. Orders refs whose rows aren't loaded; remote branches don't carry one. */
	date?: number;
	current?: boolean;
}

export interface RefFindMatch extends RefFindCandidate {
	/** Higher is better. Only meaningful for choosing the landing match — stepping uses graph order. */
	score: number;
	/** Position in `processedRows`, or `undefined` when the tip row isn't loaded. */
	rowIndex?: number;
}

export interface RefFindFilters {
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
}

export interface RefFindSources {
	branches?: readonly GraphSidebarBranch[];
	remotes?: readonly GraphSidebarRemote[];
	tags?: readonly GraphSidebarTag[];
}

/**
 * Projects a filter map to a set of {@link refPillKey}s. Matches on the entries' `name`/`type`/`owner`
 * rather than the map keys, which are `<repoPath>|heads/<name>` ids the webview can't rebuild from
 * sidebar data. A remote entry carries a BARE `name` with the owner in `.owner` (see
 * `graphWebview.ts`'s `convertBranchToIncludeOnlyRef`), which is exactly the shape `refPillKey` takes — so hiding
 * `origin/main` leaves an identically-named branch on another remote findable.
 *
 * `undefined` means "no filter". A map holding only {@link emptySetMarker} yields an EMPTY set, not
 * `undefined` — as an include-only filter that correctly admits nothing.
 */
function toRefKeySet(refs: Record<string, GraphRefOptData> | undefined): Set<string> | undefined {
	if (refs == null) return undefined;

	const entries = Object.entries(refs);
	if (entries.length === 0) return undefined;

	const keys = new Set<string>();
	for (const [key, ref] of entries) {
		if (key === emptySetMarker || ref?.name == null) continue;
		// `worktree` refs have no jump candidate to match, so they never contribute a key.
		if (ref.type !== 'head' && ref.type !== 'remote' && ref.type !== 'tag') continue;

		keys.add(refPillKey({ kind: ref.type, name: ref.name, owner: ref.owner }));
	}
	return keys;
}

function isTypeExcluded(kind: RefFindKind, excludeTypes: GraphExcludeTypes | undefined): boolean {
	if (excludeTypes == null) return false;

	switch (kind) {
		case 'head':
			return excludeTypes.heads === true;
		case 'remote':
			return excludeTypes.remotes === true;
		case 'tag':
			return excludeTypes.tags === true;
	}
}

/**
 * Assembles the jump candidates from the branches/remotes/tags sidebar payloads, dropping anything
 * the live filters hide — jumping to a ref the user deliberately hid would silently undo that choice.
 *
 * The branches panel carries REMOTE branches too (the default remote's, when
 * `views.branches.showRemoteBranches` is on — see `getSidebarBranches`), already fully qualified. Those
 * are skipped here: the remotes panel is the authoritative source for them, and adding one as a `head`
 * would mint a `head:origin/foo` key no pill can ever carry — the jump would land on the right row with
 * nothing highlighted, and the same ref would list twice.
 *
 * Remote branches arrive unqualified under their parent remote, so their names are qualified here.
 */
export function buildRefFindCandidates(sources: RefFindSources, filters?: RefFindFilters): RefFindCandidate[] {
	const excluded = toRefKeySet(filters?.excludeRefs);
	const includeOnly = toRefKeySet(filters?.includeOnlyRefs);
	const excludeTypes = filters?.excludeTypes;

	const candidates: RefFindCandidate[] = [];
	const seen = new Set<string>();

	// Whether a ref survives the live filters. Split out of `add` because the in-sync fold below has to
	// ask the same question WITHOUT adding: a remote the filters hide must not reach the candidate list
	// as an alias on its local either, or "Hide Remote Branches" (or hiding that one remote branch)
	// would still leave `origin/main` typeable.
	function isVisible(kind: RefFindKind, key: string, sha: string | undefined): boolean {
		// No tip sha means nothing to navigate to.
		if (sha == null || !sha) return false;
		if (isTypeExcluded(kind, excludeTypes)) return false;
		if (excluded?.has(key)) return false;
		if (includeOnly != null && !includeOnly.has(key)) return false;

		return true;
	}

	function add(
		kind: RefFindKind,
		name: string,
		owner: string | undefined,
		sha: string | undefined,
		date?: number,
		current?: boolean,
	): RefFindCandidate | undefined {
		// Repeated from `isVisible` (which can't narrow through the call) so `sha` is a string below.
		if (sha == null || !sha) return undefined;

		// One key for filtering AND dedup: `refPillKey` is owner-aware, so two remotes' same-named
		// branches neither collide here nor get hidden by a filter naming only one of them.
		const key = refPillKey({ kind: kind, name: name, owner: owner });
		if (!isVisible(kind, key, sha)) return undefined;
		if (seen.has(key)) return undefined;

		seen.add(key);
		const candidate: RefFindCandidate = {
			kind: kind,
			name: name,
			owner: owner,
			label: kind === 'remote' && owner != null ? `${owner}/${name}` : name,
			sha: sha,
			date: date,
			current: current,
		};
		candidates.push(candidate);
		return candidate;
	}

	// Local branches configured with a given upstream name, keyed by that name. A `Map<name, list>`
	// rather than last-write-wins: two locals can share an upstream name, and only the one whose sha
	// actually matches the remote's is in sync with it — the other must stay its own candidate.
	const localsByUpstreamName = new Map<string, RefFindCandidate[]>();

	for (const branch of sources.branches ?? []) {
		// The remotes loop below owns these, with the owner split out so the key matches the rendered pill.
		if (branch.remote) continue;

		const candidate = add('head', branch.name, undefined, branch.sha, branch.date, branch.current);
		if (candidate != null && branch.upstream?.name != null) {
			const locals = localsByUpstreamName.get(branch.upstream.name);
			if (locals != null) {
				locals.push(candidate);
			} else {
				localsByUpstreamName.set(branch.upstream.name, [candidate]);
			}
		}
	}
	for (const remote of sources.remotes ?? []) {
		for (const branch of remote.branches) {
			const qualifiedName = `${remote.name}/${branch.name}`;

			// Fold into the local that's actually in sync (same sha) — the graph renders them as ONE
			// combined pill (see `refAdornmentProvider`), so offering both here would make `↓` land on
			// the same row twice. The remote stays findable by its qualified name via the alias.
			//
			// Gated on the remote's OWN visibility: the fold skips `add`, so without this a remote the
			// filters hide would still be typeable through the alias it left on its local.
			const inSyncLocal =
				branch.sha != null &&
				isVisible('remote', refPillKey({ kind: 'remote', name: branch.name, owner: remote.name }), branch.sha)
					? localsByUpstreamName.get(qualifiedName)?.find(c => c.sha === branch.sha)
					: undefined;
			if (inSyncLocal != null) {
				inSyncLocal.aliases = [...(inSyncLocal.aliases ?? []), qualifiedName];
				continue;
			}

			add('remote', branch.name, remote.name, branch.sha);
		}
	}
	for (const tag of sources.tags ?? []) {
		add('tag', tag.name, undefined, tag.sha, tag.date);
	}

	return candidates;
}

/**
 * Graph order, so `↓` means "the next match further down" rather than "the next-best score".
 *
 * Loaded refs sort by row index; unloaded refs trail them, newest first. An unloaded ref sits below
 * the paged window by definition, so trailing the loaded ones keeps the walk spatially honest.
 */
function compareByGraphOrder(a: RefFindMatch, b: RefFindMatch): number {
	const aIndex = a.rowIndex;
	const bIndex = b.rowIndex;
	if (aIndex != null && bIndex != null) return aIndex - bIndex;
	if (aIndex != null) return -1;
	if (bIndex != null) return 1;

	if (a.date !== b.date) {
		// Dateless refs (remote branches) can't be placed, so they go last.
		if (a.date == null) return 1;
		if (b.date == null) return -1;
		return b.date - a.date;
	}
	return a.label.localeCompare(b.label);
}

/**
 * Re-resolves each match's row index and re-sorts. Used after rows page in — a ref that was
 * unloaded (and so could only offer a Load action) becomes an ordinary jump target once its row
 * arrives, and moves into its rightful place in the walk.
 */
export function refreshMatchRows(
	matches: readonly RefFindMatch[],
	getRowIndex: (sha: string) => number | undefined,
): RefFindMatch[] {
	return matches.map(m => ({ ...m, rowIndex: getRowIndex(m.sha) })).sort(compareByGraphOrder);
}

/**
 * Matches a `/`-bearing term against the ref's path segments — `d/f/foo` finds `debt/feature/foo`.
 *
 * Term segments must match name segments IN ORDER, and name segments may be skipped, so `d/foo`
 * also finds `debt/feature/foo` and `origin/debt/feature/foo`. Segment boundaries are what keep
 * this tight: unlike a free subsequence over the whole string, a segment can only be consumed by
 * one term segment, so the combinatorial blow-up that made plain fuzzy matching useless here can't
 * happen.
 *
 * Returns how WELL it matched, for scoring: whether every segment matched by prefix (rather than
 * merely containing the term), whether the ref's leaf segment was consumed — and if so, whether that
 * segment EQUALS the final term segment rather than merely containing/prefixing it — and how many
 * segments were skipped. `undefined` means no match.
 */
function matchPathSegments(
	nameSegs: readonly string[],
	termSegs: readonly string[],
): { allPrefix: boolean; leafMatched: boolean; leafExact: boolean; skipped: number } | undefined {
	let nameIndex = 0;
	let skipped = 0;
	let allPrefix = true;
	let leafMatched = false;
	let leafExact = false;

	for (const termSeg of termSegs) {
		let found = false;
		while (nameIndex < nameSegs.length) {
			const nameSeg = nameSegs[nameIndex];
			nameIndex++;

			if (nameSeg.includes(termSeg)) {
				found = true;
				if (!nameSeg.startsWith(termSeg)) {
					allPrefix = false;
				}
				leafMatched = nameIndex === nameSegs.length;
				leafExact = leafMatched && nameSeg === termSeg;
				break;
			}

			skipped++;
		}

		if (!found) return undefined;
	}

	return { allPrefix: allPrefix, leafMatched: leafMatched, leafExact: leafExact, skipped: skipped };
}

/**
 * Scores one term against a ref name, or `undefined` when it doesn't match.
 *
 * A term containing `/` is matched SEGMENT-WISE against the ref's path (see
 * {@link matchPathSegments}); a plain term is matched as an exact substring of the whole name.
 *
 * Substring, never free subsequence: ref names are path-like, and subsequence matching over a real
 * repo's refs is uselessly broad — on a 1105-ref repo `gra` subsequence-matched 362 of them, and
 * `find` dragged in `feature/related-indexing`. This is the same reasoning behind `matchesTerms`
 * reserving substring matching for path-like `filterText`.
 */
function scoreTerm(lower: string, nameSegs: readonly string[], term: string): number | undefined {
	if (term.includes('/')) {
		const termSegs = term.split('/').filter(t => t.length > 0);
		if (termSegs.length === 0) return undefined;

		const result = matchPathSegments(nameSegs, termSegs);
		if (result == null) return undefined;

		// Naming the leaf is the strongest signal you meant this ref — exact more so than a segment that
		// merely starts with or contains the term (`foo` vs `foo-extra-long-tail`); prefix beats
		// mid-segment; each skipped segment means you named less of the path than it has.
		let score = result.allPrefix ? 0.85 : 0.65;
		if (result.leafMatched) {
			score += result.leafExact ? 0.1 : 0.05;
		}
		return Math.max(0.3, score - Math.min(result.skipped, 4) * 0.03);
	}

	const index = lower.indexOf(term);
	if (index === -1) return undefined;

	// Tiers, strongest first — the whole name, a leading prefix, then the leaf segment, so typing
	// `main` still ranks `origin/main` above an incidental hit inside a longer name.
	if (lower === term) return 1;
	if (lower.startsWith(term)) return 0.9;
	if (nameSegs.at(-1)?.startsWith(term) === true) return 0.8;

	// Matched somewhere else: earlier hits and shorter (more specific) names rank higher. Bounded
	// below 0.8 so this can never outrank a prefix hit.
	return 0.7 - Math.min(index, 40) / 100 - Math.min(lower.length, 80) / 1000;
}

/** Scores a ref name against all terms (AND). The weakest term decides — one vague term shouldn't
 *  be lifted by a precise one sitting beside it. */
function scoreRefName(name: string, terms: string[]): number | undefined {
	const lower = name.toLowerCase();
	const nameSegs = lower.split('/');

	let weakest = Number.POSITIVE_INFINITY;
	for (const term of terms) {
		const score = scoreTerm(lower, nameSegs, term);
		if (score == null) return undefined;

		if (score < weakest) {
			weakest = score;
		}
	}
	return weakest;
}

/**
 * Scores a candidate against all terms, trying its `label` and each alias and keeping the BEST
 * (maximum) — aliases are alternative names for the same ref, so the strongest one should win, unlike
 * {@link scoreRefName}'s within-one-name terms, where the weakest decides.
 */
function scoreCandidate(candidate: RefFindCandidate, terms: string[]): number | undefined {
	let best: number | undefined;
	for (const name of [candidate.label, ...(candidate.aliases ?? [])]) {
		const score = scoreRefName(name, terms);
		if (score != null && (best == null || score > best)) {
			best = score;
		}
	}
	return best;
}

/**
 * Matches `query` against the candidates and returns them in GRAPH order (not score order) — the
 * order `↓`/`↑` step through and the `N of M` count is read against.
 *
 * An empty query yields no matches: there is nothing to step through until the user types.
 */
export function matchRefs(
	query: string,
	candidates: RefFindCandidate[],
	getRowIndex: (sha: string) => number | undefined,
): RefFindMatch[] {
	const terms = parseFilterTerms(query);
	if (terms.length === 0) return [];

	const matches: RefFindMatch[] = [];
	for (const candidate of candidates) {
		const score = scoreCandidate(candidate, terms);
		if (score == null) continue;

		matches.push({ ...candidate, score: score, rowIndex: getRowIndex(candidate.sha) });
	}
	return matches.sort(compareByGraphOrder);
}

/**
 * The match to land on when the query changes — the best-scoring one, so typing `gra` goes to the
 * closest name rather than whichever match happens to sit highest in the graph. Stepping afterwards
 * walks {@link matchRefs}' graph order from there.
 *
 * Returns an index into `matches`, or `-1` when there are none. Ties prefer the current branch, then
 * the earlier row (`matches` is already graph-ordered, so the first one wins).
 */
export function pickInitialTargetIndex(matches: readonly RefFindMatch[]): number {
	if (matches.length === 0) return -1;

	let best = 0;
	for (let i = 1; i < matches.length; i++) {
		const candidate = matches[i];
		const incumbent = matches[best];
		if (candidate.score > incumbent.score) {
			best = i;
		} else if (candidate.score === incumbent.score && candidate.current === true && incumbent.current !== true) {
			best = i;
		}
	}
	return best;
}

/**
 * Shortens a ref name for display, keeping the END — the part that identifies it.
 *
 * Branch names get long, and a trailing ellipsis would eat exactly the distinguishing half
 * (`origin/feature/some-long-thing` → `origin/feature/some-lo…`). So drop leading path segments
 * first (`…/some-long-thing`), and only chop into the leaf itself when even that won't fit.
 *
 * Deliberately character-based rather than a CSS `direction: rtl` ellipsis: the bidi trick reorders
 * punctuation around a string's edges, and this renders in a monospace face, where characters are a
 * faithful stand-in for width.
 */
export function elideRefName(name: string, max = 28): string {
	if (max <= 1 || name.length <= max) return name;

	// Drop leading segments ONE AT A TIME, keeping the longest tail that still fits. Dropping straight to
	// the leaf is what the budget allows at worst, not what it allows at best — `origin/feature/foo` in 28
	// has room for `…/feature/foo`, and throwing `feature/` away too just leaves the line short.
	const segments = name.split('/');
	for (let i = 1; i < segments.length; i++) {
		const tail = segments.slice(i).join('/');
		if (tail.length + 2 <= max) return `…/${tail}`;
	}

	// Even the leaf alone overflows, so chop into it — still from the head, so the tail survives.
	// `split` always yields at least one entry, so the fallback is unreachable — it just keeps the type honest.
	const leaf = segments.at(-1) ?? name;
	return `…${leaf.slice(leaf.length - (max - 1))}`;
}

/** Steps the match cursor, wrapping at both ends so `↓` from the last match returns to the first. */
export function stepMatchIndex(current: number, total: number, direction: 1 | -1): number {
	if (total <= 0) return -1;

	return (current + direction + total) % total;
}
