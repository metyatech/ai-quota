#!/usr/bin/env node
/**
 * Prepends the Node.js shebang to dist/cli.js after TypeScript compilation.
 * TypeScript strips the shebang from source files, so this script restores it.
 */
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cliPath = resolve(__dirname, "..", "dist", "cli.js");

  if (!existsSync(cliPath)) {
    console.error(`Error: ${cliPath} not found. Build may have failed.`);
    process.exit(1);
  }

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
    // On Windows chmod might fail or be a no-op; ignore the error
  }
} catch (err) {
  console.error("add-shebang: unexpected error:", err);
  process.exit(1);
}
