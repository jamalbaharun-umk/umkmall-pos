/**
 * `@umkmall/ui/native` — the React Native half of the design system.
 *
 * A SEPARATE entry point, not `.native.tsx` siblings behind the shared barrel. The sibling
 * form is appealing (Metro resolves `.native.tsx`, web bundlers take `.tsx`, one import path
 * on both platforms) and it is a bundle-time landmine: `src/index.ts` re-exports EVERY
 * primitive, so one import through it pulls in each web component that has no native sibling
 * yet, and Radix and `lucide-react` with them. UMK-894 proposed that mechanism and was
 * retired for it.
 *
 * Nothing reachable from this file may import `react-dom`, `@radix-ui/*` or `lucide-react`.
 * `__tests__/no-dom.test.ts` walks the import graph and fails on any of them, because Metro
 * resolving a DOM tree into the app bundle is the failure this entry point exists to prevent
 * — at bundle time if you are lucky, at runtime if you are not.
 *
 * Export names and variant vocabulary mirror the web exports exactly. The contract
 * (`../contract`) is the shared source both sides read, so a variant cannot exist on one
 * platform only. `__tests__/exports.test.ts` holds the enumerated list of component exports
 * — the count is asserted explicitly, so a new sibling reddens it and forces the playbook
 * entry (UMK-915) to be added with it.
 *
 * FOUR CONTRACT ENTRIES HAVE NO SIBLING HERE, EACH BY DECISION (UMK-986). The contract's
 * `native` field carries the full argument per entry and `contract/native-parity.test.ts`
 * checks that each absence is still true — build one and the guard reds until the record is
 * updated. In short:
 *
 * - `Tooltip` — hover-triggered, and touch has no hover. "Native has no tooltips" is the
 *   answer; a control that needs to explain itself does so in its label or `accessibilityHint`.
 * - `Sidebar`, `Header`, `AppShell` — a port of each would be a DIFFERENT COMPONENT rather
 *   than a mirror: native has no rail, no `md:` breakpoint, and no browser chrome for a
 *   viewport shell to work around.
 *
 * `DateTimeInput` WAS AMONG THEM until UMK-1128: it landed when two screens needed a date, on
 * the platform picker (`@react-native-community/datetimepicker`, a native module — rebuild the
 * dev client).
 *
 * THE CHAT MESSAGE FAMILY IS HERE AHEAD OF ITS SCREEN (UMK-1129). `ChatMessage`,
 * `ChatMessageBubble`, `ChatMessageMetadata`, `ChatMessageList`, `ChatThread` and
 * `ChatScrollButton` mirror the web primitives and are exercised in the playbook only. No
 * `apps/mobile` screen renders them, by the parity rule: the web Teman AI transcript is hand-drawn
 * and uses none of them, so moving the native transcript onto them before the web adopts them would
 * make native stop matching the page it ports. The screen move is UMK-878's, after the web's.
 *
 * The house half of `Icon`'s registry is NO LONGER among them — the generator ported every
 * glyph and `icon-parity.test.ts` asserts nothing is `null`.
 */
