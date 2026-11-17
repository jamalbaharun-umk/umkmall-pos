# Chat

A chat surface, in two halves. This section is ONE CATEGORY HOLDING TWO FAMILIES, and the split is
the shape of the surface rather than a filing choice: `composer` is everything a user writes a
message with, `message` is everything above it — the transcript, the rows in it, and the scroll
machinery that makes a live reply follow the reader. Two disjoint sets of components, so two guard
triples reconcile against them rather than one guard trying to cover both.

Open it when you are building somewhere a conversation happens.

`ChatComposer` owns the input frame and arrangement, and `ChatThread` owns the transcript frame, so
adopting those two whole is the default path. The parts are exported because they have genuinely
different lifetimes and consumers — a surface with an unusual toolbar builds its own arrangement
from the same buttons rather than growing the shell a prop per variation, and a message row is
useful on a card or a docs page with no transcript around it.

## Use this, not that

**`ChatToolsButton` is the `+`, `ChatAttachmentButton` is the paperclip.** Figma's `02 Tools`
set publishes three types — Mic, Tools, Send — and its word "Tools" names the paperclip. The
app has four controls, and the `+` that opens image, video and optimize is not the paperclip
that opens the file picker. The published name is what changed; the treatment and both glyphs
are as drawn.

**On `ChatSendButton`, use the `state` axis — there is no `active` boolean.** Send is an
action, not a switch, so it emits no `aria-pressed`. This shipped once with `active`
documented as the in-flight look while drawing the ordinary send glyph, which left a composer
on a surface that streams every reply with no way to become a stop button. `stop` and
`waiting` are what replaced it.

**Do not paint a `ChatDrawer` that sits inside a composer.** Its `variant` defaults to
`inherit` and paints nothing, because the tray behind it already carries the tint from
`ChatComposer.tone`. The opaque values are for a drawer used outside a composer, which has no
tray to inherit from.

**Render an attachment preview with a plain element, not the library `Image`.** That component
refuses any source which is not remote https, and a composer's previews are local blobs and
base64 by definition. The same carve-out applies to a GENERATED image in a message: those arrive
as data URLs, object-store keys and presigned links. `Image` plus `Lightbox` are the right pair
once a picture has a settled https home.

**Wrap a non-bubble child in a GHOST BUBBLE when it has to read as part of the conversation.**
This is the placement contract for artifacts, and it is a padding rule rather than a component. A
generated image, a video, an attachment chip or an artifact card renders as ordinary children of
`ChatMessage`; dropped in raw it sits flush with the message edge, a whole inset to the side of the
sentence above it — two leading edges in one message, which reads as a layout accident. A ghost
bubble drops the fill and the vertical padding and KEEPS the side padding, so the child's leading
edge meets the text column. Add `width="full"` when it should span the message column rather than
stop at the bubble's own cap. Leaving a child raw is the right answer exactly when it is MEANT to
bleed — a full-width card closing a turn — and `ChatMessageBubble`'s `GhostAlignment` story shows
both side by side.

**Put a timestamp on the LAST BUBBLE's metadata slot, not the message's, when a turn ends with an
artifact.** Both slots exist for this: a message-level timestamp sits under everything in the row,
including a card, and reads as belonging to the card rather than to the turn.

**Let `ChatThread` own the scroller; `ChatMessageList` must not.** The list is presentational —
it announces, spaces and aligns, and publishes its inner element to the frame. Two scrollers in one
transcript means the follow scrolls one box while the reader is looking at another, and every class
name on both stays correct.

## Composer members

- **ChatComposer** — the shell: the tray, the frame and the arrangement, with a `tone` axis
  and a `sendDisabled` boolean the caller owns.
- **ChatComposerInput** — the text editor. A real `<textarea>` that autogrows, never a
  `contentEditable`.
- **ChatDrawer** — the region above the editor. A container for arbitrary children, which
  renders nothing at all when empty.
- **ChatAttachment** — one attachment chip, `image` or `file`, with an optional size and a
  status for an upload in flight.
- **ChatToolsButton** — the `+` menu trigger. The one button with no published source.
- **ChatAttachmentButton** — the paperclip.
- **ChatVoiceButton** — the microphone, and the only button that goes red.
- **ChatSendButton** — send, stop or waiting.

## Message members

- **ChatThread** — the transcript frame. It owns the scroller, follows a streaming reply,
  publishes its scroll container to the list inside, and pins the return-to-bottom affordance at
  its foot.
- **ChatMessageList** — the log region. It announces politely, marks itself busy only while a
  reply streams, flows a `density` to everything inside, seats a short conversation above the
  composer, and loads older messages when the reader reaches the top.
- **ChatMessage** — one row: a `sender`, a `density`, and slots for an avatar, a name and
  metadata. It takes NO message object.
- **ChatMessageBubble** — the visible bubble, with grouping, a width override and the ghost
  presentation the placement rule above depends on. It returns a FRAGMENT, not a wrapper.
- **ChatMessageMetadata** — a timestamp, arbitrary footer content and a delivery status in one
  row. Renders nothing at all when given nothing.
- **ChatScrollButton** — the return-to-bottom pill, circular without a visible label and
  expanded with one.

The whole set assembled into the product's own chat room — shell, transcript, generated images, a
video, the action row and the composer — is the **Examples / TemanAI chat** page. Read it before
adopting any of these: it is the only page that shows the pieces beside each other, and its
docblock lists what the app still owns (the page background, the reading measure, the error and
credit overlays, and two icons this registry does not publish).

`useChatStreamScroll` is the family's one public hook and the whole of the scroll seam. It has no
contract entry, because the contract is component-keyed and an entry would demand a story file for
a thing with nothing to show.

## Worth knowing

`ChatVoiceButton`'s active fill is red where the other three are blue, and the contract records
that it must not be collapsed onto one accent constant: red says the microphone is live, blue
says the next turn is armed, and a "consolidation" onto one colour compiles, renders, and turns
a recording indicator into an arming one. Its guard asserts the disagreement.

The composer's send label and handler are the host's, and in `stop` that is load-bearing rather
than stylistic: a button drawing a stop square while still announcing "Kirim pesan" and still
calling send is worse than one that never changed.

**The message family takes no message object anywhere, and that is the only design that works
here.** Three surfaces in this product carry three incompatible message shapes, so a component
accepting any one of them would be adoptable on exactly one surface. These own chrome and slots;
the content is children. Marker parsing stays in the app for the same reason — it is the wire
protocol, and a design system should not know that a marker exists.

**The scroll lock is positional, not event-sourced.** It releases when the reader's position moves
away from the bottom, not when a wheel or touch event fires: an event listener misses a keyboard
scroll and a scrollbar drag entirely and fires on momentum frames nobody intended. Four hand-built
scroll implementations exist across this product and no two agree on their thresholds, which is
the drift this seam exists to end — and reconciling any particular surface's behaviour with it is
an adoption decision with a reader-visible outcome, not a library one.

Both families ship UNCONSUMED — nothing in `apps/` imports either yet — and adoption will be a
visual change rather than like-for-like. The composer's geometry is Figma's and the app's current
chrome has no responsive sizing at all; the message family has no published design source to
diverge from, so every one of its axes is greenfield and each entry records that rather than
leaving the absence to read as an unchecked box.
