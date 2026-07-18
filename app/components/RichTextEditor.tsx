// app/components/RichTextEditor.tsx
//
// The app's first client-side rich-text surface. Used on the per-product review
// page to edit a product description WITH formatting (bold, headings, lists) —
// deliberately reversing the plain-text-only per-decision editor.
//
// Two guardrails keep stored markup safe and consistent:
//   1. The editor schema below is constrained to exactly the sanitize "Full"
//      allow-list (p, br, h2, h3, ul, ol, li, strong, em, a) — TipTap cannot
//      produce a tag outside it.
//   2. The route action re-runs sanitizeHtml(html, allowedTagsFor("Full")) before
//      writing, so sanitize remains the authority on what ships regardless of
//      what the editor emits.
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import styles from "./RichTextEditor.module.css";

export interface RichTextEditorProps {
  value: string; // initial HTML (the composed description seed)
  onChange: (html: string) => void; // fires with sanitizable HTML on every edit
  label?: string;
}

// Constrain StarterKit to the sanitize allow-list. Everything StarterKit ships
// that has no matching allowed tag is disabled so the editor can never emit it.
// `link: false` defers to the explicit Link extension below — StarterKit v3
// bundles Link, so disabling it here avoids a duplicate-extension warning. If the
// installed StarterKit version does not accept this key, drop it (the explicit
// Link extension still governs link behavior).
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] }, // h2/h3 only — matches allowedTagsFor("Full")
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    strike: false,
    code: false,
    link: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    HTMLAttributes: { rel: null, target: null }, // href only; sanitize keeps just href
  }),
];

function ToolbarButton({
  editor,
  label,
  isActive,
  onRun,
}: {
  editor: Editor;
  label: string;
  isActive: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      // Prevent the button from stealing focus/selection from the editor, so the
      // command applies to the current selection instead of an empty one.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={isActive ? `${styles.button} ${styles.active}` : styles.button}
      aria-pressed={isActive}
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={styles.toolbar}>
      <ToolbarButton editor={editor} label="Bold" isActive={editor.isActive("bold")}
        onRun={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarButton editor={editor} label="Italic" isActive={editor.isActive("italic")}
        onRun={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarButton editor={editor} label="H2" isActive={editor.isActive("heading", { level: 2 })}
        onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <ToolbarButton editor={editor} label="H3" isActive={editor.isActive("heading", { level: 3 })}
        onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <ToolbarButton editor={editor} label="Bullet list" isActive={editor.isActive("bulletList")}
        onRun={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarButton editor={editor} label="Numbered list" isActive={editor.isActive("orderedList")}
        onRun={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarButton editor={editor} label="Link" isActive={editor.isActive("link")} onRun={setLink} />
    </div>
  );
}

export function RichTextEditor({ value, onChange, label }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value,
    // The app SSRs its admin routes; rendering the editor during SSR causes a
    // hydration mismatch. Defer to the client (TipTap's documented fix).
    immediatelyRender: false,
    onUpdate: ({ editor }: { editor: Editor }) => onChange(editor.getHTML()),
  });

  return (
    <div className={styles.wrapper}>
      {label && <label className={styles.label}>{label}</label>}
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className={styles.content} />
    </div>
  );
}
