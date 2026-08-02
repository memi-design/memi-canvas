declare module "bun:sqlite" {
  export interface Statement<Row = unknown> {
    all(...parameters: readonly unknown[]): Row[];
    get(...parameters: readonly unknown[]): Row | null;
    run(...parameters: readonly unknown[]): {
      readonly changes: number;
      readonly lastInsertRowid: number | bigint;
    };
  }

  export class Database {
    constructor(
      filename: string,
      options?: {
        readonly create?: boolean;
        readonly readwrite?: boolean;
        readonly strict?: boolean;
      },
    );
    close(throwOnError?: boolean): void;
    exec(sql: string): void;
    query<Row = unknown>(sql: string): Statement<Row>;
  }
}

declare module "bun:test" {
  export interface Assertion {
    not: Assertion;
    rejects: Assertion;
    resolves: Assertion;
    toBe(expected: unknown): void;
    toBeInstanceOf(expected: abstract new (...args: never[]) => unknown): void;
    toContain(expected: unknown): void;
    toEqual(expected: unknown): void;
    toMatchObject(expected: unknown): void;
    toThrow(expected?: RegExp | string): void;
  }
  export function afterEach(callback: () => void | Promise<void>): void;
  export function describe(
    label: string,
    callback: () => void,
  ): void;
  export function expect(value: unknown): Assertion;
  export function it(
    label: string,
    callback: () => void | Promise<void>,
  ): void;
}
