import { css } from 'lit';

export const hljsStyles = css`
	.hljs {
		display: block;
		padding: 0.5em;
		overflow-x: auto;
		color: #333;
		background: #f8f8f8;
	}

	.hljs-comment,
	.hljs-quote {
		font-style: italic;
		color: #998;
	}

	.hljs-keyword,
	.hljs-selector-tag,
	.hljs-subst {
		font-weight: 700;
		color: #333;
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
		font-weight: 700;
		color: #900;
	}

	.hljs-subst {
		font-weight: 400;
	}

	.hljs-class .hljs-title,
	.hljs-type {
		font-weight: 700;
		color: #458;
	}

	.hljs-attribute,
	.hljs-name,
	.hljs-tag {
		font-weight: 400;
		color: navy;
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
		font-weight: 700;
		color: #999;
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
		--d2h-intrinsic-base-height: 3.5rem; /* header height */
		--d2h-intrinsic-container-offset-height: 12px; /* 10px scrollbar height + 2px vertical borders */
		--d2h-intrinsic-line-count: 50;
		--d2h-intrinsic-line-height: calc(
			var(--editor-font-size) * 1.5
		); /* 1.2rem (font) to 1.8rem (line height) ratio, but still fixed */
		--d2h-intrinsic-height: calc(
			var(--d2h-intrinsic-base-height) + (var(--d2h-intrinsic-line-height) * var(--d2h-intrinsic-line-count)) +
				var(--d2h-intrinsic-container-offset-height)
		);

		position: relative;
		display: block;
	}

	.diff-container {
		contain-intrinsic-size: auto var(--d2h-intrinsic-base-height);
		content-visibility: auto;
	}

	.diff-container:has(.d2h-file-wrapper[open]) {
		contain-intrinsic-height: var(--d2h-intrinsic-height);
	}

	.d2h-wrapper {
		color: var(--d2h-color);
		text-align: left;
	}

	.d2h-file-header {
		display: flex;
		height: 35px;
		padding: 4px 5px;
		font-family: var(--vscode-font-family);
		background-color: var(--d2h-file-header-bg-color);
		border-bottom: 1px solid var(--d2h-file-header-border-color);
	}

	.d2h-file-header.d2h-sticky-header {
		position: sticky;
		top: var(--file-header-sticky-top, 0);
		z-index: 1;
	}

	.d2h-file-stats {
		display: flex;
		margin-left: auto;
		font-size: 14px;
	}

	.d2h-lines-added {
		padding: 2px;
		vertical-align: middle;
		color: var(--d2h-ins-label-color);
		text-align: right;
		border: 1px solid var(--d2h-ins-border-color);
		border-radius: 5px 0 0 5px;
	}

	.d2h-lines-deleted {
		padding: 2px;
		margin-left: 1px;
		vertical-align: middle;
		color: var(--d2h-del-label-color);
		text-align: left;
		border: 1px solid var(--d2h-del-border-color);
		border-radius: 0 5px 5px 0;
	}

	.d2h-file-name-wrapper {
		display: flex;
		align-items: center;
		width: 100%;
		font-size: 1.4rem;
		align-items: center;
		-ms-flex-align: center;
	}

	.d2h-file-name {
		overflow-x: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.d2h-file-wrapper {
		margin-bottom: 1em;
		border: 1px solid var(--d2h-border-color);
		border-radius: 3px;
	}

	.d2h-file-collapse {
		display: none;
		align-items: center;
		justify-content: flex-end;
		padding: 4px 8px;
		font-size: 12px;
		cursor: pointer;
		border: 1px solid var(--d2h-border-color);
		border-radius: 3px;
		-webkit-box-pack: end;
		-ms-flex-pack: end;
		align-items: center;
		-ms-flex-align: center;
	}

	.d2h-file-collapse.d2h-selected {
		background-color: var(--d2h-selected-color);
	}

	.d2h-file-collapse-input {
		margin: 0 4px 0 0;
	}

	.d2h-diff-table {
		width: 100%;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--editor-font-size);
		border-collapse: collapse;
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
		width: 50%;
		overflow: scroll hidden;
	}

	.d2h-code-line {
		/* width: calc(100% - 16em); */
		width: 100%;
		padding: 0 8em;
	}

	.d2h-code-line,
	.d2h-code-side-line {
		display: inline-block;
		white-space: nowrap;
		-webkit-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		user-select: none;
	}

	.d2h-code-side-line {
		width: calc(100% - 9em);
		padding: 0 4.5em;
	}

	.d2h-code-line-ctn {
		display: inline-block;
		width: 100%;
		padding: 0;
		vertical-align: middle;
		overflow-wrap: normal;
		white-space: pre;
		-webkit-user-select: text;
		-moz-user-select: text;
		-ms-user-select: text;
		user-select: text;
		background: none;
	}

	.d2h-code-line del,
	.d2h-code-side-line del {
		background-color: var(--d2h-del-highlight-bg-color);
	}

	.d2h-code-line del,
	.d2h-code-line ins,
	.d2h-code-side-line del,
	.d2h-code-side-line ins {
		display: inline-block;
		margin-top: -1px;
		-webkit-text-decoration: none;
		text-decoration: none;
		border-radius: 0.2em;
	}

	.d2h-code-line ins,
	.d2h-code-side-line ins {
		text-align: left;
		background-color: var(--d2h-ins-highlight-bg-color);
	}

	.d2h-code-line-prefix {
		display: inline;
		padding: 0;
		overflow-wrap: normal;
		white-space: pre;
		background: none;
	}

	.line-num1 {
		float: left;
	}

	.line-num1,
	.line-num2 {
		-webkit-box-sizing: border-box;
		box-sizing: border-box;
		width: 3.5em;
		padding: 0 0.5em;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.line-num2 {
		float: right;
	}

	.d2h-code-linenumber {
		position: absolute;
		-webkit-box-sizing: border-box;
		box-sizing: border-box;
		display: inline-block;
		width: 7.5em;
		color: var(--d2h-dim-color);
		text-align: right;
		cursor: pointer;
		background-color: var(--d2h-bg-color);
		border-color: transparent var(--d2h-line-border-color);
		border-style: solid;
		border-width: 1px;
	}

	.d2h-code-linenumber::after {
		content: '\\200b';
	}

	.d2h-code-linenumber.d2h-ins {
		border-color: transparent var(--d2h-ins-border-color);
	}

	.d2h-code-linenumber.d2h-del {
		border-color: transparent var(--d2h-del-border-color);
	}

	.d2h-code-side-linenumber {
		position: absolute;
		-webkit-box-sizing: border-box;
		box-sizing: border-box;
		display: inline-block;
		width: 4em;
		padding: 0 0.5em;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--d2h-dim-color);
		text-align: right;
		cursor: pointer;
		background-color: var(--d2h-bg-color);
		border: solid var(--d2h-line-border-color);
		border-width: 0 1px;
	}

	.d2h-code-side-linenumber::after {
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
		color: var(--d2h-dim-color);
		background-color: var(--d2h-info-bg-color);
		border-color: var(--d2h-info-border-color);
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
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.d2h-file-list > li {
		padding: 5px 10px;
		margin: 0;
		border-bottom: 1px solid var(--d2h-border-color);
	}

	.d2h-file-list > li:last-child {
		border-bottom: none;
	}

	.d2h-file-switch {
		display: none;
		font-size: 10px;
		cursor: pointer;
	}

	.d2h-icon {
		margin-right: 10px;
		vertical-align: middle;
		fill: currentcolor;
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
		display: flex;
		padding: 0 3px;
		margin-left: 6px;
		font-size: 10px;
		background-color: var(--d2h-bg-color);
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
		line-height: calc(var(--d2h-intrinsic-line-height) - 0.2rem);
		border: 1px dashed var(--d2h-ins-border-color);
	}

	:host-context(.vscode-high-contrast) .d2h-del .d2h-code-line {
		line-height: calc(var(--d2h-intrinsic-line-height) - 0.2rem);
		border: 1px dashed var(--d2h-del-border-color);
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

	.d2h-code-line,
	.d2h-code-side-line {
		height: var(--d2h-intrinsic-line-height);
		overflow: hidden;
		vertical-align: top;
	}

	.d2h-file-diff {
		overflow: scroll hidden;
	}

	.d2h-file-wrapper {
		margin-block-end: 0;
	}

	tr:has(.d2h-code-linenumber) {
		position: relative;
	}

	.d2h-file-header {
		gap: 0.4rem;
		align-items: center;
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
