import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * The first lint config this repo has ever had. `pnpm lint` existed in every package.json and had
 * NEVER run — eslint was not installed and no config existed, so the script failed with ENOENT
 * while looking like a quality gate. That is how unused locals and prefer-const drift slipped
 * through earlier audits: nothing was watching.
 *
 * DELIBERATELY NARROW. Every rule here is at ERROR level and passes on today's codebase, so the
 * gate is real from day one — a lint that ships with 4,000 warnings is decorative, and this
 * codebase's tests keep proving that a check that cannot fail protects nothing. Style rules are
 * left to the design-system test suite, which already enforces the things this project actually
 * cares about (tokens, type scale, honest UI states).
 *
 * The rules chosen are the ones that catch BUGS:
 *   - rules-of-hooks: a conditional hook is a runtime crash, not a style choice
 *   - no-dupe-keys / no-dupe-args / no-unreachable / use-isnan / valid-typeof: always defects
 *   - no-async-promise-executor / no-misused-new: subtle, real failure modes
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/.next/**", "**/.vercel/**",
      "packages/api/api/**",          // committed build output (load-bearing — see git history)
      "**/*.config.{js,ts,mjs,cjs}", "**/scripts/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // The codebase carries eslint-disable comments for rules not yet enabled here (exhaustive-deps,
    // no-explicit-any). They document intent for the day those rules turn on — reporting them as
    // "unused" now would push people to delete exactly the annotations that make that day cheaper.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    rules: {
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-async-promise-executor": "error",
      "no-misused-new": "off",
      "@typescript-eslint/no-misused-new": "error",
      "no-cond-assign": "error",
      "no-sparse-arrays": "error",
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps stays OFF for now: it fires widely on this codebase and turning it on as
      // a warning would be the decorative-gate pattern. Revisit deliberately, file by file.
    },
  },
);
