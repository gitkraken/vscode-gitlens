/**
 * Graph-owned seam for details types. All graph-side imports should come from here —
 * not from `commitDetails/protocol.ts` — so shapes can diverge from the commit-details
 * versions without coupled edits. Today every type is a re-export; when graph needs a
 * diverged shape, define it here and drop the corresponding re-export.
 */
export type {
	CommitDetails,
	CommitFileChange,
	CommitSignatureShape,
	CompareDiff,
	DetailsFileContextValue,
	DetailsItemContext,
	DetailsItemTypedContext,
	DetailsItemTypedContextValue,
	GitBranchShape,
	Preferences,
	State,
	Wip,
} from '../../commitDetails/protocol.js';

export { messageHeadlineSplitterToken } from '../../commitDetails/protocol.js';
