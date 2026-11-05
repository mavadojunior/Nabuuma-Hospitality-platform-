import {
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist");

async function files(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const output = [];

  for (const entry of entries) {
    const absolute = path.join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      output.push(...await files(absolute));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".js")
    ) {
      output.push(absolute);
    }
  }

  return output;
}

await stat(root);

const modules = await files(root);

if (modules.length === 0) {
  throw new Error(
    "No emitted JavaScript modules found in dist.",
  );
}

const relativeImportPattern =
  /(?:from\s*["']|import\s*\(\s*["'])(\.{1,2}\/[^"']+)["']/g;

const validExtensionPattern =
  /\.(?:js|mjs|cjs|json)$/;

let relativeImports = 0;
const invalid = [];

for (const modulePath of modules) {
  const source = await readFile(
    modulePath,
    "utf8",
  );

  for (
    const match of source.matchAll(
      relativeImportPattern,
    )
  ) {
    const specifier = match[1];

    if (!specifier) {
      continue;
    }

    relativeImports += 1;

    const pathname =
      specifier.split(/[?#]/, 1)[0] ?? specifier;

    if (!validExtensionPattern.test(pathname)) {
      invalid.push({
        modulePath:
          path.relative(process.cwd(), modulePath),
        specifier,
      });
    }
  }
}

if (invalid.length > 0) {
  for (const item of invalid) {
    console.error(
      `[FAIL] ${item.modulePath}: ${item.specifier}`,
    );
  }

  throw new Error(
    "Emitted relative imports without explicit Node ESM extensions detected.",
  );
}

console.log(`${modules.length} modules`);
console.log(`${relativeImports} relative imports`);
