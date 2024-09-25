import type { Uri } from 'vscode';
import type { AnnotationStatus, Keys } from './constants';
import type { PromoKeys, SubscriptionPlanId, SubscriptionState } from './constants.subscription';
import type { CustomEditorTypes, WebviewTypes, WebviewViewTypes } from './constants.views';

export type ContextKeys = {
	'gitlens:debugging': boolean;
	'gitlens:disabled': boolean;
	'gitlens:disabledToggleCodeLens': boolean;
	'gitlens:enabled': boolean;
	'gitlens:gk:hasOrganizations': boolean;
	'gitlens:gk:organization:ai:enabled': boolean;
	'gitlens:gk:organization:drafts:byob': boolean;
	'gitlens:gk:organization:drafts:enabled': boolean;
	'gitlens:hasVirtualFolders': boolean;
	'gitlens:launchpad:connect': boolean;
	'gitlens:plus': SubscriptionPlanId;
	'gitlens:plus:disallowedRepos': string[];
	'gitlens:plus:enabled': boolean;
	'gitlens:plus:required': boolean;
	'gitlens:plus:state': SubscriptionState;
	'gitlens:prerelease': boolean;
	'gitlens:promo': PromoKeys;
	'gitlens:readonly': boolean;
	'gitlens:repos:withRemotes': string[];
	'gitlens:repos:withHostingIntegrations': string[];
	'gitlens:repos:withHostingIntegrationsConnected': string[];
	'gitlens:schemes:trackable': string[];
	'gitlens:tabs:annotated': Uri[];
	'gitlens:tabs:annotated:computing': Uri[];
	'gitlens:tabs:blameable': Uri[];
	'gitlens:tabs:tracked': Uri[];
	'gitlens:untrusted': boolean;
	'gitlens:views:canCompare': boolean;
	'gitlens:views:canCompare:file': boolean;
	'gitlens:views:commits:filtered': boolean;
	'gitlens:views:commits:hideMergeCommits': boolean;
	'gitlens:views:contributors:hideMergeCommits': boolean;
	'gitlens:views:fileHistory:canPin': boolean;
	'gitlens:views:fileHistory:cursorFollowing': boolean;
	'gitlens:views:fileHistory:editorFollowing': boolean;
	'gitlens:views:lineHistory:editorFollowing': boolean;
	'gitlens:views:patchDetails:mode': 'create' | 'view';
	'gitlens:views:pullRequest:visible': boolean;
	'gitlens:views:repositories:autoRefresh': boolean;
	'gitlens:vsls': boolean | 'host' | 'guest';
	'gitlens:window:annotated': AnnotationStatus;
} & Record<`gitlens:action:${string}`, number> &
	Record<`gitlens:key:${Keys}`, boolean> &
	Record<`gitlens:webview:${WebviewTypes | CustomEditorTypes}:visible`, boolean> &
	Record<`gitlens:webviewView:${WebviewViewTypes}:visible`, boolean>;
