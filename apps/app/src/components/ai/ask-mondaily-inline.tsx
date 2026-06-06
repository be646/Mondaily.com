import { useState } from "react";
import { Send } from "lucide-react";

export function AskMondailyInline({ placeholder }: { placeholder: string }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        setValue("");
      }}
    >
      <input
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
      <button className="grid h-8 w-8 place-items-center rounded-lg text-red-400" type="submit" aria-label="Send">
        <Send size={15} />
      </button>
    </form>
  );
}