export { Text, type TextProps, type TextRole, type WeightFor } from './Text';
export {
  DEFAULT_TEXT_SIZE,
  isTextSize,
  scaleTextStyle,
  TEXT_SIZE_SCALE,
  TEXT_SIZES,
  TextScaleProvider,
  useTextScale,
  type TextSize,
} from './text-scale';
export { Icon, ICON_NAMES, ICON_REGISTRY, PORTED_ICON_NAMES, type IconName, type IconProps, type IconSize, type IconColor } from './Icon';
export { Spinner, type SpinnerProps, type SpinnerSize, type SpinnerVariant } from './Spinner';
export { Button, type ButtonContentState, type ButtonProps } from './Button';
export { TextField, type TextFieldProps, type TextFieldType } from './TextField';
export { CheckBox, type CheckBoxProps } from './CheckBox';
export { Radio, type RadioProps } from './Radio';
export { Switch, type SwitchProps } from './Switch';
export { Slider, type SliderProps } from './Slider';
export { Alert, type AlertProps, type AlertSize, type AlertTreatment, type AlertType, type AlertVariant } from './Alert';
export { Toaster, toast, type ToasterProps, type ToastOptions } from './Toaster';
export { Skeleton, type SkeletonProps, type SkeletonShape } from './Skeleton';
export { Badge, type BadgeProps, type BadgeColor, type BadgeSize } from './Badge';
export { Chip, type ChipProps, type ChipSize, type ChipState } from './Chip';
export { Card, type CardProps, type CardPadding, type CardVariant } from './Card';
export { Tabs, TabsList, TabsTrigger, TabsContent, type TabsProps, type TabsListProps, type TabsTriggerProps, type TabsContentProps, type TabSize, type TabState } from './Tabs';
export { List, type ListProps, type ListDirection } from './List';
export { Disclosure, type DisclosureProps } from './Disclosure';
export { Image, type ImageProps, type ImageFit, type ImageSize, type ImageType } from './Image';
export { Divider, type DividerProps, type DividerOrientation, type DividerVariant } from './Divider';
export { Dialog, type DialogProps } from './Dialog';
export { Menu, type MenuProps, type MenuItem } from './Menu';
export { Label, type LabelProps } from './Label';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { CodeBlock, type CodeBlockProps } from './CodeBlock';
export { Stepper, type StepperProps, type StepperStep } from './Stepper';
export { SelectionCard, type SelectionCardProps, type SelectionCardOption } from './SelectionCard';
export { Select, type SelectProps, type SelectOption } from './Select';
export { Upload, type UploadProps } from './Upload';
export { DateTimeInput, type DateTimeInputProps } from './DateTimeInput';
export { Lightbox, type LightboxProps } from './Lightbox';
export { ChatToolsButton, type ChatToolsButtonProps } from './ChatToolsButton';
export { ChatAttachmentButton, type ChatAttachmentButtonProps } from './ChatAttachmentButton';
export { ChatVoiceButton, type ChatVoiceButtonProps } from './ChatVoiceButton';
export { ChatSendButton, type ChatSendButtonProps, type ChatSendState } from './ChatSendButton';
export { ChatAttachment, type ChatAttachmentProps, type ChatAttachmentVariant, type ChatAttachmentStatus } from './ChatAttachment';
export { ChatComposer, type ChatComposerProps, type ChatComposerTone } from './ChatComposer';
export { ChatComposerInput, type ChatComposerInputProps } from './ChatComposerInput';
export { ChatDrawer, type ChatDrawerProps, type ChatDrawerVariant } from './ChatDrawer';
export { ChatSoundWave, type ChatSoundWaveProps } from './ChatSoundWave';
export { ChatVoiceBar, type ChatVoiceBarProps } from './ChatVoiceBar';
export { ChatMessageTTSButton, type ChatMessageTTSButtonProps } from './ChatMessageTTSButton';
export { ChatMessage, type ChatMessageProps } from './ChatMessage';
export { ChatMessageBubble, type ChatMessageBubbleProps } from './ChatMessageBubble';
export { ChatMessageMetadata, type ChatMessageMetadataProps } from './ChatMessageMetadata';
export { ChatMessageList, type ChatMessageListProps } from './ChatMessageList';
export { ChatThread, type ChatThreadProps, type ChatStreamScroll } from './ChatThread';
export { ChatScrollButton, type ChatScrollButtonProps } from './ChatScrollButton';
export {
  FONT_FAMILY_BY_WEIGHT,
  ICON_COLOR_VALUES,
  TEXT_COLOR_VALUES,
  TEXT_COLORS,
  measure,
  resolveTextStyle,
  shadowStyle,
  tokens,
  withAlpha,
  type TextColor,
  type TextWeight,
} from './theme';
export { FieldError, FieldLabel, RequiredMark, useFieldIds } from './field-support';
/* A paint helper, not a component: it has no contract entry and no playbook page of its own —
   the components that wear it (`Badge`'s `gradient`) are where a gradient is shown. Exported so
   the app's own surfaces draw a sweep through the SAME direction table (UMK-1128). */
export { GradientFill, type GradientDirection, type GradientFillProps } from './gradient';
/* Motion helpers (native-ui-v2, docs/guidelines/mobile-design-identity.md §7): behaviour, not
   components — no contract entry and no playbook page of their own; the components that wear
   them are where motion is shown. Every v2 entrance and press goes through these. */
export {
  EASING,
  Enter,
  EnterList,
  MOTION,
  PressableScale,
  PressableScaleHost,
  parseCubicBezier,
  staggerDelay,
  useReducedMotion,
  type EnterListProps,
  type EnterProps,
  type PressScale,
  type PressableScaleHostProps,
  type PressableScaleProps,
  type PressScaleState,
} from './motion';
/* Haptics (UMK-1602): the one door to `expo-haptics`. A kind lands with its first caller. */
export { haptic, type HapticKind } from './haptics';
/* native-ui-v2 surfaces (docs/guidelines/mobile-design-identity.md §4.1): the avatar. The v2 card
   is `Card variant="outlined"` from the existing export above (the glass card and its backdrop were
   deleted, UMK-1603). */
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
/* native-ui-v2 list chrome (identity doc §4.5): a labelled group of rows and the rows. */
export { ListGroup, type ListGroupProps } from './ListGroup';
export { ListRow, type ListRowProps, type ListRowTrailing } from './ListRow';
/* native-ui-v2 navigation (identity doc §5.1, §5.2). `navigatorTabBar` is the expo-router
   adapter for `TabBar`, not a component. */
export {
  TabBar,
  navigatorTabBar,
  type TabBarItem,
  type TabBarProps,
  type TabNavigatorBarProps,
} from './TabBar';
/* The bar's height, so a host reserves room under its content from the bar's own number rather
   than a copy that drifts when the bar changes size. */
export { TAB_BAR_HEIGHT } from './nav-styles';
export { IconButton, type IconButtonProps, type IconButtonVariant } from './IconButton';
/* native-ui-v2 identity cards (docs/guidelines/mobile-design-identity.md §4.2, §4.3, §4.7). */
export { FeatureTile, type FeatureTileIcon, type FeatureTileLayout, type FeatureTileProps, type FeatureTileTone } from './FeatureTile';
export { PhotoCard, type PhotoCardProps } from './PhotoCard';
export { CoinChip, type CoinChipProps, type CoinChipSize, type CoinChipVariant } from './CoinChip';
/* The Profil header (UMK-1601 / UMK-1614): avatar, name and the "phone - business name" line. */
export { ProfileHeader, type ProfileHeaderProps } from './ProfileHeader';
/* The numbered pager (UMK-1601 / UMK-1614): Paket Teman AI's Riwayat Pembelian. */
export { Pagination, type PaginationProps, type PaginationSize } from './Pagination';
/* The month calendar of the Jadwal screen (UMK-1358): counts under the days, a selected-day square, Monday first. */
export { MonthCalendar, type MonthCalendarProps } from './MonthCalendar';
