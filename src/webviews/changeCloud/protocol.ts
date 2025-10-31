import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand } from '../protocol';

export const scope: IpcScope = 'changeCloud';

export interface ChangeCloudTerm {
	term: string;
	weight: number;
	category: 'business' | 'technical';
	reasoning: string;
}

export interface ChangeCloudData {
	terms: ChangeCloudTerm[];
	summary: string;
	total_files: number;
	total_commits: number;
}

export interface State extends WebviewState {
	data: ChangeCloudData | null;
	error: string | null;
}

export interface SelectTermParams {
	term: string | null;
}

export const SelectTermCommand = new IpcCommand<SelectTermParams>(scope, 'term/select');

