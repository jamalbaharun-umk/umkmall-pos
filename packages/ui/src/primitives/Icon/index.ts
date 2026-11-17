/*
 * THE RE-EXPORTS LIVE HERE, NOT IN `Icon.tsx`, AND THAT IS LOAD-BEARING.
 *
 * `react-docgen-typescript` returns ZERO props for a component when a re-export of an
 * imported symbol sits in the same file. `Icon.tsx` used to carry
 * `export { ICON_NAMES, ICON_REGISTRY } from './registry';`, and the manifest that
 * `features.componentsManifest` emits therefore documented `Icon` as taking NO props —
 * including the required `name`. An agent reading `docs-show` was told the component
 * accepts nothing, which is exactly the silent-blank-page failure the prototyping kit
 * exists to prevent (UMK-1027): a missing required prop throws and React unmounts the tree.
 *
 * Nothing errors when this regresses. The tell is a zero-prop entry in
 * `apps/design/dist/manifests/components.json`. Same fix in `Menu/index.ts`.
 */
export { Icon } from './Icon';
export { ICON_NAMES, ICON_REGISTRY } from './registry';
export type { IconProps, IconSize, IconColor } from './Icon';
export type { IconName } from './registry';
