// Builds the experimental Open/Save dialog component (dialog/) for 64-bit and
// 32-bit Windows and copies the DLLs to src-tauri/resources/dialog, where the
// installer picks them up. Does nothing on other platforms.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "dialog");
const out = join(root, "src-tauri", "resources", "dialog");
const targetDir = process.env.CARGO_TARGET_DIR || join(crate, "target");
mkdirSync(out, { recursive: true });

const targets = [["x86_64-pc-windows-msvc", "x64", true], ["i686-pc-windows-msvc", "x86", false]];
for (const [triple, arch, required] of targets) {
  try {
    execFileSync("cargo", ["build", "--release", "--target", triple], { cwd: crate, stdio: "inherit" });
    const dll = join(targetDir, triple, "release", "slate_dialog.dll");
    if (!existsSync(dll)) throw new Error(`${dll} wasn't produced`);
    copyFileSync(dll, join(out, `slate_dialog_${arch}.dll`));
    console.log(`dialog component (${arch}) ready`);
  } catch (e) {
    if (required) throw e;
    console.warn(`skipping the ${arch} dialog component: ${e.message}. Install it with: rustup target add ${triple}`);
  }
}
