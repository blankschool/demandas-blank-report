import { chmod, readFile, writeFile } from "node:fs/promises";
import { generatePassword, generatePasswordHash } from "./core.mjs";

const envPath = new URL("../.env.local", import.meta.url);
const password = process.argv[2] || generatePassword();
const hash = await generatePasswordHash(password);
const current = await readFile(envPath, "utf8");
const encodedHash = hash.replaceAll("$", "\\$");
const next = current.match(/^APP_PASSWORD_HASH=/m)
  ? current.replace(/^APP_PASSWORD_HASH=.*$/m, `APP_PASSWORD_HASH=${encodedHash}`)
  : `${current.trimEnd()}\nAPP_PASSWORD_HASH=${encodedHash}\n`;

await writeFile(envPath, next, { mode: 0o600 });
await chmod(envPath, 0o600);
process.stdout.write(JSON.stringify({ username: "blank", password }));
