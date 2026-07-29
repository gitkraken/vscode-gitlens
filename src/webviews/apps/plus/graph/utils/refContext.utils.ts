import type { GitGraphRowHead, GitGraphRowRemoteHead, GitGraphRowTag } from '@gitlens/git/models/graph.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type {
	GraphBranchContextValue,
	GraphItemRefContext,
	GraphTagContextValue,
} from '../../../../plus/graph/protocol.js';

/**
 * Webview-side construction of the ref-pill `data-vscode-context` payloads, mirroring `rowContext.utils.ts`
 * for rows.
 *
 * Built here rather than shipped from the host as a serialized string per ref per row, which carries two
 * costs:
 *
 * 1. **Staleness.** The payload is built when the row is BUILT, so anything that changes without a rebuild
 *    stays wrong until an unrelated walk refreshes it — starring a branch, or pinning a ref, which is pure
 *    webview state the host is told about only because it happens to be the one serializing.
 * 2. **Wire weight.** A string per ref per row, for menus that open on a fraction of a percent of rows.
 *
 * Every input is structured on the wire (see `GitGraphRowHead`), so the webview can build these itself.
 *
 * ⚠ **They are still built EAGERLY**, once per row in `toGraphCommit`, not lazily at `contextmenu` capture.
 * That was a deliberate staging decision, not the end state: moving the build to capture time means
 * mutating `data-vscode-context` in a capture-phase listener before VS Code reads it, which is a real
 * behavioural change needing live verification. What buys correctness today is instead that the engine
 * session re-maps every row on every update, so a pin is picked up with no separate signal. Moving the build to capture time
 * is what removes the per-row JSON cost; the constraint to respect is that VS Code reads
 * `data-vscode-context` from a BUBBLE-phase listener on the window and bails if the event was
 * default-prevented, so any such build must be synchronous and must not `preventDefault`.
 *
 * ⚠ **Both the flag order and the serialized key order are load-bearing.** `when` clauses match
 * `webviewItem` with `=~`, and the payload has to stay byte-identical to the host's while both shapes are
 * valid. Key order is inherited rather than chosen: `serializeWebviewItemContext` is a bare
 * `JSON.stringify`, and `createReference` builds its own literal in a fixed order, so calling the same
 * helper with the same arguments is byte-equal by construction. The one hand-built value is `upstream`
 * (see {@link toReferenceUpstream}).
 */

/** Inputs the webview holds rather than the row: the currently pinned ref, if any. */
export interface RefContextState {
	pinnedRefId?: string;
}

/**
 * Rebuilds the `upstream` object the host passes into `createReference`.
 *
 * ⚠ Two traps here. First, `GitBranchReferenceOptions.upstream` is typed `{ name, missing }`, but the host
 * passes the LIVE `GitTrackingUpstream`, so `state` is serialized too despite the type — dropping it would
 * change the payload. Second, key order is `{ name, missing, state }` (see `branch.utils.ts:154` and
 * `statusParser.ts:87`, the two places these are constructed), and `JSON.stringify` preserves insertion
 * order, so the order below is the contract rather than a style choice.
 *
 * `undefined` members drop out of `JSON.stringify` entirely, which is what keeps a provider that computed
 * no tracking state (GitHub) from emitting `"missing":null`.
 */
function toReferenceUpstream(
	upstream: GitGraphRowHead['upstream'],
): { name: string; missing: boolean; state?: { ahead: number; behind: number } } | undefined {
	if (upstream == null) return undefined;

	// `missing` is optional on the wire (a producer may not compute it) but required on the reference. Every
	// producer that emits an upstream at all also emits `missing`, so the fallback is unreachable in
	// practice — it exists so the absent case cannot serialize as `null`.
	return {
		name: upstream.name,
		missing: upstream.missing ?? false,
		...(upstream.state != null ? { state: upstream.state } : undefined),
	};
}

/**
 * `gitlens:branch` + flags, in the host's order: `+current`, `+tracking`, `+worktree`/`+checkedout`,
 * `+starred`, `+ahead`, `+behind`, `+pinned`.
 *
 * `+worktree` vs `+checkedout`: the host tests `worktreesByBranch.has(head.id)`, a map with the MAIN
 * worktree removed, then falls back to comparing against the main worktree's branch id. The wire's
 * `head.worktree.isDefault` encodes exactly that split, so the webview needs neither collection.
 */
export function buildBranchWebviewItem(head: GitGraphRowHead, state?: RefContextState): string {
	let item = 'gitlens:branch';
	if (head.isCurrentHead) {
		item += '+current';
	}
	if (head.upstream != null) {
		item += '+tracking';
	}
	if (head.worktree != null) {
		item += head.worktree.isDefault ? '+checkedout' : '+worktree';
	}
	if (head.starred) {
		item += '+starred';
	}
	// `state` is absent when the producer didn't compute it (the GitHub provider ships no branch
	// metadata) — which must read as "unknown", not "zero", so neither flag is claimed.
	if (head.upstream?.state?.ahead) {
		item += '+ahead';
	}
	if (head.upstream?.state?.behind) {
		item += '+behind';
	}
	if (state?.pinnedRefId != null && head.id === state.pinnedRefId) {
		item += '+pinned';
	}
	return item;
}

