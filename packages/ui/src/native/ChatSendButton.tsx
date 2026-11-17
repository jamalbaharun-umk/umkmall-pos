import { contract } from '../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';
import { COMPOSER_SEND_STATE } from './composer-styles';

type Axes = typeof contract.ChatSendButton.axes;
export type ChatSendState = Axes['state'][number];

/**
 * `stop` interrupts a streaming reply on the ERROR fill — the same fill the recording mic
 * takes, because both interrupt something already running. `waiting` stays blue and only
 * changes its glyph.
 */
const SEND_GLYPH = {
  send: 'composer-send',
  stop: 'square',
  waiting: 'loader',
} as const satisfies Record<ChatSendState, string>;

export interface ChatSendButtonProps extends ComposerButtonProps {
  /**
   * ITS OWN THREE-VALUE AXIS, not the toggles' `default | active` — the two are different sets,
   * not a subset, and the distinction is the whole point.
   *
   * A composer on a surface that streams every reply needs to become a stop button; mapping
   * the toggles' `active` onto send gives it no way to. The label and the handler stay the HOST's in
   * `stop` — a stop square still announcing "Kirim pesan" is worse than no change at all.
   */
  state?: ChatSendState;
  /** 32 in a chat, 36 on the landing hero. */
  size?: Axes['size'][number];
}

export const ChatSendButton = ({ state = 'send', size, ...props }: ChatSendButtonProps) => (
  <ComposerButton
    {...props}
    size={size}
    kind="send"
    glyph={{ default: SEND_GLYPH[state], active: SEND_GLYPH[state] }}
    /* The web's `COMPOSER_SEND_STATE`: `stop` takes the error fill. Until UMK-1128 native drew
       stop on the resting blue while this file's docblock said red. */
    fill={COMPOSER_SEND_STATE[state]}
    /* An action, never a toggle — see `ComposerButton`. */
    toggle={false}
    /* `stop`'s square and `waiting`'s spinner sit tighter in the circle than the send arrow.
       The web's `tight` and `spinner` pair: 14 and 16 in a chat (both the `sm` rung here — see
       `composer-paint.test.ts` on the 14), 16 and 20 on `landing`. The send arrow takes the
       base's own rule, which is what moves it to 24 on `landing`. */
    glyphSize={state === 'send' ? undefined : state === 'waiting' && size === 'landing' ? 'md' : 'sm'}
  />
);

ChatSendButton.displayName = 'ChatSendButton';
