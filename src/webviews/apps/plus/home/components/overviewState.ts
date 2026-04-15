import { createContext } from '@lit/context';
import type {
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
	OverviewFilters,
} from '../../../../home/protocol.js';
import type { ReadableSignal } from '../../../shared/state/signals.js';

export type ActiveOverview = GetActiveOverviewResponse;
export type InactiveOverview = GetInactiveOverviewResponse;

/**
 * Interface for the active overview state consumed by child components via Lit context.
 * Backed by a Resource in home.ts.
 */
export interface ActiveOverviewState {
	readonly value: ReadableSignal<ActiveOverview>;
	readonly loading: ReadableSignal<boolean>;
	readonly error: ReadableSignal<string | undefined>;
	fetch(): void;
	changeRepository(): void;
}

/**
 * Interface for the inactive overview state consumed by child components via Lit context.
 * Backed by a Resource in home.ts.
 */
export interface InactiveOverviewState {
	readonly value: ReadableSignal<InactiveOverview>;
	readonly loading: ReadableSignal<boolean>;
	readonly error: ReadableSignal<string | undefined>;
	filter: Partial<OverviewFilters>;
	fetch(): void;
}

/**
 * Interface for the agent overview state consumed by child components via Lit context.
 * Backed by a Resource in home.ts. Shows branches with active agent sessions.
 */
export interface AgentOverviewState {
	readonly value: ReadableSignal<InactiveOverview>;
	readonly loading: ReadableSignal<boolean>;
	readonly error: ReadableSignal<string | undefined>;
	fetch(): void;
}

export const activeOverviewStateContext = createContext<ActiveOverviewState>('activeOverviewState');
export const inactiveOverviewStateContext = createContext<InactiveOverviewState>('inactiveOverviewState');
export const agentOverviewStateContext = createContext<AgentOverviewState>('agentOverviewState');
