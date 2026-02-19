#!/usr/bin/env node
/**
 * Prepends the Node.js shebang to dist/cli.js after TypeScript compilation.
 * TypeScript strips the shebang from source files, so this script restores it.
 */
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "..", "dist", "cli.js");

const shebang = "#!/usr/bin/env node\n";
const existing = readFileSync(cliPath, "utf8");

if (!existing.startsWith("#!")) {
  writeFileSync(cliPath, shebang + existing, "utf8");
  console.log("add-shebang: prepended shebang to dist/cli.js");
} else {
  console.log("add-shebang: shebang already present in dist/cli.js");
}

// Ensure the file is executable on Unix-like systems
try {
  chmodSync(cliPath, 0o755);
} catch {
  // On Windows chmod is a no-op; ignore the error
}
