//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

import path from 'path';
import CopyPlugin from 'copy-webpack-plugin';
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @param {{ useOptimization?: boolean; useSharpForImageOptimization?: boolean } | undefined } env
 * @param {{ mode: 'production' | 'development' | 'none' | undefined }} argv
 * @returns { WebpackConfig }
 */
export default function (env, argv) {
	const mode = argv.mode || 'none';
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');

	env = {
		useOptimization: true,
		useSharpForImageOptimization: true,
		...env,
	};

	/** @type ImageMinimizerPlugin.Generator<any> */
	// @ts-ignore
	let imageGeneratorConfig = env.useSharpForImageOptimization
		? {
				type: 'asset',
				implementation: ImageMinimizerPlugin.sharpGenerate,
				options: {
					encodeOptions: {
						webp: {
							lossless: true,
						},
					},
				},
		  }
		: {
				type: 'asset',
				implementation: ImageMinimizerPlugin.imageminGenerate,
				options: {
					plugins: [
						[
							'imagemin-webp',
							{
								lossless: true,
								nearLossless: 0,
								quality: 100,
								method: mode === 'production' ? 4 : 0,
							},
						],
					],
				},
		  };

	/** @type WebpackConfig['plugins'] */
	const plugins = [
		new CopyPlugin({
			patterns: [
				{
					from: path.posix.join(basePath.replace(/\\/g, '/'), 'media', '*.png'),
					to: path.posix.join(__dirname.replace(/\\/g, '/'), 'dist', 'webviews'),
				},
			],
		}),
	];

	if (!env.useOptimization) {
		plugins.push(
			new ImageMinimizerPlugin({
				deleteOriginalAssets: true,
				generator: [imageGeneratorConfig],
			}),
		);
	}

	/** @type WebpackConfig */
	const config = {
		name: 'images',
		context: basePath,
		entry: {},
		mode: mode,
		plugins: plugins,
	};

	if (env.useOptimization) {
		config.optimization = {
			minimize: true,
			minimizer: [
				new ImageMinimizerPlugin({
					deleteOriginalAssets: true,
					generator: [imageGeneratorConfig],
				}),
			],
		};
	}

	return config;
}
