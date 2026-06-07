import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, Send } from "lucide-react";
import { useEffect } from "react";

export function NoteEditor({
  value,
  onChange,
  onSave,
  saving = false,
  mentions = []
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
        class: "min-h-32 px-3 py-3 text-sm leading-6 text-slate-200 outline-none"
      },
      handleKeyDown: (_, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && onSave) {
          event.preventDefault();
          onSave();
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML())
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== value) editor.commands.setContent(value, false);
  }, [editor, value]);

  if (!editor) return <div className="h-40 animate-pulse rounded-lg bg-white/[.035]" />;

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0b0d10]">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
        <button type="button" title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} className={`grid h-8 w-8 place-items-center rounded ${editor.isActive("bold") ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/[.05]"}`}><Bold size={14} /></button>
        <button type="button" title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} className={`grid h-8 w-8 place-items-center rounded ${editor.isActive("italic") ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/[.05]"}`}><Italic size={14} /></button>
        <button type="button" title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} className={`grid h-8 w-8 place-items-center rounded ${editor.isActive("bulletList") ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/[.05]"}`}><List size={14} /></button>
        {mentions.slice(0, 5).map((name) => (
          <button key={name} type="button" onClick={() => editor.chain().focus().insertContent(`@${name} `).run()} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-white/[.05] hover:text-slate-300">
            @{name.split(" ")[0]}
          </button>
        ))}
        {onSave ? <button type="button" disabled={saving || editor.isEmpty} onClick={onSave} className="ml-auto flex h-8 items-center gap-2 rounded bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-50"><Send size={13} /> Save</button> : null}
      </div>
      <EditorContent editor={editor} />
      <p className="border-t border-white/10 px-3 py-2 text-[11px] text-slate-600">Press Cmd+Enter to save</p>
    </div>
  );
}
