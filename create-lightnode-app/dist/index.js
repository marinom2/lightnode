#!/usr/bin/env node
/**
 * create-lightnode-app
 *
 * Scaffold a new project with end-to-end encrypted LightChain AI inference.
 * Three templates:
 *   - node       (minimal Node CLI, simplest to understand)
 *   - nextjs-api (Next.js dApp with a /api/inference route)
 *   - hono       (standalone Hono microservice)
 *
 * Usage:
 *   npm create lightnode-app my-app
 *   npm create lightnode-app my-app -- --template nextjs-api --network testnet
 *
 * No runtime dependencies beyond Node 18+.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { filesFor } from "./templates.js";
const TEMPLATES = ["node", "nextjs-api", "hono"];
const NETWORKS = ["testnet", "mainnet"];
function flag(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
function isValidProjectName(name) {
    return /^[a-z0-9][-_a-z0-9]{0,213}$/.test(name);
}
async function ask(prompt, def) {
    const rl = readline.createInterface({ input, output });
    try {
        const a = (await rl.question(`${prompt} (${def}): `)).trim();
        return a || def;
    }
    finally {
        rl.close();
    }
}
async function main() {
    console.log("\n▶ create-lightnode-app");
    console.log("  encrypted LightChain AI inference in a few seconds.\n");
    // 1. Project name (positional or interactive).
    const positional = process.argv.slice(2).find((a) => !a.startsWith("--"));
    let projectName = positional ?? (await ask("Project name", "lightchain-inference"));
    if (!isValidProjectName(projectName)) {
        console.error(`✗ "${projectName}" is not a valid npm-style folder name (lowercase letters/digits/-/_)`);
        process.exit(1);
    }
    // 2. Template.
    let template = flag("template") ?? null;
    if (!template) {
        const choice = await ask(`Template (${TEMPLATES.join(" | ")})`, "node");
        if (!TEMPLATES.includes(choice)) {
            console.error(`✗ unknown template "${choice}". Use one of: ${TEMPLATES.join(", ")}`);
            process.exit(1);
        }
        template = choice;
    }
    // 3. Network.
    let network = flag("network") ?? null;
    if (!network) {
        const choice = await ask(`Default network (${NETWORKS.join(" | ")})`, "testnet");
        if (!NETWORKS.includes(choice)) {
            console.error(`✗ unknown network "${choice}". Use testnet or mainnet`);
            process.exit(1);
        }
        network = choice;
    }
    const cfg = { projectName, template, network };
    const dest = path.resolve(process.cwd(), projectName);
    // 4. Refuse to overwrite a non-empty directory.
    if (fs.existsSync(dest)) {
        const items = fs.readdirSync(dest);
        if (items.length > 0) {
            console.error(`✗ "${dest}" already exists and is not empty. Pick a different name or delete it.`);
            process.exit(1);
        }
    }
    else {
        fs.mkdirSync(dest, { recursive: true });
    }
    // 5. Write files.
    const files = filesFor(cfg);
    for (const f of files) {
        const abs = path.join(dest, f.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.contents);
        console.log(`  ✓ ${f.path}`);
    }
    console.log(`\n✅ scaffolded ${projectName} (${template}, ${network}) at ${dest}`);
    console.log("\nNext steps:");
    console.log(`  cd ${projectName}`);
    console.log(`  cp .env.example .env   # put a funded ${network} private key in PRIVATE_KEY`);
    console.log(`  npm install`);
    if (template === "nextjs-api") {
        console.log(`  npm run dev            # open http://localhost:3000\n`);
    }
    else if (template === "hono") {
        console.log(`  npm start              # server on http://localhost:3000/inference\n`);
    }
    else {
        console.log(`  npm start "your prompt"\n`);
    }
    console.log(`Free testnet LCAI at https://lightfaucet.ai.`);
    console.log(`Live in-browser playground at https://lightnode.app/playground.`);
}
main().catch((err) => {
    console.error("✗ failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
});
