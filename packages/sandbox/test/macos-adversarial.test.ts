import { open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MacOSSandboxExecProvider } from "../src/index";
import {
  createEscapeSymlink,
  createSandboxFixture,
  readPid,
  removeSandboxFixture,
  runNode,
  sandboxRequest,
  waitForProcessExit,
  type SandboxFixture,
} from "./helpers";

const fixtures: SandboxFixture[] = [];

async function fixture(): Promise<SandboxFixture> {
  const created = await createSandboxFixture();
  fixtures.push(created);
  return created;
}

function providerFor(
  sandboxFixture: SandboxFixture,
): MacOSSandboxExecProvider {
  return new MacOSSandboxExecProvider({
    allowedExecutables: [process.execPath],
    allowedEnvironmentKeys: ["LANG"],
    authorizedSourceRoots: [sandboxFixture.sourceRoot],
    authorizedWorktreeRoots: [sandboxFixture.worktreeRoot],
    authorizedTempRoots: [sandboxFixture.tempRoot],
    feasibilityMode: true,
  });
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(removeSandboxFixture));
});

describe.skipIf(process.platform !== "darwin")(
  "macOS sandbox-exec adversarial boundary [skipped: requires macOS sandbox-exec]",
  () => {
    it("reads source but permits writes only in the isolated worktree and temp roots", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const worktreeOutput = join(testFixture.worktreeRoot, "worktree.txt");
    const tempOutput = join(testFixture.tempRoot, "temp.txt");
    const result = await runNode(
      provider,
      testFixture,
      `
        const fs = require("node:fs");
        const [source, sourceWrite, worktreeWrite, tempWrite] = process.argv.slice(1);
        const sourceText = fs.readFileSync(source, "utf8");
        let sourceWriteCode = "unexpected-success";
        try {
          fs.writeFileSync(sourceWrite, "mutated");
        } catch (error) {
          sourceWriteCode = error.code;
        }
        fs.writeFileSync(worktreeWrite, "worktree-ok");
        fs.writeFileSync(tempWrite, "temp-ok");
        process.stdout.write(JSON.stringify({ sourceText, sourceWriteCode }));
      `,
      [
        testFixture.sourceFile,
        join(testFixture.sourceRoot, "forbidden.txt"),
        worktreeOutput,
        tempOutput,
      ],
    );

    expect(result.status).toBe("completed");
    expect(result.enforced).toBe(true);
    expect(result.providerEvidence).toEqual({
      provider: "macos-sandbox-exec",
      platform: "darwin",
      enforcement: "enforced",
      policyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(result.cleanupEvidence).toEqual({
      verified: false,
      scope: "process-group-only",
      remainingDescendants: "unknown",
    });
    expect(result.stdout).toMatchObject({
      capturedBytes: result.stdout.observedBytes,
      sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      truncated: false,
    });
    expect(JSON.parse(result.stdout.text)).toMatchObject({
      sourceText: "source-evidence",
      sourceWriteCode: expect.stringMatching(/EPERM|EACCES/),
    });
    await expect(readFile(worktreeOutput, "utf8")).resolves.toBe("worktree-ok");
    await expect(readFile(tempOutput, "utf8")).resolves.toBe("temp-ok");
  });

  it("cannot read home, SSH, outside-project, system, or executable-ancestor data", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const priorSecret = process.env.MEMI_SANDBOX_SECRET;
    process.env.MEMI_SANDBOX_SECRET = "host-environment-secret";

    try {
      const result = await runNode(
        provider,
        testFixture,
        `
          const fs = require("node:fs");
          const outcomes = process.argv.slice(1).map((path) => {
            try {
              const value = fs.statSync(path).isDirectory()
                ? fs.readdirSync(path).join(",")
                : fs.readFileSync(path, "utf8");
              return { path, value };
            } catch (error) {
              return { path, error: error.code };
            }
          });
          process.stdout.write(JSON.stringify({
            outcomes,
            inheritedSecret: process.env.MEMI_SANDBOX_SECRET ?? null,
            home: process.env.HOME ?? null
          }));
        `,
        [
          testFixture.outsideFile,
          testFixture.sshSecretFile,
          join(testFixture.homeRoot, ".ssh"),
          "/private/etc/passwd",
          dirname(process.execPath),
        ],
        { maxStdoutBytes: 65_536 },
      );

      expect(result.status).toBe("completed");
      const observed = JSON.parse(result.stdout.text) as {
        outcomes: Array<{ error?: string; value?: string }>;
        inheritedSecret: string | null;
        home: string | null;
      };
      expect(observed.outcomes).toHaveLength(5);
      expect(
        observed.outcomes.every((item) =>
          /EPERM|EACCES/.test(item.error ?? ""),
        ),
      ).toBe(true);
      expect(observed.outcomes.every((item) => item.value === undefined)).toBe(
        true,
      );
      expect(observed.inheritedSecret).toBeNull();
      expect(observed.home).toBeNull();
    } finally {
      if (priorSecret === undefined) {
        delete process.env.MEMI_SANDBOX_SECRET;
      } else {
        process.env.MEMI_SANDBOX_SECRET = priorSecret;
      }
    }
  });

  it("denies outside writes and symlink escapes from a writable root", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const escapeLink = await createEscapeSymlink(testFixture);
    const directOutsideWrite = join(testFixture.outsideRoot, "direct.txt");
    const linkedOutsideWrite = join(escapeLink, "linked.txt");
    const result = await runNode(
      provider,
      testFixture,
      `
        const fs = require("node:fs");
        const outcomes = process.argv.slice(1).map((path) => {
          try {
            fs.writeFileSync(path, "escape");
            return "unexpected-success";
          } catch (error) {
            return error.code;
          }
        });
        process.stdout.write(JSON.stringify(outcomes));
      `,
      [directOutsideWrite, linkedOutsideWrite],
    );

    expect(result.status).toBe("completed");
    expect(JSON.parse(result.stdout.text)).toEqual([
      expect.stringMatching(/EPERM|EACCES/),
      expect.stringMatching(/EPERM|EACCES/),
    ]);
    await expect(readFile(testFixture.outsideFile, "utf8")).resolves.toBe(
      "outside-secret",
    );
  });

  it("denies loopback and external network connections", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("Expected a TCP address");
    }

    try {
      const result = await runNode(
        provider,
        testFixture,
        `
          const net = require("node:net");
          function probe(host, port) {
            return new Promise((resolve) => {
              const socket = net.connect({ host, port });
              const timer = setTimeout(() => {
                socket.destroy();
                resolve("timeout");
              }, 300);
              socket.once("connect", () => {
                clearTimeout(timer);
                socket.destroy();
                resolve("connected");
              });
              socket.once("error", (error) => {
                clearTimeout(timer);
                resolve(error.code);
              });
            });
          }
          Promise.all([
            probe("127.0.0.1", Number(process.argv[1])),
            probe("1.1.1.1", 80)
          ]).then((outcomes) => {
            process.stdout.write(JSON.stringify(outcomes));
          });
        `,
        [String(address.port)],
      );

      expect(result.status).toBe("completed");
      expect(JSON.parse(result.stdout.text)).toEqual([
        expect.stringMatching(/EPERM|EACCES/),
        expect.stringMatching(/EPERM|EACCES/),
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("terminates the process group when the timeout expires", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const childPidFile = join(testFixture.tempRoot, "child.pid");
    const result = await runNode(
      provider,
      testFixture,
      `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.execPath, [
          "-e",
          "setInterval(() => {}, 1000)"
        ], { stdio: "ignore" });
        fs.writeFileSync(process.argv[1], String(child.pid));
        setInterval(() => {}, 1000);
      `,
      [childPidFile],
      { timeoutMs: 1_000 },
    );

    expect(result).toMatchObject({
      status: "timed-out",
      enforced: true,
      reason: "timeout",
    });
    const childPid = await readPid(childPidFile);
    await expect(waitForProcessExit(childPid)).resolves.toBe(true);
  });

  it("records the NO-GO detached-descendant process-group escape", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const childPidFile = join(testFixture.tempRoot, "detached-child.pid");
    const result = await runNode(
      provider,
      testFixture,
      `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.execPath, [
          "-e",
          "setInterval(() => {}, 1000)"
        ], { detached: true, stdio: "ignore" });
        child.unref();
        fs.writeFileSync(process.argv[1], String(child.pid));
        setInterval(() => {}, 1000);
      `,
      [childPidFile],
      { timeoutMs: 1_000 },
    );
    const childPid = await readPid(childPidFile);

    let testError: unknown = null;
    try {
      expect(result.status).toBe("timed-out");
      await expect(waitForProcessExit(childPid, 250)).resolves.toBe(
        false,
      );
      expect(result.cleanupEvidence).toEqual({
        verified: false,
        scope: "process-group-only",
        remainingDescendants: "unknown",
      });
    } catch (error) {
      testError = error;
    }

    let cleanupError: unknown = null;
    try {
      process.kill(childPid, "SIGKILL");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ESRCH"
      ) {
        cleanupError = error;
      }
    }
    if (cleanupError !== null) {
      throw cleanupError;
    }
    if (testError !== null) {
      throw testError;
    }
  });

  it("does not report completion while a descendant survives", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const childPidFile = join(testFixture.tempRoot, "completed-child.pid");
    const result = await runNode(
      provider,
      testFixture,
      `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.execPath, [
          "-e",
          "setInterval(() => {}, 1000)"
        ], { stdio: "ignore" });
        fs.writeFileSync(process.argv[1], String(child.pid));
      `,
      [childPidFile],
    );

    expect(result).toMatchObject({
      status: "timed-out",
      reason: "timeout",
    });
    const childPid = await readPid(childPidFile);
    await expect(waitForProcessExit(childPid)).resolves.toBe(true);
  });

  it("terminates the process group when the caller aborts", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const controller = new AbortController();
    const run = provider.run(
      sandboxRequest(testFixture, {
        args: ["-e", "setInterval(() => {}, 1000)"],
        signal: controller.signal,
        timeoutMs: 5_000,
      }),
    );
    setTimeout(() => controller.abort(), 100);

    await expect(run).resolves.toMatchObject({
      status: "failed",
      enforced: true,
      reason: "aborted",
    });
  });

  it("terminates output floods and never returns an unbounded buffer", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const result = await runNode(
      provider,
      testFixture,
      `
        const chunk = "x".repeat(64 * 1024);
        while (true) {
          process.stdout.write(chunk);
          process.stderr.write(chunk);
        }
      `,
      [],
      {
        maxStdoutBytes: 1_024,
        maxStderrBytes: 1_024,
      },
    );

    expect(result).toMatchObject({
      status: "output-limit-exceeded",
      enforced: true,
      reason: expect.stringMatching(/stdout|stderr/),
    });
    expect(Buffer.byteLength(result.stdout.text)).toBeLessThanOrEqual(1_024);
    expect(Buffer.byteLength(result.stderr.text)).toBeLessThanOrEqual(1_024);
    expect(result.stdout.truncated || result.stderr.truncated).toBe(true);
  });

  it("allows supervised same-executable children but denies recursive shell execution", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const result = await runNode(
      provider,
      testFixture,
      `
        const { spawnSync } = require("node:child_process");
        const sameExecutable = spawnSync(process.execPath, [
          "-e",
          "process.stdout.write('child-ok')"
        ], { encoding: "utf8" });
        const shell = spawnSync("/bin/sh", ["-c", "exit 0"], {
          encoding: "utf8"
        });
        process.stdout.write(JSON.stringify({
          childStatus: sameExecutable.status,
          childOutput: sameExecutable.stdout,
          shellStatus: shell.status,
          shellError: shell.error?.code ?? null
        }));
      `,
    );

    expect(result.status).toBe("completed");
    expect(JSON.parse(result.stdout.text)).toEqual({
      childStatus: 0,
      childOutput: "child-ok",
      shellStatus: null,
      shellError: expect.stringMatching(/EPERM|EACCES/),
    });
  });

  it("does not inherit an already-open host file descriptor", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const hostHandle = await open(testFixture.outsideFile, "r");

    try {
      const result = await runNode(
        provider,
        testFixture,
        `
          const fs = require("node:fs");
          try {
            const value = fs.readFileSync(Number(process.argv[1]), "utf8");
            process.stdout.write(JSON.stringify({ value }));
          } catch (error) {
            process.stdout.write(JSON.stringify({ error: error.code }));
          }
        `,
        [String(hostHandle.fd)],
      );

      expect(result.status).toBe("completed");
      const observed = JSON.parse(result.stdout.text) as {
        value?: string;
        error?: string;
      };
      expect(observed.value).toBeUndefined();
      expect(observed.error).toMatch(/EBADF|EINVAL|EPERM|EACCES/);
    } finally {
      await hostHandle.close();
    }
  });
    },
);
