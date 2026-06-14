import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Code, Heading2, Italic, List, ListOrdered, Minus, Quote, Send,
} from "lucide-react";
import { useEffect } from "react";

function Sep() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-white/[.07]" />;
}

export function NoteEditor({
  value,
  onChange,
  onSave,
  saving = false,
  mentions = [],
}: {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  saving?: boolean;
  mentions?: string[];
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editorProps: {
      attributes: {
        class: "min-h-[140px] px-4 py-3.5 text-sm leading-7 text-slate-200 outline-none",
      },
      handleKeyDown: (_, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && onSave) {
          event.preventDefault();
          onSave();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== value) editor.commands.setContent(value, false);
  }, [editor, value]);

  const charCount = editor?.getText().length ?? 0;

  if (!editor) return <div className="h-40 animate-pulse rounded-xl bg-white/[.03]" />;

  function btn(active: boolean, onClick: () => void, icon: React.ReactNode, title: string) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
          active
            ? "bg-white/[.10] text-white"
            : "text-slate-500 hover:bg-white/[.05] hover:text-slate-300"
        }`}
      >
        {icon}
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[.07] bg-[#0d0f13]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-white/[.06] px-3 py-2">
        {btn(editor.isActive("bold"),     () => editor.chain().focus().toggleBold().run(),        <Bold size={13} />,        "Bold")}
        {btn(editor.isActive("italic"),   () => editor.chain().focus().toggleItalic().run(),      <Italic size={13} />,      "Italic")}
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={13} />, "Heading")}
        <Sep />
        {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),  <List size={13} />,        "Bullet list")}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={13} />, "Ordered list")}
        {btn(editor.isActive("blockquote"),  () => editor.chain().focus().toggleBlockquote().run(),  <Quote size={13} />,       "Blockquote")}
        {btn(editor.isActive("code"),        () => editor.chain().focus().toggleCode().run(),        <Code size={13} />,        "Inline code")}
        <button
          type="button"
          title="Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white/[.05] hover:text-slate-300 transition-colors"
        >
          <Minus size={13} />
        </button>
        <Sep />
        {/* @mention quick-insert */}
        {mentions.slice(0, 4).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => editor.chain().focus().insertContent(`@${name.split(" ")[0]} `).run()}
            className="rounded-md px-2 py-1 text-[11px] text-slate-600 hover:bg-white/[.05] hover:text-slate-300 transition-colors"
          >
            @{name.split(" ")[0]}
          </button>
        ))}
        {onSave && (
          <button
            type="button"
            disabled={saving || editor.isEmpty}
            onClick={onSave}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-400 active:translate-y-[1px] disabled:opacity-40 transition-all"
          >
            <Send size={11} />
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-white [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-1
          [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-white/20 [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-slate-400
          [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-white/[.05] [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:text-[12px] [&_.ProseMirror_code]:text-red-300
          [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5
          [&_.ProseMirror_hr]:border-white/[.08] [&_.ProseMirror_hr]:my-3"
      />

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[.06] px-4 py-2">
        <span className="text-[11px] text-slate-700">
          {charCount > 0 ? `${charCount} characters` : "Start typing…"}
        </span>
        <span className="text-[11px] text-slate-700">⌘ + Enter to save</span>
      </div>
    </div>
  );
}
