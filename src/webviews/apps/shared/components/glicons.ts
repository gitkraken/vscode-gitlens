/*

Must be placed at the end of body in the HTML file of any webview that needs it (because of CSP)

<style nonce="#{cspNonce}">
	@font-face {
		font-family: 'glicons';
		font-display: block;
		src: url("#{root}/dist/glicons.woff2?887e981267645659b15471f86c55a40e") format("woff2");
	}
</style>
*/

export const gliconsFontFamily = 'glicons';

export const gliconsMap = Object.freeze({
	'gl-commit-horizontal': '\\f101',
	'gl-graph': '\\f102',
	'gl-next-commit': '\\f103',
	'gl-prev-commit-menu': '\\f104',
	'gl-prev-commit': '\\f105',
	'gl-compare-ref-working': '\\f106',
	'gl-branches-view': '\\f107',
	'gl-commit-view': '\\f108',
	'gl-commits-view': '\\f109',
	'gl-compare-view': '\\f10a',
	'gl-contributors-view': '\\f10b',
	'gl-history-view': '\\f10c',
	'gl-history': '\\f10c',
	'gl-remotes-view': '\\f10d',
	'gl-repositories-view': '\\f10e',
	'gl-search-view': '\\f10f',
	'gl-stashes-view': '\\f110',
	'gl-stashes': '\\f110',
	'gl-tags-view': '\\f111',
	'gl-worktrees-view': '\\f112',
	'gl-gitlens': '\\f113',
	'gl-stash-pop': '\\f114',
	'gl-stash-save': '\\f115',
	'gl-unplug': '\\f116',
	'gl-open-revision': '\\f117',
	'gl-switch': '\\f118',
	'gl-expand': '\\f119',
	'gl-list-auto': '\\f11a',
	'gl-repo-force-push': '\\f11b',
	'gl-pinned-filled': '\\f11c',
	'gl-clock': '\\f11d',
	'gl-provider-azdo': '\\f11e',
	'gl-provider-bitbucket': '\\f11f',
	'gl-provider-gerrit': '\\f120',
	'gl-provider-gitea': '\\f121',
	'gl-provider-github': '\\f122',
	'gl-provider-gitlab': '\\f123',
	'gl-gitlens-inspect': '\\f124',
	'gl-workspaces-view': '\\f125',
	'gl-confirm-checked': '\\f126',
	'gl-confirm-unchecked': '\\f127',
	'gl-cloud-patch': '\\f128',
	'gl-cloud-patch-share': '\\f129',
	'gl-inspect': '\\f12a',
	'gl-repository-filled': '\\f12b',
	'gl-gitlens-filled': '\\f12c',
	'gl-code-suggestion': '\\f12d',
	'gl-provider-jira': '\\f12e',
});
