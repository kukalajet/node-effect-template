import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";

import packageJson from "../../package.json" with { type: "json" };

// main.ts is where the commands, their services, the failure reporter,
// StderrLoggingLive and runMain's settings meet. Out of order, a command
// prints its failure on standard output, reads configuration for --help, or
// exits 1 without a line, while each module's tests still pass, so these run
// main.ts as the process it is. None needs PostgreSQL.
const mainPath = fileURLToPath(new URL("../main.ts", import.meta.url));

// Port 1 refuses connections at once; the password must never reach the log.
const unreachableDatabaseUrl =
  "postgresql://app:SECRET_SENTINEL@127.0.0.1:1/app";

// A URL that does not parse, whose password must not reach the log either.
const malformedDatabaseUrl = "postgresql://app:SECRET_SENTINEL@[bad/app";

// Runs main.ts with `args` and only `env`, so neither the shell's LOG_LEVEL
// nor .env changes the result.
const runCli = (args: ReadonlyArray<string>, env: Record<string, string>) => {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [mainPath, ...args],
    { env, encoding: "utf8" },
  );

  return { status, stdout, stderr };
};

// The JSON lines a failing command logged on standard error.
const loggedLines = (stderr: string) =>
  stderr
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("apps/cli/src/main.ts", () => {
  it("prints its help without configuration, and exits 0", () => {
    const { status, stdout, stderr } = runCli(["--help"], {});

    assert.strictEqual(status, 0);
    assert.strictEqual(stderr, "");
    assert.include(stdout, "USAGE");
    assert.include(stdout, "users");
    assert.notInclude(stdout, "--log-level");
  });

  it("prints its version without configuration", () => {
    const { status, stdout, stderr } = runCli(["--version"], {});

    assert.strictEqual(status, 0);
    assert.strictEqual(stderr, "");
    assert.strictEqual(stdout, `node-effect v${packageJson.version}\n`);
  });

  it("refuses invalid input without configuration, and exits 1", () => {
    const { status, stdout, stderr } = runCli(["users", "get", "1"], {});

    assert.strictEqual(status, 1);
    assert.include(stdout, "USAGE");
    assert.include(stderr, "Invalid value for argument <id>");
    assert.notInclude(stderr, "CLI failed");
  });

  it("prints a group's help without a database, and exits 0", () => {
    // Port 1 refuses connections, so a service that connected while it was
    // built would fail this.
    const { status, stdout, stderr } = runCli(["users"], {
      DATABASE_URL: unreachableDatabaseUrl,
    });

    assert.strictEqual(status, 0);
    assert.strictEqual(stderr, "");
    assert.include(stdout, "node-effect users <subcommand>");
  });

  it("needs configuration for a group's help, as it builds the services", () => {
    const { status, stdout, stderr } = runCli(["users"], {});
    const lines = loggedLines(stderr);

    assert.strictEqual(status, 1);
    assert.strictEqual(stdout, "");

    assert.deepStrictEqual(
      lines.map((line) => line.message),
      ["CLI failed"],
    );

    assert.include(lines[0]?.cause, "DATABASE_URL");
  });

  it("reports missing configuration once, as JSON on standard error", () => {
    const { status, stdout, stderr } = runCli(["users", "list"], {});
    const lines = loggedLines(stderr);

    assert.strictEqual(status, 1);
    assert.strictEqual(stdout, "");

    assert.deepStrictEqual(
      lines.map((line) => [line.message, line.level, line.annotations]),
      [["CLI failed", "ERROR", { service: "cli" }]],
    );

    assert.include(lines[0]?.cause, "DATABASE_URL");
  });

  it("reports a database it cannot reach by safe diagnostics", () => {
    const { status, stdout, stderr } = runCli(["users", "list"], {
      DATABASE_URL: unreachableDatabaseUrl,
    });

    const lines = loggedLines(stderr);

    assert.strictEqual(status, 1);
    assert.strictEqual(stdout, "");

    assert.deepStrictEqual(
      lines.map((line) => [line.message, line.level]),
      [["CLI failed", "ERROR"]],
    );

    assert.include(
      lines[0]?.cause,
      '"diagnostics":{"reason":"ConnectionError","code":"ECONNREFUSED"}',
    );

    assert.notInclude(stderr, "SECRET_SENTINEL");
  });

  it("reports a DATABASE_URL it cannot parse by safe diagnostics", () => {
    // PgClient.make parses the URL while the services are built, before any
    // repository could turn its SqlError into a persistence failure.
    const { status, stdout, stderr } = runCli(["users", "list"], {
      DATABASE_URL: malformedDatabaseUrl,
    });

    const lines = loggedLines(stderr);

    assert.strictEqual(status, 1);
    assert.strictEqual(stdout, "");

    assert.deepStrictEqual(
      lines.map((line) => [line.message, line.level]),
      [["CLI failed", "ERROR"]],
    );

    assert.include(
      lines[0]?.cause,
      '"diagnostics":{"reason":"ConnectionError","code":"ERR_INVALID_URL"}',
    );

    assert.notInclude(stderr, "SECRET_SENTINEL");
    assert.notInclude(stderr, "    at ");
  });

  it("stops a command in flight on SIGTERM, logs nothing, and exits 130", async () => {
    // Accepts connections and never answers, like a PostgreSQL that stopped
    // responding, so the command is still waiting when SIGTERM arrives.
    const server = createServer(() => {}).listen(0, "127.0.0.1");

    try {
      await once(server, "listening");
      const address = server.address();

      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP address");
      }

      const connected = once(server, "connection");

      const child = spawn(process.execPath, [mainPath, "users", "list"], {
        env: { DATABASE_URL: `postgresql://app@127.0.0.1:${address.port}/app` },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });

      const exited = once(child, "exit");

      await connected;
      child.kill("SIGTERM");
      const [code] = await exited;

      assert.strictEqual(code, 130);
      assert.strictEqual(stdout, "");
      assert.strictEqual(stderr, "");
    } finally {
      server.close();
    }
  });
});
