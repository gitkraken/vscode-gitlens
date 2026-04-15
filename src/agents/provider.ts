// Re-export all types for backward compatibility with in-extension and webview consumers
export {
	type AgentProviderCallbacks,
	type AgentSession,
	type AgentSessionPhase,
	type AgentSessionProvider,
	type AgentSessionStatus,
	getPhaseForStatus,
	type PendingPermission,
	type PermissionSuggestion,
} from '@gitlens/agents/types.js';
