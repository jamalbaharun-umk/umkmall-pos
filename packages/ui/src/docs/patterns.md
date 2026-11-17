# Patterns

How these components go together. Every pattern here is one the library already had to get
right for a real screen — not a suggestion.

## The app frame

`AppShell` is four slots and the arrangement between them: a full-height column that does not
itself scroll, a header that does not shrink, a navigation column beside the content, and a
content region whose overflow chain is pinned so **your** scroller is the thing that scrolls.

```tsx
<AppShell
  header={({ scrolled }) => <Header title="Kelas saya" scrolled={scrolled} showBack onBack={goBack} />}
  sidebar={<Sidebar label="Navigasi utama" />}
  routeKey={pathname}
>
  <main>{children}</main>
</AppShell>
```

What it deliberately does **not** reach for: a store, a router, a feature gate, an onboarding
component. Every one of those is a real thing an app has above its shell, and every one of
them is slot content rather than a dependency — a library frame that imported a router would
be unusable by the second app that wanted a frame. That import graph is asserted, not merely
intended.

The `header` slot takes a function as well as a node, and that is how `Header.scrolled` gets
fed without the shell knowing what a header is. `routeKey` clears the scroll flag on
navigation; omit it in a single-surface shell.

The one piece of behaviour the shell owns is the scroll spy that lets a header change
treatment once the content has moved. It has to be here: scroll events do not bubble, the
scroller belongs to whatever you put in `children`, and the only way to observe it from the
frame is a capturing listener. Two surfaces in the app arrived at that independently, which
is why it moved into the library rather than being predicted into it.

## A form field

Reach for the control's own `label`, not a separate `Label` beside it.

```tsx
<TextField label="Nama usaha" value={name} onChange={(e) => setName(e.target.value)} />
```

Every control in the Form section owns its label — `TextField`'s is not even optional, because
a label prop cannot be forgotten the way a sibling `<label>` can. `Label` is the standalone form, for a group
heading, a fieldset, or a non-control that still needs a name — putting one above a
`TextField` gives that field two names.

The labelling type is a union: a visible `label`, **or** an `aria-label`, never both. That is
what stops a field announcing one thing and showing another. Four controls do not accept the
`aria-label` arm at all and still require the visible label; that restriction is asserted in
the type tests, so the compiler will tell you which.

## Telling the user what happened

Two shapes, one component. `Alert` renders in place; a toast is the same visual raised into
a host.

```tsx
<Toaster />                          // once, near the root of the app

toast('Perubahan tersimpan', { variant: 'success' });
```

On the web, mount `Toaster` exactly once. It owns a single live region, and the toast path
deliberately renders `Alert` with its own `role` suppressed — nesting an assertive `role="alert"`
inside the host's polite live region produces either a double announcement or a swallowed one,
inconsistently across screen readers. A test asserting "a role is present" passes either way,
which is why the guard counts regions instead.

On React Native a sheet is its own native window (`Modal`), so the root host draws *beneath* an
open sheet. A sheet that must show a toast over itself mounts a second `Toaster` inside it. Only
the most recently mounted host draws — the others render nothing and queue no exits — so there is
still one toast and one live region at a time, and the root host takes the queue back when the
sheet closes.

Use an inline `Alert` when the message belongs to a place on the page and should stay there;
use `toast` when it belongs to an action the user just took.

## Choosing a treatment for an Alert

`Alert` carries a `treatment` axis that Figma does not publish — `full`, `accent`, `coach`,
`banner`. It exists because the app's own callout had six looks the component could not
express, and most live instances are the left-accent shape rather than the filled one. Its
colours are built from the published callout token group, so they are read rather than
invented.

`full` is pinned byte-identical to what shipped before the axis existed. If you are matching
an older screen, that is the one.

## Overlays

Everything in the Overlays section renders above the page, and each one is a different
question:

- `Dialog` interrupts: the user must deal with it before continuing.
- `Menu` offers actions from a trigger, and stays anchored to it. On React Native the same
  name is a bottom sheet, deliberately — a dropdown anchored to a trigger is not a native
  idiom, and the shared contract is about vocabulary, not about pixels.
- `Lightbox` is for viewing one thing large, with the page still behind it.

If two dialogs can be mounted at once, give them distinct title ids. A single hardcoded
`id="modal-title"` is a real regression this library has already had.

## Images

`Image` renders **only** `https://` sources. Anything else renders the placeholder and no
`<img>` element at all, so no request is made.

```tsx
<Image src={photo} alt="Foto produk" />
<Image src={pattern} decorative />
```

`alt` or `decorative`, never both and never neither. The check is case-insensitive and
anchored to the start of the string — a bare `http://` or a relative path gives you a
placeholder, not a broken image, which is worth knowing when a source silently shows nothing.

## Sizing, and what to do when a size is missing

Reach for the axis. If the axis has no value for what you need, the change is a contract
entry and a component that reads it — not a class override at the call site.

An override at the call site is invisible to every guard in this repo, and it is how a scale
ends up being patched by every caller. That has happened here: a button size every call site
overrode was a broken size, and the fix was the scale, not the call sites.
