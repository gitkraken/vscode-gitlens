import type { IssuesCloudHostIntegrationId } from '../constants.js';

export type IssueTrackerWriteConnection = {
	providerId: IssuesCloudHostIntegrationId.Jira;
	connectionId: string;
	resourceId: string;
	expectedAccountId?: string;
};

type IssueTrackerIssueAddress = IssueTrackerWriteConnection & { issue: string; expectedIssueId?: string };
type IssueTrackerExistingIssue = IssueTrackerIssueAddress & { expectedIssueId: string };
type IssueTrackerEditableFields = {
	description?: string;
	fields?: Readonly<Record<string, unknown>>;
};

export type IssueTrackerCreateOptions = IssueTrackerWriteConnection & { project: string; issueTypeId?: string };
export type IssueTrackerIssueWriteOptions = IssueTrackerIssueAddress;
export type IssueTrackerWriteTargetOptions = IssueTrackerIssueAddress & { intent?: 'delete' };
export type IssueTrackerDeleteOptions = IssueTrackerExistingIssue & { expectedAccountId: string };
export type IssueTrackerWriteOptions =
	| (IssueTrackerWriteConnection &
			IssueTrackerEditableFields & { action: 'create'; project: string; issueTypeId: string; summary: string })
	| (IssueTrackerExistingIssue & IssueTrackerEditableFields & { action: 'edit'; summary?: string })
	| (IssueTrackerExistingIssue &
			IssueTrackerEditableFields & { action: 'transition'; transitionId: string; summary?: string });

export type IssueTrackerWriteFailure = {
	ok: false;
	reason:
		| 'unsupported'
		| 'no-connection'
		| 'forbidden'
		| 'not-found'
		| 'invalid-input'
		| 'transition-unavailable'
		| 'conflict'
		| 'insufficient-scope'
		| 'rate-limit'
		| 'unknown';
	fieldErrors?: Readonly<Record<string, string>>;
	messages?: readonly string[];
	mutationDispatched?: false;
	applied?: 'maybe';
};

export type IssueTrackerStatus = { id: string; name: string; category: 'TO_DO' | 'IN_PROGRESS' | 'DONE' };

export type IssueTrackerIssueReceipt = {
	resourceId: string;
	siteUrl: string;
	id: string;
	key: string;
	url: string;
	project: { id: string; key: string };
	issueType: { id: string; name: string };
	summary: string;
	status: IssueTrackerStatus;
};

export type IssueTrackerField = {
	fieldId: string;
	name: string;
	required: boolean;
	schema?: Readonly<Record<string, unknown>>;
	allowedValues?: readonly unknown[];
	hasDefaultValue: boolean;
	operations: readonly string[];
};

export type IssueTrackerTransition = {
	id: string;
	name: string;
	to: IssueTrackerStatus;
	hasScreen: boolean;
	isAvailable: boolean;
	isConditional: boolean;
	fields: readonly IssueTrackerField[];
};

export type IssueTrackerCreateOptionsResult =
	| ({
			ok: true;
			resourceId: string;
			siteUrl: string;
			accountId: string;
			project: IssueTrackerIssueReceipt['project'];
			truncated: boolean;
	  } & (
			| { issueTypes: readonly IssueTrackerIssueReceipt['issueType'][] }
			| { issueTypeId: string; fields: readonly IssueTrackerField[] }
	  ))
	| IssueTrackerWriteFailure;

type IssueTrackerWriteSuccess = { ok: true; issue: IssueTrackerIssueReceipt; accountId: string };

export type IssueTrackerIssueWriteOptionsResult =
	| (IssueTrackerWriteSuccess & {
			fields: readonly IssueTrackerField[];
			transitions: readonly IssueTrackerTransition[];
			permissions: { edit: boolean; transition: boolean; delete: boolean };
			deleteCapability:
				| { allowed: true }
				| { allowed: false; reason: 'forbidden' | 'insufficient-scope' | 'invalid-input' };
	  })
	| IssueTrackerWriteFailure;
export type IssueTrackerWriteResult = IssueTrackerWriteSuccess | IssueTrackerWriteFailure;
export type IssueTrackerWriteTargetResult = IssueTrackerWriteSuccess | IssueTrackerWriteFailure;
