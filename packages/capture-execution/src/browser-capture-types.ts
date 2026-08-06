import type {
  ProcessExecutionPolicy,
  ProcessRecipe,
  ProcessGroupRunner,
  RunningProcessGroup,
} from "./process-policy.js";

export interface RuntimePageEvidence {
  readonly visibleTextLength: number;
  readonly elementCount: number;
  readonly errorBoundary: boolean;
  readonly splashScreen: boolean;
  readonly hierarchy: unknown;
  readonly geometry: unknown;
}

export interface BrowserPageLike {
  goto(
    url: string,
    options: Readonly<{
      waitUntil: "domcontentloaded";
      timeout: number;
    }>,
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options: Readonly<{ state: "visible"; timeout: number }>,
  ): Promise<unknown>;
  addStyleTag(options: Readonly<{ content: string }>): Promise<unknown>;
  screenshot(): Promise<Uint8Array>;
  url(): string;
  collectEvidence(): Promise<RuntimePageEvidence>;
  close(): Promise<void>;
}

export interface BrowserPageOptions {
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly deviceScaleFactor: number;
  readonly allowedOrigin: string;
}

export interface BrowserLike {
  newPage(options: BrowserPageOptions): Promise<BrowserPageLike>;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  launch(): Promise<BrowserLike>;
}

export interface PortLease {
  acquire(signal: AbortSignal): Promise<number>;
  release(port: number): Promise<void>;
}

export interface ProcessStarter {
  start(
    recipe: ProcessRecipe,
    policy: ProcessExecutionPolicy,
    signal: AbortSignal,
  ): RunningProcessGroup;
}

export type ProcessRunnerLike = Pick<ProcessGroupRunner, "start"> | ProcessStarter;
