import { contract } from '../contract';
import { ComposerButton, type ComposerButtonProps } from './composer-button';

type Axes = typeof contract.ChatToolsButton.axes;

export interface ChatToolsButtonProps extends ComposerButtonProps {
  /** `active` while the menu is open — the glyph becomes a minus, because the same tap closes it. */
  state?: Axes['state'][number];
  /** 32 in a chat, 36 on the landing hero. */
  size?: Axes['size'][number];
  /** A dot while true. For a state the closed menu must still show, such as an armed tool. */
  badge?: boolean;
}

/** One of the four composer buttons. The KIND is fixed here, never a caller's choice. */
export const ChatToolsButton = (props: ChatToolsButtonProps) => (
  <ComposerButton {...props} kind="tools" glyph={{ default: 'composer-plus', active: 'composer-minus' }} toggle={true} />
);

ChatToolsButton.displayName = 'ChatToolsButton';
