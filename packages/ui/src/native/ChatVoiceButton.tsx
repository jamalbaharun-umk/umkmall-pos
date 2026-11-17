import { contract } from '../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatVoiceButton.axes;

export interface ChatVoiceButtonProps extends ComposerButtonProps {
  /**
   * `active` while RECORDING — the fill goes red and the glyph becomes a pause. The label is the
   * caller's to change with it ("Berhenti merekam"), because only the caller knows what the tap does.
   */
  state?: Axes['state'][number];
  /** 32 in a chat, 36 on the landing hero. */
  size?: Axes['size'][number];
}

/** One of the four composer buttons. The KIND is fixed here, never a caller's choice. */
export const ChatVoiceButton = (props: ChatVoiceButtonProps) => (
  <ComposerButton {...props} kind="voice" glyph={{ default: 'composer-mic', active: 'pause' }} toggle={true} />
);

ChatVoiceButton.displayName = 'ChatVoiceButton';
