import tseslint from "typescript-eslint";

// Minimal shared lint config: TypeScript correctness first.
export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/node_modules/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
