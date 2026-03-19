// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __brand: unique symbol;
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __base: unique symbol;

type _Brand<Base, B> = { [__brand]: B; [__base]: Base };
export type Branded<Base, B> = Base & _Brand<Base, B>;
export type Brand<B extends Branded<any, any>> = B extends Branded<any, any> ? B : never;
export type Unbrand<T> = T extends _Brand<infer Base, any> ? Base : never;
