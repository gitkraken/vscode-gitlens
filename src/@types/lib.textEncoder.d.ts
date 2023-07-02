// Define TextEncoder + TextDecoder globals for both browser and node runtimes
// See: https://github.com/microsoft/TypeScript/issues/31535

declare let TextDecoder: typeof import('util').TextDecoder;
declare let TextEncoder: typeof import('util').TextEncoder;
