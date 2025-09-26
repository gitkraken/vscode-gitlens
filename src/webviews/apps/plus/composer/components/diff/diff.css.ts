import { css } from 'lit';

export const hljsStyles = css`
	.hljs {
		display: block;
		overflow-x: auto;
		padding: 0.5em;
		color: #333;
		background: #f8f8f8;
	}

	.hljs-comment,
	.hljs-quote {
		color: #998;
		font-style: italic;
	}

	.hljs-keyword,
	.hljs-selector-tag,
	.hljs-subst {
		color: #333;
		font-weight: 700;
	}

	.hljs-literal,
	.hljs-number,
	.hljs-tag .hljs-attr,
	.hljs-template-variable,
	.hljs-variable {
		color: teal;
	}

	.hljs-doctag,
	.hljs-string {
		color: #d14;
	}

	.hljs-section,
	.hljs-selector-id,
	.hljs-title {
		color: #900;
		font-weight: 700;
	}

	.hljs-subst {
		font-weight: 400;
	}

	.hljs-class .hljs-title,
	.hljs-type {
		color: #458;
		font-weight: 700;
	}

	.hljs-attribute,
	.hljs-name,
	.hljs-tag {
		color: navy;
		font-weight: 400;
	}

	.hljs-link,
	.hljs-regexp {
		color: #009926;
	}

	.hljs-bullet,
	.hljs-symbol {
		color: #990073;
	}

	.hljs-built_in,
	.hljs-builtin-name {
		color: #0086b3;
	}

	.hljs-meta {
		color: #999;
		font-weight: 700;
	}

	.hljs-deletion {
		background: #fdd;
	}

	.hljs-addition {
		background: #dfd;
	}

	.hljs-emphasis {
		font-style: italic;
	}

	.hljs-strong {
		font-weight: 700;
	}
`;

