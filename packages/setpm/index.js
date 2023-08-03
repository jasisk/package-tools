#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import pacote from "pacote";
import npmPickManifest from "npm-pick-manifest";
import { findRootPackage } from "find-root-package-json";
import pkgJson from "@npmcli/package-json";
import { readFile, stat } from "node:fs/promises";
import { validRange, valid, maxSatisfying } from "semver";
import npa from "npm-package-arg";
import { load, FAILSAFE_SCHEMA } from "js-yaml";
import { parseArgs } from "node:util";
const { packument } = pacote;

const packageManagers = ["npm", "yarn", "yarnv1", "pnpm"];
const LEGACY_REGEXP = /^(#.*(\r?\n))*?#\s+yarn\s+lockfile\s+v1\r?\n/i;

const fileExists = (...paths) =>
  stat(resolve(...paths))
    .then((s) => s.isFile())
    .catch(() => false);

async function guessPackageManager(path) {
  if (await fileExists(path, "pnpm-lock.yaml")) return "pnpm";
  if (await fileExists(path, "yarn.lock")) {
    const lockfile = await readFile(resolve(path, "yarn.lock"), "utf8");

    if (LEGACY_REGEXP.test(lockfile)) return "yarnv1";

    try {
      const { __metadata } = load(lockfile, {
        schema: FAILSAFE_SCHEMA,
        json: true,
      });
      if (!__metadata) throw new Error("Unexpected yarn.lock file");
    } catch (e) {
      if (process.stdout.isTTY) {
        console.warn(`Unexpected yarn.lock file, proceeding with yarn`);
      }
    }

    return "yarn";
  }
  return "npm";
}

const { positionals, values } = parseArgs({
  strict: true,
  allowPositionals: true,
  options: {
    cd: {
      type: "string",
      short: "C",
      default: process.cwd(),
    },
  },
});

let managerName;
let managerVersion = "latest";

const [specifier] = positionals;

const pkgJsonFile = await findRootPackage(values.cd);
const pkgJsonDir = dirname(pkgJsonFile);
const pkg = await pkgJson.load(pkgJsonDir, { create: true });

if (typeof specifier === "string" && specifier.trim().length) {
  const normalizedSpecifier = specifier.trim().toLowerCase();

  if (packageManagers.includes(normalizedSpecifier)) {
    managerName = normalizedSpecifier;
  } else if (validRange(normalizedSpecifier) || valid(normalizedSpecifier)) {
    managerVersion = normalizedSpecifier;
  } else {
    const { name, fetchSpec, type } = npa(specifier);

    switch (type) {
      case "version":
      case "tag":
      case "range":
        managerName = name;
        managerVersion = fetchSpec;
        break;
      default:
        console.error("Not sure how to handle specified package manager");
        process.exit(1);
    }
  }
}

let { packageManager } = pkg;

if (!managerName) {
  if (packageManager) {
    managerName = npa(packageManager).name;
  }
  managerName = await guessPackageManager(pkgJsonDir);
}

if (managerName === "yarn") {
  // special handling for yarn berry.
  // https://github.com/nodejs/corepack/blob/b8a4a529319eed50983f9f2c527490d07806b1bc/.github/workflows/sync.yml#L23
  const response = await fetch("https://repo.yarnpkg.com/tags");

  if (!response.ok) {
    console.error("Could not fetch yarn berry tags");
    process.exit(1);
  }

  const {
    latest: { stable: latest },
    tags,
  } = await response.json();

  managerName = "yarn";

  if (managerVersion === null || managerVersion === "latest") {
    managerVersion = latest;
  } else {
    const maxVersion = maxSatisfying(tags, managerVersion);
    if (maxVersion === null) {
      console.error(
        `Could not find a version of ${managerName} matching ${managerVersion}`
      );
      process.exit(1);
    } else {
      managerVersion = maxVersion;
    }
  }
} else {
  if (managerName === "yarnv1") {
    managerName = "yarn";
  }

  try {
    const _packument = await packument(`${managerName}@${managerVersion}`);
    ({ version: managerVersion } = npmPickManifest(_packument, managerVersion));
  } catch (e) {
    console.error(
      `Could not find a version of ${managerName} matching ${managerVersion}`
    );
    process.exit(1);
  }
}

pkg.update({ packageManager: `${managerName}@${managerVersion}` });
await pkg.save();

if (process.stdout.isTTY) {
  console.log(`Set packageManager to ${managerName}@${managerVersion}`);
}
