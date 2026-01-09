import { reactWrapper } from '../helpers/react-wrapper.js';
import { GlMarkdown as GlMarkdownWC } from './markdown.js';

export interface GlMarkdown extends GlMarkdownWC {}
export const GlMarkdown = reactWrapper(GlMarkdownWC, { tagName: 'gl-markdown' });
