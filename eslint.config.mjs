import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

/**
 * ESLint flat config.
 *
 * WHY THIS REPLACED .eslintrc.json + `next lint`
 * ----------------------------------------------
 * A dependabot dev-group bump (09c625b) took eslint 8 -> 10 and
 * eslint-config-next 15 -> 16 in one go. The later revert (dbe1cff) rolled the
 * PRODUCTION group back to Next 15 but left the dev group where it was, so the
 * repo ended up on a combination that cannot run:
 *
 *   - ESLint 10 removed eslintrc support outright, but `next lint` from Next 15
 *     still drives that API - so lint died on "Unknown options: useEslintrc,
 *     extensions, ..." before checking a single file. CI has been red since.
 *   - ESLint 10 also removed `context.getFilename()`, which eslint-plugin-react
 *     7.37.5 (the newest published, pulled in by eslint-config-next) still
 *     calls. Its peer range stops at ^9.7, so no version of it works on 10.
 *
 * Hence eslint ^9: it is the newest line eslint-config-next actually supports,
 * and flat config is native there. `next lint` is not resurrected because it is
 * deprecated and removed in Next 16; the ESLint CLI is the forward path.
 *
 * WHY eslint-config-next 15, NOT 16
 * ---------------------------------
 * eslint-config-next tracks the Next major, and this app is on Next 15.5.18.
 * The 16 line ships eslint-plugin-react-hooks v7, whose React-Compiler rules
 * (set-state-in-effect, purity, preserve-manual-memoization, immutability)
 * flagged 79 pre-existing patterns across the app - rules written for a compiler
 * this build does not run. Pairing the config with the framework restores the
 * rule set the code was actually written against. Adopting those rules is a
 * deliberate refactor to do alongside a Next 16 upgrade, not a side effect of
 * repairing lint.
 *
 * eslint-config-next 15 is eslintrc-format, so FlatCompat bridges it - this is
 * the flat-config recipe from Next 15's own ESLint docs.
 *
 * SCOPE
 * -----
 * `next lint` implicitly linted only app/, components/, lib/, src/ and pages/.
 * `eslint .` would also walk sdk/, create-lightnode-app/ and desktop/, which are
 * separate packages with their own toolchains and CI steps. The ignore list
 * keeps the linted surface exactly what it was, so this migration changes the
 * runner and not the verdict.
 */
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      // Excluded by the old config too: the e2e specs run under Playwright's
      // globals, not the app's.
      "tests/e2e/**",
      "playwright-report/**",
      "test-results/**",
      // Separate packages, each verified by its own CI step (`tsc -p
      // sdk/tsconfig.json`, the scaffolder's own typecheck). sdk/dist is build
      // output.
      "sdk/**",
      "create-lightnode-app/**",
      "desktop/**",
      "wallet/**",
      "examples/**",
      "scripts/**",
      "public/**",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default config;
