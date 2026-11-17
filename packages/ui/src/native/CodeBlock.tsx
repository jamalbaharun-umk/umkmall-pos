import React from 'react';
import { Platform, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { contract } from '../contract';
import { CODE_BLOCK_ACTIONS, CODE_BLOCK_BAR, CODE_BLOCK_BASE, CODE_BLOCK_BODY, CODE_BLOCK_SIZE } from './content-styles';
import { Icon } from './Icon';
import { Text } from './Text';
import { resolveTextStyle, tokens } from './theme';

type Axes = typeof contract.CodeBlock.axes;
type Of<K extends keyof Axes> = Axes[K][number];

const SIZE = CODE_BLOCK_SIZE satisfies Record<Of<'size'>, unknown>;

/** How long the copied state shows before reverting, in milliseconds. Matches the web. */
const SETTLE_MS = 2000;

type State = 'idle' | 'copied' | 'failed';

const LABELS: Record<State, string> = {
  idle: 'Salin',
  copied: 'Tersalin',
  failed: 'Gagal menyalin',
};

/**
 * The monospace face, which is the one value here that is NOT a token.
 *
 * The type scale publishes one family (Be Vietnam Pro) and no mono, and the web reaches its
 * own through Tailwind's `font-mono` stack rather than a token — so there is nothing to read.
 * These are the PLATFORM faces every device already has; naming them is not the same as
 * writing a design value, and inventing a token for a face design never chose would be worse.
 */
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

interface CodeBlockBaseProps {
  /**
   * What the copy control writes. Defaults to `children` when it is a string.
   *
   * Explicit rather than walked out of the rendered tree, for the same reason as the web: a
   * component that guesses at its own payload copies the line numbers and the language label
   * along with the code.
   */
  copyText?: string;
  /**
   * THE CLIPBOARD IS THE HOST'S, and this is the whole reason it is a prop.
   *
   * `packages/ui` carries no Expo dependency — a library that imported `expo-clipboard` would
   * force every web consumer to install it — and React Native's core `Clipboard` is removed.
   * So the app supplies the capability, exactly as the web `Menu` takes a `linkComponent`
   * because this package may not import a router.
   *
   * WITHOUT IT THE CONTROL IS NOT RENDERED. A copy button that cannot copy is worse than no
   * button: the web's whole docblock is about making a failed write visible rather than
   * silent, and shipping one that never had a clipboard to write to would be that same
   * failure moved one layer up.
   *
   * A rejection is caught and shown as `Gagal menyalin`, matching the web.
   */
  onCopy?: (text: string) => Promise<void> | void;
  /** The header bar's label — a language, a filename. The bar collapses without one. */
  label?: React.ReactNode;
  size?: Of<'size'>;
  /**
   * Controls drawn in the header bar, before the copy control — the web's prop of the same name
   * (UMK-1041), mirrored in UMK-1371. A diagram's download and expand buttons live here rather
   * than in a second bar of their own.
   */
  actions?: React.ReactNode;
  /**
   * `false` removes the copy control — for a body that is not text to copy. Defaults to `true`.
   * It does not conjure one: with no `onCopy` there is still no control, whatever this says.
   */
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * `diagram` DECIDES WHAT `children` MAY BE, which is why the props are a union. Text is the
 * fenced content and is drawn in the mono face inside the sideways scroller; a diagram is the
 * host's own rendered node (an SVG) and is drawn as given, in a plain padded box — the web's
 * `div` in place of `code`. Typed apart so a node handed to a text block is a compile error
 * rather than a silent `[object Object]`.
 */
export type CodeBlockProps = CodeBlockBaseProps &
  (
    | {
        /** The fenced content. A string, unlike the web, which also takes highlighted markup. */
        children: string;
        diagram?: false;
      }
    | {
        children: React.ReactNode;
        /** `true` draws the body as a plain box holding the host's node, for a diagram. */
        diagram: true;
      }
  );

/**
 * A fenced block with a header bar and a copy control.
 *
 * The body SCROLLS SIDEWAYS rather than wrapping, which is the one deliberate departure from
 * the web. There `whitespace-pre-wrap` keeps the newlines and still wraps, because a long line
 * would otherwise run off the side of a chat bubble. A horizontal `ScrollView` is the native
 * idiom for the same problem and keeps the indentation intact, which is half of what a fenced
 * block is for; wrapping code at a phone's width would re-break every line.
 */
export const CodeBlock = ({ children, copyText, onCopy, label, size = 'large', actions, copyable = true, diagram = false, style }: CodeBlockProps) => {
  const [state, setState] = React.useState<State>('idle');
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* Cleared on unmount, or a block copied and then closed sets state on a gone component. */
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: State) => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), SETTLE_MS);
  };

  const copy = async () => {
    const text = copyText ?? (typeof children === 'string' ? children : '');
    /* NOTHING TO COPY IS A FAILURE, not a success — the same call the web makes. Announcing
       "Tersalin" over an empty clipboard is the silent failure both are avoiding. */
    if (!text) return settle('failed');
    try {
      await onCopy?.(text);
      settle('copied');
    } catch {
      /* Swallowed on purpose and REPLACED by a visible state: the rejection carries nothing a
         user can act on, and rethrowing would take the surface down. */
      settle('failed');
    }
  };

  const { role, ...padding } = SIZE[size];
  /* Spread into the design-system `Text`, which applies the reader's size itself (UMK-1832): no scale here. */
  const body = resolveTextStyle(role, 'regular');

  return (
    <View style={[CODE_BLOCK_BASE, style]}>
      <View style={[CODE_BLOCK_BAR, padding]}>
        {typeof label === 'string' ? (
          <Text variant={role} color="invert">
            {label}
          </Text>
        ) : (
          (label ?? <View />)
        )}

        <View style={CODE_BLOCK_ACTIONS}>
          {actions}

          {copyable && onCopy !== undefined && (
            <Pressable
              accessibilityRole="button"
              /* The WORD, not only the glyph — a glyph swap is not a channel every reader has.
                 `accessibilityLiveRegion` is the native reading of the web's `aria-live`. */
              accessibilityLabel={LABELS[state]}
              accessibilityLiveRegion="polite"
              onPress={copy}
              style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.spacing['3xs'] }}
            >
              <Icon
                name={state === 'copied' ? 'check-circle' : 'composer-attach'}
                size="sm"
                color={state === 'failed' ? 'error' : 'invert'}
              />
              <Text variant="bodyLg" color={state === 'failed' ? 'error' : 'invert'}>
                {LABELS[state]}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {diagram ? (
        <View style={[CODE_BLOCK_BODY, padding]}>{children}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={CODE_BLOCK_BODY} contentContainerStyle={padding}>
          <Text variant={role} color="invert" style={{ ...body, fontFamily: MONO }}>
            {children}
          </Text>
        </ScrollView>
      )}
    </View>
  );
};

CodeBlock.displayName = 'CodeBlock';
