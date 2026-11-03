/**
 * Static checks on infra/terraform (no terraform binary, no AWS calls).
 * They guard the contract the docs and the app rely on: the API route table,
 * the state backend settings, committed lock files and the .gitignore rules.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tfRoot = join(repoRoot, "infra", "terraform");

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

interface Route {
  method: string;
  path: string;
  auth: string;
}

/** Body of `variable "<name>" { ... }` up to the next top-level block, or null. */
function variableBlock(hcl: string, name: string): string | null {
  const start = hcl.indexOf(`variable "${name}" {`);
  if (start < 0) return null;
  const next = hcl.indexOf("\nvariable \"", start + 1);
  return hcl.slice(start, next < 0 ? undefined : next);
}

function defaultOf(hcl: string, name: string): string | null {
  const block = variableBlock(hcl, name);
  const match = block?.match(/^\s*default\s*=\s*(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

describe("modules/api/routes.json", () => {
  const routes = JSON.parse(read(tfRoot, "modules", "api", "routes.json")) as Route[];
  const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();

  test("declares exactly the 7 API routes", () => {
    expect(pairs).toEqual(
      [
        "GET /documents/{documentId}",
        "GET /documents/{documentId}/draft",
        "GET /health",
        "GET /search",
        "POST /documents",
        "POST /documents/upload",
        "POST /documents/{documentId}/decision",
      ].sort(),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("only GET /health is unauthenticated; every other route uses Cognito", () => {
    const open = routes.filter((r) => r.auth === "NONE").map((r) => `${r.method} ${r.path}`);
    expect(open).toEqual(["GET /health"]);
    const others = routes.filter((r) => !(r.method === "GET" && r.path === "/health"));
    expect(others.length).toBe(6);
    for (const r of others) expect(r.auth).toBe("COGNITO");
  });

  test("uses no auth value besides COGNITO and NONE", () => {
    for (const r of routes) expect(["COGNITO", "NONE"]).toContain(r.auth);
  });
});

describe("envs/dev root", () => {
  const versions = read(tfRoot, "envs", "dev", "versions.tf");
  const variables = read(tfRoot, "envs", "dev", "variables.tf");

  test("S3 backend uses native locking and pins terraform and the aws provider", () => {
    expect(versions).toContain('backend "s3"');
    expect(versions).toMatch(/use_lockfile\s*=\s*true/);
    expect(versions).toContain("required_version");
    expect(versions).toContain("~> 6.");
  });

  test("backend config has no hardcoded bucket (it comes from backend.hcl)", () => {
    expect(versions).not.toMatch(/^\s*bucket\s*=/m);
    expect(existsSync(join(tfRoot, "envs", "dev", "backend.hcl.example"))).toBe(true);
  });

  test("OpenSearch is off and the region is us-east-2 by default", () => {
    expect(defaultOf(variables, "enable_opensearch")).toBe("false");
    expect(defaultOf(variables, "aws_region")).toBe('"us-east-2"');
  });

  test("a variable that does not exist has no block", () => {
    expect(variableBlock(variables, "does_not_exist")).toBeNull();
  });
});

describe("modules/search", () => {
  test("declares no password (IAM-only access, no master user)", () => {
    const dir = join(tfRoot, "modules", "search");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tf"))) {
      const hcl = read(dir, file);
      expect(hcl).not.toMatch(/variable\s+"[^"]*password[^"]*"/i);
      expect(hcl).not.toContain("master_user_password");
      expect(hcl).not.toContain("advanced_security_options");
    }
  });
});

describe("committed files", () => {
  test("both terraform.tfvars.example files exist", () => {
    expect(existsSync(join(tfRoot, "bootstrap", "terraform.tfvars.example"))).toBe(true);
    expect(existsSync(join(tfRoot, "envs", "dev", "terraform.tfvars.example"))).toBe(true);
  });

  test("both .terraform.lock.hcl files exist and lock the aws provider", () => {
    for (const root of [["bootstrap"], ["envs", "dev"]]) {
      const lock = join(tfRoot, ...root, ".terraform.lock.hcl");
      expect(existsSync(lock)).toBe(true);
      expect(read(lock)).toContain('provider "registry.terraform.io/hashicorp/aws"');
    }
  });

  test("the CloudFormation template is gone (Terraform replaces it)", () => {
    expect(existsSync(join(repoRoot, "iac", "template.yaml"))).toBe(false);
  });

  test("no README/src/tests/scripts/docs/infra file points to the removed template", () => {
    // Built at runtime so this file does not match itself.
    const needle = ["iac", "template.yaml"].join("/");
    const textExt = /\.(ts|js|mjs|json|md|tf|hcl|tftpl|example|html|css|txt)$/;
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if ([".terraform", "node_modules", "build"].includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (textExt.test(entry.name) && read(full).includes(needle)) offenders.push(full);
      }
    };
    for (const dir of ["src", "tests", "scripts", "docs", "infra"]) scan(join(repoRoot, dir));
    if (read(repoRoot, "README.md").includes(needle)) offenders.push("README.md");
    expect(offenders).toEqual([]);
    // The scan really reads the docs (guards against an always-empty walk).
    expect(read(repoRoot, "docs", "despliegue-aws.md")).toContain("terraform");
  });

  test(".gitignore keeps state, tfvars and build output out of git", () => {
    const lines = read(repoRoot, ".gitignore").split(/\r?\n/).map((l) => l.trim());
    for (const pattern of [
      ".terraform/",
      "*.tfstate",
      "*.tfvars",
      "!*.tfvars.example",
      "crash.log",
      "dist/",
      "build/",
    ]) {
      expect(lines).toContain(pattern);
    }
    expect(lines).not.toContain(".terraform.lock.hcl");
  });
});
