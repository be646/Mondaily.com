import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import OpenAI from "openai";

const router = new Hono();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post("/", requireAuth, zValidator("json", z.object({
  message: z.string().min(1),
  thread_id: z.string().optional()
})), async (c) => {
  const { message } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are Mondaily AI — an intelligent business assistant. You help users manage their CRM, tasks, contacts, deals, and business operations. Workspace ID: ${workspaceId}. Be concise, helpful, and actionable.`
        },
        { role: "user", content: message }
      ],
      max_tokens: 1024
    });

    const reply = response.choices[0]?.message?.content || "I couldn't process that request.";
    return c.json({ reply, thread_id: null });
  } catch (err: any) {
    return c.json({ reply: `Sorry, I encountered an error: ${err.message}` }, 500);
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
