import { contract } from '../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatAttachmentButton.axes;

export interface ChatAttachmentButtonProps extends ComposerButtonProps {
  /** `active` while the attach menu is open — the glyph becomes the published minus. */
  state?: Axes['state'][number];
  /** 32 in a chat, 36 on the landing hero. */
  size?: Axes['size'][number];
}

/** One of the four composer buttons. The KIND is fixed here, never a caller's choice. */
export const ChatAttachmentButton = (props: ChatAttachmentButtonProps) => (
  <ComposerButton {...props} kind="attachment" glyph={{ default: 'composer-attach', active: 'composer-minus' }} toggle={true} />
);

ChatAttachmentButton.displayName = 'ChatAttachmentButton';
