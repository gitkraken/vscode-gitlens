export type GraphRowOperationExecState = 'generating' | 'complete' | 'backed' | 'error' | 'orphaned';

export interface GraphRowOperation {
	execState: GraphRowOperationExecState;
	result?: unknown;
}

export interface GraphRowOperations {
	review?: GraphRowOperation;
	compose?: GraphRowOperation;
	resolve?: GraphRowOperation;
}

/** Product-supplied presentation for an optional persistent action on a working-changes row. */
export interface GraphRowActivity {
	readonly action: string;
	readonly icon: string;
	readonly label: string;
	readonly className?: string;
	readonly status?: unknown;
}

/** Product hook for a working-changes row's native context-menu payload. */
export type GraphWipRowContextResolver = (
	worktreePath: string,
	secondary: boolean,
	hasConflicts: boolean,
) => string | undefined;
