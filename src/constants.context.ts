import type { Uri } from 'vscode';
import type { AnnotationStatus, Keys } from './constants';
import type { SubscriptionState } from './constants.subscription';
import type { CustomEditorTypes, GroupableTreeViewTypes, WebviewTypes, WebviewViewTypes } from './constants.views';
import type { Features } from './features';
import type { OrgAIProviders } from './plus/gk/models/organization';
import type { PromoKeys } from './plus/gk/models/promo';
import type { SubscriptionPlanIds } from './plus/gk/models/subscription';
import type { WalkthroughContextKeys } from './telemetry/walkthroughStateProvider';

export type ContextKeys = {
	'gitlens:debugging': boolean;
	'gitlens:disabled': boolean;
	'gitlens:disabledToggleCodeLens': boolean;
	'gitlens:enabled': boolean;
	'gitlens:gk:hasOrganizations': boolean;
	'gitlens:gk:organization:ai:enabled': boolean;
	'gitlens:gk:organization:ai:enforceProviders': boolean;
	'gitlens:gk:organization:ai:providers': OrgAIProviders;
	'gitlens:gk:organization:drafts:byob': boolean;
	'gitlens:gk:organization:drafts:enabled': boolean;
	'gitlens:hasVirtualFolders': boolean;
	'gitlens:launchpad:connected': boolean;
	/** Indicates that this is the first run of a new install of GitLens */
	'gitlens:install:new': boolean;
	/** Indicates that this is the first run after an upgrade of GitLens */
	'gitlens:install:upgradedFrom': string;
	'gitlens:plus': Exclude<SubscriptionPlanIds, 'community'>;
	'gitlens:plus:disabled': boolean;
	'gitlens:plus:disallowedRepos': string[];
	'gitlens:plus:required': boolean;
	'gitlens:plus:state': SubscriptionState;
	'gitlens:prerelease': boolean;
	'gitlens:promo': PromoKeys;
	'gitlens:readonly': boolean;
	'gitlens:repos:withRemotes': string[];
	'gitlens:repos:withHostingIntegrations': string[];
	'gitlens:repos:withHostingIntegrationsConnected': string[];
	'gitlens:schemes:trackable': string[];
	'gitlens:tabs:ai:helpful': Uri[];
	'gitlens:tabs:ai:unhelpful': Uri[];
	'gitlens:tabs:ai:changelog': Uri[];
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
	'gitlens:views:fileHistory:mode': 'commits' | 'contributors';
	'gitlens:views:lineHistory:editorFollowing': boolean;
	'gitlens:views:patchDetails:mode': 'create' | 'view';
	'gitlens:views:pullRequest:visible': boolean;
	'gitlens:views:repositories:autoRefresh': boolean;
	'gitlens:views:scm:grouped:loading': boolean;
	'gitlens:views:scm:grouped:view': GroupableTreeViewTypes;
	'gitlens:views:scm:grouped:welcome': boolean;
	'gitlens:vsls': boolean | 'host' | 'guest';
	'gitlens:window:annotated': AnnotationStatus;
	'gitlens:walkthroughSupported': boolean;
} & Record<`gitlens:action:${string}`, number> &
	Record<`gitlens:feature:unsupported:${Features}`, boolean> &
	Record<`gitlens:key:${Keys}`, boolean> &
	Record<`gitlens:views:scm:grouped:views:${GroupableTreeViewTypes}`, boolean> &
	Record<`gitlens:webview:${WebviewTypes | CustomEditorTypes}:visible`, boolean> &
	Record<`gitlens:webviewView:${WebviewViewTypes}:visible`, boolean> &
	Record<`gitlens:walkthroughState:${WalkthroughContextKeys}`, boolean>;
