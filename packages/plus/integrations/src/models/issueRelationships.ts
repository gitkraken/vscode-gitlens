import type {
	GitHubGetIssueRelationshipsInput,
	GitHubIssueRelationshipFailure,
	GitHubIssueRelationshipPin,
	GitHubIssueRelationshipReceipt,
	GitHubIssueRelationshipsResult,
	GitHubWriteIssueRelationshipInput,
	GitHubWriteIssueRelationshipResult,
} from '@gitkraken/provider-apis/providers';
import type { IntegrationIds } from '../constants.js';

export type CaptureRelationshipCurrency = (isCurrent: () => boolean) => void;

export type IssueRelationshipConnection = {
	providerId: IntegrationIds;
	connectionId: string;
	expectedLogin?: string;
	expectedConnectionProof?: string;
};

export type IssueRelationshipPin = GitHubIssueRelationshipPin;
export type IssueRelationshipReceipt = GitHubIssueRelationshipReceipt;
export type IssueRelationshipFailure = GitHubIssueRelationshipFailure;
export type IssueRelationshipsOptions = IssueRelationshipConnection & GitHubGetIssueRelationshipsInput;
export type IssueRelationshipsResult =
	| (Extract<GitHubIssueRelationshipsResult, { ok: true }> & { connectionProof: string })
	| IssueRelationshipFailure;

type Add = Extract<GitHubWriteIssueRelationshipInput, { action: 'add' }>;
export type IssueRelationshipWriteOptions = IssueRelationshipConnection &
	(
		| Exclude<GitHubWriteIssueRelationshipInput, Add>
		| (Add &
				(
					| { replaceParent?: undefined }
					| { replaceParent: IssueRelationshipPin; expectedConnectionProof: string }
				))
	);
export type IssueRelationshipWriteResult = GitHubWriteIssueRelationshipResult;
