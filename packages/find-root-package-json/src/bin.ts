#!/usr/bin/env node

import { parseArgs } from "node:util";
import { findRootPackage } from "./index.js";

const { values } = parseArgs({
  options: {
    path: {
      type: "string",
      short: "p",
      default: process.cwd(),
    },
  },
});

const { path } = values;

findRootPackage(path).then((rootPath) => {
  if (rootPath === null) {
    console.error("package.json not found");
    process.exit(1);
  }

  console.log(rootPath);
});
