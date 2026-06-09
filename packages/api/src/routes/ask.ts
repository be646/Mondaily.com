import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const router = new Hono();

router.post("/", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().optional(),
  model: z.enum(["auto", "fast", "smart"]).optional()
})), async (c) => {
  const { message, model: modelPref } = c.req.valid("json");
  const modelMap: Record<string, string> = {
    fast: "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-6",
    auto: "claude-sonnet-4-6"
  };
  const model = modelMap[modelPref ?? "auto"] ?? "claude-sonnet-4-6";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ reply: "Anthropic API key not configured on server." }, 500);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        system: "You are Mondaily AI, an intelligent business operating system. You help users manage contacts, deals, tasks, pipelines, and all business operations. Be concise, smart, and actionable. Never mention Claude, Anthropic, OpenAI, or any underlying AI technology — you are simply Mondaily AI.",
        messages: [{ role: "user", content: message }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ reply: `Claude error: ${err}` }, 500);
    }

    const data = await res.json() as any;
    const reply = data.content?.[0]?.text || "No response from Claude.";
    return c.json({ reply, thread_id: null });
  } catch (err: any) {
    return c.json({ reply: `Connection error: ${err.message}` }, 500);
  }
});

router.post("/stream", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().uuid().optional()
})), async (c) => {
  const { message, model: modelPref } = c.req.valid("json");
  const modelMap: Record<string, string> = {
    fast: "claude-haiku-4-5-20251001",
    smart: "claude-sonnet-4-6",
    auto: "claude-sonnet-4-6"
  };
  const model = modelMap[modelPref ?? "auto"] ?? "claude-sonnet-4-6";
  return c.json({ ok: true, message: `Received: ${message}` });
});

router.get("/threads", requireAuth, async (c) => c.json([]));

export { router as askRouter };
