module.exports = {
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
