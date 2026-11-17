import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'src/tokens/generated.ts', 'tailwind.preset.js'] },
  ...tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  {
    // Scoped to the files that actually need it, not the package. These two cast their
    // polymorphic `as` element to `any`; the rule stays live everywhere else, which is the
    // point — the primitives arriving in UMK-895..900 are what this lint setup exists to cover.
    files: ['src/primitives/Alert/*.tsx', 'src/primitives/Badge/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);
