/* eslint-disable no-restricted-imports */
import path from 'path';
import { fileURLToPath } from 'url';

const _fileName = fileURLToPath(import.meta.url); // get the resolved path to the file
export const dirName = path.join(path.dirname(_fileName), '../../..'); // get the name of the directory
