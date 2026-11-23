import assert from 'node:assert';
import { graphRemEdits, toGraphRem } from '../cssUnits.mjs';

const rem = (value: string): string => `calc(${value}*var(--gl-graph-rem,10px))`;

suite('published stylesheet rem rewrite', () => {
	test('measures declaration lengths against --gl-graph-rem', () => {
		assert.strictEqual(
			toGraphRem('a{width:1.2rem;margin:0 .5rem -.6rem -0.6rem;height:2REM}'),
			`a{width:${rem('1.2')};margin:0 ${rem('.5')} ${rem('-.6')} ${rem('-0.6')};height:${rem('2')}}`,
		);
	});

	test('rewrites inside functions and custom property values', () => {
		assert.strictEqual(
			toGraphRem('a{--x:1rem;padding:var(--p, 0 .8rem);width:calc(100% - 9rem);top:min(40%,2rem)}'),
			`a{--x:${rem('1')};padding:var(--p, 0 ${rem('.8')});width:calc(100% - ${rem('9')});top:min(40%,${rem('2')})}`,
		);
	});

	test('leaves strings, urls, comments, names and other units alone', () => {
		const css =
			'a{content:"1rem";background:url(img-2rem.png);filter:url("#x1rem");/* 3rem */' +
			'--gl-4rem:var(--gap-5rem);width:1em;height:1remx;margin:10%}';
		assert.strictEqual(toGraphRem(css), css);
	});

	test('rewrites lengths beside a string that mentions rem', () => {
		assert.strictEqual(
			toGraphRem(`a{font-family:"Font 2rem",sans-serif;--x:'1rem' 2rem;margin:1rem}`),
			`a{font-family:"Font 2rem",sans-serif;--x:'1rem' ${rem('2')};margin:${rem('1')}}`,
		);
	});

	test('leaves selectors and at-rule preludes alone', () => {
		const css = '@media (max-width:40rem){.a-1rem:hover{width:1rem}}';
		assert.strictEqual(toGraphRem(css), `@media (max-width:40rem){.a-1rem:hover{width:${rem('1')}}}`);
	});

	test('reads multi-line source with nested rules and comments in values', () => {
		const css = `
			.pill {
				gap: 0.1rem; /* 1rem in a comment */
				margin: /**/ 0.3rem /* 2rem */;
				&:hover { padding: 0.2rem 0.4rem; }
			}
		`;
		assert.deepStrictEqual(
			graphRemEdits(css).map(e => css.slice(e.start, e.end)),
			['0.1rem', '0.3rem', '0.2rem', '0.4rem'],
		);
	});
});
