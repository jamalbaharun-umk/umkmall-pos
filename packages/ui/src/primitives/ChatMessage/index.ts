/**
 * The chat MESSAGE family's barrel — the transcript half of the `Chat` category.
 *
 * The composer family next door owns the input half. These are disjoint sets under one category,
 * which is why they are two families with two guard triples rather than one of each.
 *
 * The context module is exported for its TYPES and its standalone defaults only. The providers
 * themselves are internal: a caller mounting one by hand would be setting a sender or a density
 * that no row agreed to, which is exactly the state the row exists to own.
 */
export { ChatMessage, type ChatMessageProps } from './ChatMessage';
export { ChatMessageBubble, type ChatMessageBubbleProps } from './ChatMessageBubble';
export { ChatMessageList, type ChatMessageListProps } from './ChatMessageList';
export { ChatMessageMetadata, type ChatMessageMetadataProps } from './ChatMessageMetadata';
export { ChatMessageTTSButton, type ChatMessageTTSButtonProps } from './ChatMessageTTSButton';
export { ChatScrollButton, type ChatScrollButtonProps } from './ChatScrollButton';
export { ChatThread, type ChatThreadProps } from './ChatThread';
export {
  useChatStreamScroll,
  type ChatStreamScroll,
  type ChatStreamScrollOptions,
} from './use-chat-stream-scroll';
export {
  MESSAGE_MARKER,
  STANDALONE_DENSITY,
  STANDALONE_SENDER,
  type ChatMessageDensity,
  type ChatMessageSender,
} from './message-context';
