import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatComposerInput } from './ChatComposerInput';
import { Icon } from '../Icon';

/**
 * The composer's autogrowing editor, usable without the shell.
 *
 * EVERY STORY IS STATEFUL, and that is not a convenience: this is a CONTROLLED component, so a
 * story that passes a fixed `value` and a no-op handler renders an editor nobody can type into.
 * That shipped once across the whole set. The wrapper below owns the state.
 *
 * A `<textarea>`, never a `contentEditable`: the element it replaces accepted no `inputMode`, no
 * `enterKeyHint`, no `autoCapitalize`, no `spellCheck` and no accessible name — not by oversight
 * but because a `div` cannot carry them.
 */
type StatefulProps = Omit<React.ComponentProps<typeof ChatComposerInput>, 'value' | 'onValueChange'> & {
  initial?: string;
};

function Stateful({ initial = '', ...props }: StatefulProps) {
  const [value, setValue] = React.useState(initial);
  return <ChatComposerInput {...props} value={value} onValueChange={setValue} />;
}

const meta: Meta<typeof ChatComposerInput> = {
  title: 'Components/Chat/ChatComposerInput',
  component: ChatComposerInput,
  parameters: { layout: 'centered' },
  args: { label: 'Tulis pesan', placeholder: 'Tanyakan bisnismu...' },
  render: (args) => (
    <div className="w-[560px]">
      <Stateful {...args} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof ChatComposerInput>;

export const Default: Story = {};

/** Type into it — and keep typing past one line to watch it grow. */
export const Typing: Story = {
  render: (args) => (
    <div className="w-[560px]">
      <Stateful {...args} initial="Halo, saya mau tanya soal HPP" />
    </div>
  ),
};

/**
 * AUTOGROW is the behaviour that makes this its own component rather than the library's multiline
 * field, which takes a fixed row count. It grows to a cap and then scrolls.
 */
export const Multiline: Story = {
  render: (args) => (
    <div className="w-[560px]">
      <Stateful {...args} initial={'baris satu\nbaris dua\nbaris tiga\nbaris empat'} />
    </div>
  ),
};

/** A NODE in place of the text property — the landing composer's placeholder rotates. */
export const PlaceholderSlot: Story = {
  render: (args) => (
    <div className="w-[560px]">
      <Stateful
        {...args}
        placeholderSlot={<span className="text-ds-paragraph-mobile leading-5 text-default-secondary">Buat gambar produk…</span>}
      />
    </div>
  ),
};

/** The affordance slot, pinned top-right INSIDE the editor box — the fullscreen trigger's home. */
export const WithAffordance: Story = {
  render: (args) => (
    <div className="w-[560px]">
      <Stateful
        {...args}
        affordance={
          <button type="button" aria-label="Mode layar penuh">
            <Icon name="maximize" className="h-4 w-4 text-default-secondary" />
          </button>
        }
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div className="w-[560px]">
      <Stateful {...args} initial="Tidak bisa diubah" disabled />
    </div>
  ),
};