export const diff2htmlStyles = css`
	:host {
		--d2h-intrinsic-base-height: 3.5rem;
		--d2h-intrinsic-line-count: 50;
		--d2h-intrinsic-line-height: 1.8rem;
		--d2h-intrinsic-height: calc(
			var(--d2h-intrinsic-base-height) + (var(--d2h-intrinsic-line-height) * var(--d2h-intrinsic-line-count))
		);

		display: block;
		position: relative;
	}

	.d2h-file-wrapper {
		content-visibility: auto;
		contain-intrinsic-size: auto var(--d2h-intrinsic-base-height);
	}

	.d2h-file-wrapper[open] {
		contain-intrinsic-height: var(--d2h-intrinsic-height);
	}

	.d2h-wrapper {
		color: var(--d2h-color);
		text-align: left;
	}
	.d2h-file-header {
		background-color: var(--d2h-file-header-bg-color);
		border-bottom: 1px solid var(--d2h-file-header-border-color);
		display: flex;
		font-family: var(--vscode-font-family);
		height: 35px;
		padding: 4px 5px;
	}
	.d2h-file-header.d2h-sticky-header {
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.d2h-file-stats {
		display: flex;
		font-size: 14px;
		margin-left: auto;
	}
	.d2h-lines-added {
		border: 1px solid var(--d2h-ins-border-color);
		border-radius: 5px 0 0 5px;
		color: var(--d2h-ins-label-color);
		padding: 2px;
		text-align: right;
		vertical-align: middle;
	}
	.d2h-lines-deleted {
		border: 1px solid var(--d2h-del-border-color);
		border-radius: 0 5px 5px 0;
		color: var(--d2h-del-label-color);
		margin-left: 1px;
		padding: 2px;
		text-align: left;
		vertical-align: middle;
	}
	.d2h-file-name-wrapper {
		display: flex;
		-webkit-box-align: center;
		-ms-flex-align: center;
		align-items: center;
		font-size: 1.4rem;
		width: 100%;
	}
	.d2h-file-name {
		overflow-x: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.d2h-file-wrapper {
		border: 1px solid var(--d2h-border-color);
		border-radius: 3px;
		margin-bottom: 1em;
	}
	.d2h-file-collapse {
		-webkit-box-pack: end;
		-ms-flex-pack: end;
		cursor: pointer;
		display: none;
		font-size: 12px;
		justify-content: flex-end;
		-webkit-box-align: center;
		-ms-flex-align: center;
		align-items: center;
		border: 1px solid var(--d2h-border-color);
		border-radius: 3px;
		padding: 4px 8px;
	}
	.d2h-file-collapse.d2h-selected {
		background-color: var(--d2h-selected-color);
	}
	.d2h-file-collapse-input {
		margin: 0 4px 0 0;
	}
	.d2h-diff-table {
		border-collapse: collapse;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--editor-font-size);
		width: 100%;
	}
	.d2h-files-diff {
		display: flex;
		width: 100%;
	}
	.d2h-file-diff {
		overflow-y: hidden;
	}
	.d2h-file-diff.d2h-d-none,
	.d2h-files-diff.d2h-d-none {
		display: none;
	}
	.d2h-file-side-diff {
		display: inline-block;
		overflow-x: scroll;
		overflow-y: hidden;
		width: 50%;
	}
	.d2h-code-line {
		padding: 0 8em;
		/* width: calc(100% - 16em); */
		width: 100%;
	}
	.d2h-code-line,
	.d2h-code-side-line {
		display: inline-block;
		-webkit-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		user-select: none;
		white-space: nowrap;
	}
	.d2h-code-side-line {
		padding: 0 4.5em;
		width: calc(100% - 9em);
	}
	.d2h-code-line-ctn {
		background: none;
		display: inline-block;
		padding: 0;
		word-wrap: normal;
		-webkit-user-select: text;
		-moz-user-select: text;
		-ms-user-select: text;
		user-select: text;
		vertical-align: middle;
		white-space: pre;
		width: 100%;
	}
	.d2h-code-line del,
	.d2h-code-side-line del {
		background-color: var(--d2h-del-highlight-bg-color);
	}
	.d2h-code-line del,
	.d2h-code-line ins,
	.d2h-code-side-line del,
	.d2h-code-side-line ins {
		border-radius: 0.2em;
		display: inline-block;
		margin-top: -1px;
		-webkit-text-decoration: none;
		text-decoration: none;
	}
	.d2h-code-line ins,
	.d2h-code-side-line ins {
		background-color: var(--d2h-ins-highlight-bg-color);
		text-align: left;
	}
	.d2h-code-line-prefix {
		background: none;
		display: inline;
		padding: 0;
		word-wrap: normal;
		white-space: pre;
	}
	.line-num1 {
		float: left;
	}
	.line-num1,
	.line-num2 {
		-webkit-box-sizing: border-box;
		box-sizing: border-box;
		overflow: hidden;
		padding: 0 0.5em;
		text-overflow: ellipsis;
		width: 3.5em;
	}
	.line-num2 {
		float: right;
	}
	.d2h-code-linenumber {
		background-color: var(--d2h-bg-color);
		border-style: solid;
		border-color: transparent var(--d2h-line-border-color);
		border-width: 1px;
		-webkit-box-sizing: border-box;
		box-sizing: border-box;
		color: var(--d2h-dim-color);
		cursor: pointer;
		display: inline-block;
		position: absolute;
		text-align: right;
		width: 7.5em;
	}
	.d2h-code-linenumber:after {
		content: '\\200b';
	}
	.d2h-code-linenumber.d2h-ins {
		border-color: transparent var(--d2h-ins-border-color);
	}
	.d2h-code-linenumber.d2h-del {
		border-color: transparent var(--d2h-del-border-color);
	}
	.d2h-code-side-linenumber {
		background-color: var(--d2h-bg-color);
		border: solid var(--d2h-line-border-color);
		border-width: 0 1px;
		-webkit-box-sizing: border-box;
		box-sizing: border-box;
		color: var(--d2h-dim-color);
		cursor: pointer;
		display: inline-block;
		overflow: hidden;
		padding: 0 0.5em;
		position: absolute;
		text-align: right;
		text-overflow: ellipsis;
		width: 4em;
	}
	.d2h-code-side-linenumber:after {
		content: '\\200b';
	}
	.d2h-code-side-emptyplaceholder,
	.d2h-emptyplaceholder {
		background-color: var(--d2h-empty-placeholder-bg-color);
		border-color: var(--d2h-empty-placeholder-border-color);
	}
	.d2h-code-line-prefix,
	.d2h-code-linenumber,
	.d2h-code-side-linenumber,
	.d2h-emptyplaceholder {
		-webkit-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		user-select: none;
	}
	.d2h-code-linenumber,
	.d2h-code-side-linenumber {
		direction: rtl;
	}
	.d2h-del {
		background-color: var(--d2h-del-bg-color);
		border-color: var(--d2h-del-border-color);
	}
	.d2h-ins {
		background-color: var(--d2h-ins-bg-color);
		border-color: var(--d2h-ins-border-color);
	}
	.d2h-info {
		background-color: var(--d2h-info-bg-color);
		border-color: var(--d2h-info-border-color);
		color: var(--d2h-dim-color);
	}
	.d2h-file-diff .d2h-del.d2h-change {
		background-color: var(--d2h-change-del-color);
	}
	.d2h-file-diff .d2h-ins.d2h-change {
		background-color: var(--d2h-change-ins-color);
	}
	.d2h-file-list-wrapper {
		margin-bottom: 10px;
	}
	.d2h-file-list-wrapper a {
		-webkit-text-decoration: none;
		text-decoration: none;
	}
	.d2h-file-list-wrapper a,
	.d2h-file-list-wrapper a:visited {
		color: var(--d2h-moved-label-color);
	}
	.d2h-file-list-header {
		text-align: left;
	}
	.d2h-file-list-title {
		font-weight: 700;
	}
	.d2h-file-list-line {
		display: flex;
		text-align: left;
	}
	.d2h-file-list {
		display: block;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.d2h-file-list > li {
		border-bottom: 1px solid var(--d2h-border-color);
		margin: 0;
		padding: 5px 10px;
	}
	.d2h-file-list > li:last-child {
		border-bottom: none;
	}
	.d2h-file-switch {
		cursor: pointer;
		display: none;
		font-size: 10px;
	}
	.d2h-icon {
		margin-right: 10px;
		vertical-align: middle;
		fill: currentColor;
	}
	.d2h-deleted {
		color: var(--d2h-del-label-color);
	}
	.d2h-added {
		color: var(--d2h-ins-label-color);
	}
	.d2h-changed {
		color: var(--d2h-change-label-color);
	}
	.d2h-moved {
		color: var(--d2h-moved-label-color);
	}
	.d2h-tag {
		background-color: var(--d2h-bg-color);
		display: flex;
		font-size: 10px;
		margin-left: 6px;
		padding: 0px 3px;
		border-radius: 2px;
	}
	.d2h-deleted-tag {
		border: 1px solid var(--d2h-del-label-color);
	}
	.d2h-added-tag {
		border: 1px solid var(--d2h-ins-label-color);
	}
	.d2h-changed-tag {
		border: 1px solid var(--d2h-change-label-color);
	}
	.d2h-moved-tag {
		border: 1px solid var(--d2h-moved-label-color);
	}
	:host-context(.vscode-high-contrast) .d2h-ins .d2h-code-line {
		border: 1px dashed var(--d2h-ins-border-color);
		line-height: calc(var(--d2h-intrinsic-line-height) - 0.2rem);
	}
	:host-context(.vscode-high-contrast) .d2h-del .d2h-code-line {
		border: 1px dashed var(--d2h-del-border-color);
		line-height: calc(var(--d2h-intrinsic-line-height) - 0.2rem);
	}
`;
/*
	.d2h-dark-color-scheme {
		background-color: #0d1117;
		background-color: var(--d2h-dark-bg-color);
		color: #e6edf3;
		color: var(--d2h-dark-color);
	}
	.d2h-dark-color-scheme .d2h-file-header {
		background-color: #161b22;
		background-color: var(--d2h-dark-file-header-bg-color);
		border-bottom: #30363d;
		border-bottom: var(--d2h-dark-file-header-border-color);
	}
	.d2h-dark-color-scheme .d2h-lines-added {
		border: 1px solid rgba(46, 160, 67, 0.4);
		border: 1px solid var(--d2h-dark-ins-border-color);
		color: #3fb950;
		color: var(--d2h-dark-ins-label-color);
	}
	.d2h-dark-color-scheme .d2h-lines-deleted {
		border: 1px solid rgba(248, 81, 73, 0.4);
		border: 1px solid var(--d2h-dark-del-border-color);
		color: #f85149;
		color: var(--d2h-dark-del-label-color);
	}
	.d2h-dark-color-scheme .d2h-code-line del,
	.d2h-dark-color-scheme .d2h-code-side-line del {
		background-color: rgba(248, 81, 73, 0.4);
		background-color: var(--d2h-dark-del-highlight-bg-color);
	}
	.d2h-dark-color-scheme .d2h-code-line ins,
	.d2h-dark-color-scheme .d2h-code-side-line ins {
		background-color: rgba(46, 160, 67, 0.4);
		background-color: var(--d2h-dark-ins-highlight-bg-color);
	}
	.d2h-dark-color-scheme .d2h-diff-tbody {
		border-color: #30363d;
		border-color: var(--d2h-dark-border-color);
	}
	.d2h-dark-color-scheme .d2h-code-side-linenumber {
		background-color: #0d1117;
		background-color: var(--d2h-dark-bg-color);
		border-color: #21262d;
		border-color: var(--d2h-dark-line-border-color);
		color: #6e7681;
		color: var(--d2h-dark-dim-color);
	}
	.d2h-dark-color-scheme .d2h-files-diff .d2h-code-side-emptyplaceholder,
	.d2h-dark-color-scheme .d2h-files-diff .d2h-emptyplaceholder {
		background-color: hsla(215, 8%, 47%, 0.1);
		background-color: var(--d2h-dark-empty-placeholder-bg-color);
		border-color: #30363d;
		border-color: var(--d2h-dark-empty-placeholder-border-color);
	}
	.d2h-dark-color-scheme .d2h-code-linenumber {
		background-color: #0d1117;
		background-color: var(--d2h-dark-bg-color);
		border-color: #21262d;
		border-color: var(--d2h-dark-line-border-color);
		color: #6e7681;
		color: var(--d2h-dark-dim-color);
	}
	.d2h-dark-color-scheme .d2h-del {
		background-color: rgba(248, 81, 73, 0.1);
		background-color: var(--d2h-dark-del-bg-color);
		border-color: rgba(248, 81, 73, 0.4);
		border-color: var(--d2h-dark-del-border-color);
	}
	.d2h-dark-color-scheme .d2h-ins {
		background-color: rgba(46, 160, 67, 0.15);
		background-color: var(--d2h-dark-ins-bg-color);
		border-color: rgba(46, 160, 67, 0.4);
		border-color: var(--d2h-dark-ins-border-color);
	}
	.d2h-dark-color-scheme .d2h-info {
		background-color: rgba(56, 139, 253, 0.1);
		background-color: var(--d2h-dark-info-bg-color);
		border-color: rgba(56, 139, 253, 0.4);
		border-color: var(--d2h-dark-info-border-color);
		color: #6e7681;
		color: var(--d2h-dark-dim-color);
	}
	.d2h-dark-color-scheme .d2h-file-diff .d2h-del.d2h-change {
		background-color: rgba(210, 153, 34, 0.2);
		background-color: var(--d2h-dark-change-del-color);
	}
	.d2h-dark-color-scheme .d2h-file-diff .d2h-ins.d2h-change {
		background-color: rgba(46, 160, 67, 0.25);
		background-color: var(--d2h-dark-change-ins-color);
	}
	.d2h-dark-color-scheme .d2h-file-wrapper {
		border: 1px solid #30363d;
		border: 1px solid var(--d2h-dark-border-color);
	}
	.d2h-dark-color-scheme .d2h-file-collapse {
		border: 1px solid #0d1117;
		border: 1px solid var(--d2h-dark-bg-color);
	}
	.d2h-dark-color-scheme .d2h-file-collapse.d2h-selected {
		background-color: rgba(56, 139, 253, 0.1);
		background-color: var(--d2h-dark-selected-color);
	}
	.d2h-dark-color-scheme .d2h-file-list-wrapper a,
	.d2h-dark-color-scheme .d2h-file-list-wrapper a:visited {
		color: #3572b0;
		color: var(--d2h-dark-moved-label-color);
	}
	.d2h-dark-color-scheme .d2h-file-list > li {
		border-bottom: 1px solid #0d1117;
		border-bottom: 1px solid var(--d2h-dark-bg-color);
	}
	.d2h-dark-color-scheme .d2h-deleted {
		color: #f85149;
		color: var(--d2h-dark-del-label-color);
	}
	.d2h-dark-color-scheme .d2h-added {
		color: #3fb950;
		color: var(--d2h-dark-ins-label-color);
	}
	.d2h-dark-color-scheme .d2h-changed {
		color: #d29922;
		color: var(--d2h-dark-change-label-color);
	}
	.d2h-dark-color-scheme .d2h-moved {
		color: #3572b0;
		color: var(--d2h-dark-moved-label-color);
	}
	.d2h-dark-color-scheme .d2h-tag {
		background-color: #0d1117;
		background-color: var(--d2h-dark-bg-color);
	}
	.d2h-dark-color-scheme .d2h-deleted-tag {
		border: 1px solid #f85149;
		border: 1px solid var(--d2h-dark-del-label-color);
	}
	.d2h-dark-color-scheme .d2h-added-tag {
		border: 1px solid #3fb950;
		border: 1px solid var(--d2h-dark-ins-label-color);
	}
	.d2h-dark-color-scheme .d2h-changed-tag {
		border: 1px solid #d29922;
		border: 1px solid var(--d2h-dark-change-label-color);
	}
	.d2h-dark-color-scheme .d2h-moved-tag {
		border: 1px solid #3572b0;
		border: 1px solid var(--d2h-dark-moved-label-color);
	}
	@media (prefers-color-scheme: dark) {
		.d2h-auto-color-scheme {
			background-color: #0d1117;
			background-color: var(--d2h-dark-bg-color);
			color: #e6edf3;
			color: var(--d2h-dark-color);
		}
		.d2h-auto-color-scheme .d2h-file-header {
			background-color: #161b22;
			background-color: var(--d2h-dark-file-header-bg-color);
			border-bottom: #30363d;
			border-bottom: var(--d2h-dark-file-header-border-color);
		}
		.d2h-auto-color-scheme .d2h-lines-added {
			border: 1px solid rgba(46, 160, 67, 0.4);
			border: 1px solid var(--d2h-dark-ins-border-color);
			color: #3fb950;
			color: var(--d2h-dark-ins-label-color);
		}
		.d2h-auto-color-scheme .d2h-lines-deleted {
			border: 1px solid rgba(248, 81, 73, 0.4);
			border: 1px solid var(--d2h-dark-del-border-color);
			color: #f85149;
			color: var(--d2h-dark-del-label-color);
		}
		.d2h-auto-color-scheme .d2h-code-line del,
		.d2h-auto-color-scheme .d2h-code-side-line del {
			background-color: rgba(248, 81, 73, 0.4);
			background-color: var(--d2h-dark-del-highlight-bg-color);
		}
		.d2h-auto-color-scheme .d2h-code-line ins,
		.d2h-auto-color-scheme .d2h-code-side-line ins {
			background-color: rgba(46, 160, 67, 0.4);
			background-color: var(--d2h-dark-ins-highlight-bg-color);
		}
		.d2h-auto-color-scheme .d2h-diff-tbody {
			border-color: #30363d;
			border-color: var(--d2h-dark-border-color);
		}
		.d2h-auto-color-scheme .d2h-code-side-linenumber {
			background-color: #0d1117;
			background-color: var(--d2h-dark-bg-color);
			border-color: #21262d;
			border-color: var(--d2h-dark-line-border-color);
			color: #6e7681;
			color: var(--d2h-dark-dim-color);
		}
		.d2h-auto-color-scheme .d2h-files-diff .d2h-code-side-emptyplaceholder,
		.d2h-auto-color-scheme .d2h-files-diff .d2h-emptyplaceholder {
			background-color: hsla(215, 8%, 47%, 0.1);
			background-color: var(--d2h-dark-empty-placeholder-bg-color);
			border-color: #30363d;
			border-color: var(--d2h-dark-empty-placeholder-border-color);
		}
		.d2h-auto-color-scheme .d2h-code-linenumber {
			background-color: #0d1117;
			background-color: var(--d2h-dark-bg-color);
			border-color: #21262d;
			border-color: var(--d2h-dark-line-border-color);
			color: #6e7681;
			color: var(--d2h-dark-dim-color);
		}
		.d2h-auto-color-scheme .d2h-del {
			background-color: rgba(248, 81, 73, 0.1);
			background-color: var(--d2h-dark-del-bg-color);
			border-color: rgba(248, 81, 73, 0.4);
			border-color: var(--d2h-dark-del-border-color);
		}
		.d2h-auto-color-scheme .d2h-ins {
			background-color: rgba(46, 160, 67, 0.15);
			background-color: var(--d2h-dark-ins-bg-color);
			border-color: rgba(46, 160, 67, 0.4);
			border-color: var(--d2h-dark-ins-border-color);
		}
		.d2h-auto-color-scheme .d2h-info {
			background-color: rgba(56, 139, 253, 0.1);
			background-color: var(--d2h-dark-info-bg-color);
			border-color: rgba(56, 139, 253, 0.4);
			border-color: var(--d2h-dark-info-border-color);
			color: #6e7681;
			color: var(--d2h-dark-dim-color);
		}
		.d2h-auto-color-scheme .d2h-file-diff .d2h-del.d2h-change {
			background-color: rgba(210, 153, 34, 0.2);
			background-color: var(--d2h-dark-change-del-color);
		}
		.d2h-auto-color-scheme .d2h-file-diff .d2h-ins.d2h-change {
			background-color: rgba(46, 160, 67, 0.25);
			background-color: var(--d2h-dark-change-ins-color);
		}
		.d2h-auto-color-scheme .d2h-file-wrapper {
			border: 1px solid #30363d;
			border: 1px solid var(--d2h-dark-border-color);
		}
		.d2h-auto-color-scheme .d2h-file-collapse {
			border: 1px solid #0d1117;
			border: 1px solid var(--d2h-dark-bg-color);
		}
		.d2h-auto-color-scheme .d2h-file-collapse.d2h-selected {
			background-color: rgba(56, 139, 253, 0.1);
			background-color: var(--d2h-dark-selected-color);
		}
		.d2h-auto-color-scheme .d2h-file-list-wrapper a,
		.d2h-auto-color-scheme .d2h-file-list-wrapper a:visited {
			color: #3572b0;
			color: var(--d2h-dark-moved-label-color);
		}
		.d2h-auto-color-scheme .d2h-file-list > li {
			border-bottom: 1px solid #0d1117;
			border-bottom: 1px solid var(--d2h-dark-bg-color);
		}
		.d2h-dark-color-scheme .d2h-deleted {
			color: #f85149;
			color: var(--d2h-dark-del-label-color);
		}
		.d2h-auto-color-scheme .d2h-added {
			color: #3fb950;
			color: var(--d2h-dark-ins-label-color);
		}
		.d2h-auto-color-scheme .d2h-changed {
			color: #d29922;
			color: var(--d2h-dark-change-label-color);
		}
		.d2h-auto-color-scheme .d2h-moved {
			color: #3572b0;
			color: var(--d2h-dark-moved-label-color);
		}
		.d2h-auto-color-scheme .d2h-tag {
			background-color: #0d1117;
			background-color: var(--d2h-dark-bg-color);
		}
		.d2h-auto-color-scheme .d2h-deleted-tag {
			border: 1px solid #f85149;
			border: 1px solid var(--d2h-dark-del-label-color);
		}
		.d2h-auto-color-scheme .d2h-added-tag {
			border: 1px solid #3fb950;
			border: 1px solid var(--d2h-dark-ins-label-color);
		}
		.d2h-auto-color-scheme .d2h-changed-tag {
			border: 1px solid #d29922;
			border: 1px solid var(--d2h-dark-change-label-color);
		}
		.d2h-auto-color-scheme .d2h-moved-tag {
			border: 1px solid #3572b0;
			border: 1px solid var(--d2h-dark-moved-label-color);
		}
	} */

export const diffStyles = css`
	td {
		padding-block: 0;
		line-height: var(--d2h-intrinsic-line-height);
	}
	.d2h-file-wrapper {
		margin-block-end: 0;
	}

	tr:has(.d2h-code-linenumber) {
		position: relative;
	}

	.d2h-file-header {
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
	}

	.d2h-file-wrapper:not([open]) .d2h-file-header,
	.d2h-file-header:has(.d2h-file-collapse.d2h-selected) {
		border-bottom-color: transparent;
	}

	.d2h-code-linenumber {
		background-color: color-mix(in srgb, var(--d2h-bg-color) 100%, transparent 12%) !important;
	}

	.d2h-file-wrapper:not([open]) .file-icon--open,
	.d2h-file-wrapper[open] .file-icon--closed {
		display: none;
	}
`;
