import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { walkUp } from "walk-up-path";
import rpj from "read-package-json-fast";
import mapWorkspaces from "@npmcli/map-workspaces";

const fileExists = (...paths: string[]) =>
  stat(resolve(...paths))
    .then((s) => s.isFile())
    .catch(() => false);

const dirExists = (...paths: string[]) =>
  stat(resolve(...paths))
    .then((s) => s.isDirectory())
    .catch(() => false);

export async function findRootPackage(path = process.cwd()) {
  let workspace: string | null = null;

  for (const p of walkUp(path)) {
    const hasPackageJson = await fileExists(p, "package.json");

    if (
      !workspace &&
      (hasPackageJson || (await dirExists(p, "node_modules")))
    ) {
      workspace = p;

      continue;
    }

    if (workspace && hasPackageJson) {
      const pkgPath = resolve(p, "package.json");
      const pkg = await rpj(pkgPath);

      if (!pkg) {
        continue;
      }

      const workspaces = await mapWorkspaces({ cwd: p, pkg });

      for (const w of workspaces.values()) {
        if (w === workspace) {
          return pkgPath;
        }
      }
    }
  }

  return workspace ? resolve(workspace, "package.json") : null;
}
