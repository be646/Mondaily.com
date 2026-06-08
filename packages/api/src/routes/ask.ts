import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const router = new Hono();

router.post("/", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().optional()
})), async (c) => {
  const { message } = c.req.valid("json");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return c.json({ reply: "OpenAI API key not configured. Please add OPENAI_API_KEY to Render environment variables." }, 500);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 512,
        messages: [
          { role: "system", content: "You are Mondaily AI, a helpful business assistant for CRM, tasks, and operations. Be concise." },
          { role: "user", content: message }
        ]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ reply: `OpenAI error: ${err}` }, 500);
    }

    const data = await res.json() as any;
    const reply = data.choices?.[0]?.message?.content || "No response from AI.";
    return c.json({ reply, thread_id: null });
  } catch (err: any) {
    return c.json({ reply: `Connection error: ${err.message}` }, 500);
  }
});

router.post("/stream", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().uuid().optional()
})), async (c) => {
  const { message } = c.req.valid("json");
  return c.json({ ok: true, message: `Received: ${message}` });
});

router.get("/threads", requireAuth, async (c) => c.json([]));

export { router as askRouter };