/** `gitlens:branch+remote` + `+starred` + `+pinned`, in the host's order. */
export function buildRemoteBranchWebviewItem(remote: GitGraphRowRemoteHead, state?: RefContextState): string {
	let item = 'gitlens:branch+remote';
	if (remote.starred) {
		item += '+starred';
	}
	if (state?.pinnedRefId != null && remote.id === state.pinnedRefId) {
		item += '+pinned';
	}
	return item;
}

/** Tags carry no flags — kept here so all three ref kinds are built in one place. */
export function buildTagWebviewItem(): string {
	return 'gitlens:tag';
}

export function buildBranchRefContext(
	head: GitGraphRowHead,
	repoPath: string,
	state?: RefContextState,
): GraphItemRefContext<GraphBranchContextValue> {
	return {
		webviewItem: buildBranchWebviewItem(head, state),
		webviewItemValue: {
			type: 'branch',
			ref: createReference(head.name, repoPath, {
				id: head.id,
				refType: 'branch',
				name: head.name,
				remote: false,
				upstream: toReferenceUpstream(head.upstream),
			}),
			// A branch checked out in ANOTHER worktree must name it: `ref.repoPath` is the GRAPH's repo, so a
			// command falling back to it would act on the wrong worktree's changes. The DEFAULT worktree is
			// deliberately excluded — the host's map has it removed, and naming it would make every ordinary
			// checkout look like a worktree checkout.
			worktreePath: head.worktree != null && !head.worktree.isDefault ? head.worktree.path : undefined,
		},
	};
}

export function buildRemoteBranchRefContext(
	remote: GitGraphRowRemoteHead,
	repoPath: string,
	state?: RefContextState,
): GraphItemRefContext<GraphBranchContextValue> {
	const fullName = `${remote.owner}/${remote.name}`;
	return {
		webviewItem: buildRemoteBranchWebviewItem(remote, state),
		webviewItemValue: {
			type: 'branch',
			ref: createReference(fullName, repoPath, {
				id: remote.id,
				refType: 'branch',
				name: fullName,
				remote: true,
				// Not a tracking upstream — the host stores the REMOTE's name here, and consumers read it back
				// as the owner. Preserved verbatim rather than corrected, because changing it changes payloads.
				upstream: { name: remote.owner, missing: false },
			}),
		},
	};
}

export function buildTagRefContext(tag: GitGraphRowTag, repoPath: string): GraphItemRefContext<GraphTagContextValue> {
	return {
		webviewItem: buildTagWebviewItem(),
		webviewItemValue: {
			type: 'tag',
			ref: createReference(tag.name, repoPath, { id: tag.id, refType: 'tag', name: tag.name }),
		},
	};
}

/**
 * Serializes a ref's context, or `undefined` for a LEAN ref — see {@link GitGraphRowHead.id}.
 *
 * ⚠ The id check is not defensive tidiness, it is the whole behaviour for virtual repos. The GitHub
 * provider never runs the row processor, so those rows have never carried a ref context and their pills
 * have never had a right-click menu. Emitting one now would surface the entire local-branch menu on
 * vscode.dev — Delete Branch, Rename, Switch to, Merge, Rebase, Reset, Create Worktree, Publish, Set
 * Upstream — against a provider that can perform none of it. Suppressing it keeps the surface exactly as
 * it is today. (A curated read-only subset for virtual repos would be a real improvement, but it needs
 * `when`-clause work to express "valid without a working tree", not an accident of this refactor.)
 */
export function serializeBranchRefContext(
	head: GitGraphRowHead,
	repoPath: string,
	state?: RefContextState,
): string | undefined {
	if (head.id == null) return undefined;

	return serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(
		buildBranchRefContext(head, repoPath, state),
	);
}

/** See {@link serializeBranchRefContext} — a lean ref gets no context. */
export function serializeRemoteBranchRefContext(
	remote: GitGraphRowRemoteHead,
	repoPath: string,
	state?: RefContextState,
): string | undefined {
	if (remote.id == null) return undefined;

	return serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(
		buildRemoteBranchRefContext(remote, repoPath, state),
	);
}

/** See {@link serializeBranchRefContext} — a lean ref gets no context. */
export function serializeTagRefContext(tag: GitGraphRowTag, repoPath: string): string | undefined {
	if (tag.id == null) return undefined;

	return serializeWebviewItemContext<GraphItemRefContext<GraphTagContextValue>>(buildTagRefContext(tag, repoPath));
}
