import type { Disposable, Event } from 'vscode';

export type AgentSessionStatus =
	| 'thinking'
	| 'tool_use'
	| 'responding'
	| 'waiting'
	| 'idle'
	| 'compacting'
	| 'permission_requested';

export interface PermissionSuggestion {
	readonly type: string;
	readonly tool?: string;
	readonly rules?: readonly { readonly toolName: string; readonly ruleContent?: string }[];
	readonly destination?: string;
}

export interface PendingPermission {
	readonly toolName: string;
	readonly toolDescription: string;
	readonly toolInputDescription?: string;
	readonly suggestions?: readonly PermissionSuggestion[];
}

export interface AgentSession {
	readonly id: string;
	readonly providerId: string;
	readonly name: string;
	readonly status: AgentSessionStatus;
	readonly statusDetail?: string;
	readonly branch?: string;
	readonly pid?: number;
	readonly lastActivity: Date;
	readonly isSubagent: boolean;
	readonly parentId?: string;
	readonly subagents?: readonly AgentSession[];
	readonly pendingPermission?: PendingPermission;
	readonly workspacePath?: string;
	readonly isLocal: boolean;
}

export interface AgentSessionProvider extends Disposable {
	readonly id: string;
	readonly name: string;
	readonly icon: string;

	readonly onDidChangeSessions: Event<void>;
	readonly sessions: readonly AgentSession[];

	start(workspacePaths: string[]): void;
	stop(): void;

	resolvePermission?(
		sessionId: string,
		decision: 'allow' | 'deny',
		updatedPermissions?: PermissionSuggestion[],
	): void;
}
