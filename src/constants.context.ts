import type { Uri } from 'vscode';
import type { AnnotationStatus, Keys } from './constants';
import type { PromoKeys, SubscriptionPlanId, SubscriptionState } from './constants.subscription';
import type { CustomEditorTypes, GroupableTreeViewTypes, WebviewTypes, WebviewViewTypes } from './constants.views';
import type { WalkthroughContextKeys } from './telemetry/walkthroughStateProvider';

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
	/** Indicates that this is the first run of a new install of GitLens */
	'gitlens:install:new': boolean;
	/** Indicates that this is the first run after an upgrade of GitLens */
	'gitlens:install:upgradedFrom': string;
	'gitlens:plus': Exclude<SubscriptionPlanId, SubscriptionPlanId.Community>;
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
	'gitlens:views:scm:grouped:view': GroupableTreeViewTypes;
	'gitlens:views:scm:grouped:welcome': boolean;
	'gitlens:vsls': boolean | 'host' | 'guest';
	'gitlens:window:annotated': AnnotationStatus;
} & Record<`gitlens:action:${string}`, number> &
	Record<`gitlens:key:${Keys}`, boolean> &
	Record<`gitlens:views:scm:grouped:views:${GroupableTreeViewTypes}`, boolean> &
	Record<`gitlens:webview:${WebviewTypes | CustomEditorTypes}:visible`, boolean> &
	Record<`gitlens:webviewView:${WebviewViewTypes}:visible`, boolean> &
	Record<`gitlens:walkthroughState:${WalkthroughContextKeys}`, boolean>;
