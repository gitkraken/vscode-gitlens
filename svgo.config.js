module.exports = {
	js2svg: {
		eol: 'lf',
		finalNewline: true,
	},
	plugins: [
		{
			name: 'removeAttrs',
			params: {
				attrs: 'fill',
			},
		},
		{
			name: 'addAttributesToSVGElement',
			params: {
				attributes: [
					{
						fill: 'currentColor',
					},
				],
			},
		},
	],
};
