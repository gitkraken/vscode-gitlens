import markdownit from 'markdown-it';
import React, { useEffect, useState } from 'react';

const mdRules = [
	'text',
	'linkify',
	'newline',
	'escape',
	'backticks',
	'strikethrough',
	'emphasis',
	'link',
	'image',
	'autolink',
	'html_inline',
	'entity',
];

const md = markdownit();
md.disable(mdRules);
md.enable(['backticks']);

export const Markdown = ({ children }: { children: string }) => {
	const [span, setSpan] = useState<HTMLSpanElement | null>(null);
	useEffect(() => {
		if (!span) {
			return;
		}
		span.setHTMLUnsafe(md.renderInline(children));
	}, [children, span]);
	return <span ref={setSpan}></span>;
};
