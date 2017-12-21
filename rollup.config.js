import typescript from 'rollup-plugin-typescript2';
import uglify from 'rollup-plugin-uglify';
import { minify } from 'uglify-es';

export default {
    input: './src/extension.ts',
    output: {
        file: 'out/extension.js',
        format: 'cjs'
    },
    plugins: [
        typescript(),
        uglify({
            ecma: 7,
            compress: true,
            mangle: true,
            output: {
                beautify: false,
                comments: false,
                ecma: 7
            },
            sourceMap: false,
        }, minify),
    ]
}