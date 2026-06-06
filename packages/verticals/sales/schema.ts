import { z } from "zod";

export const ContactSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  company_id: z.string().uuid().optional(),
  lead_score: z.number().min(0).max(100).optional(),
  icp_fit: z.enum(["strong", "moderate", "weak", "unknown"]).default("unknown"),
  buying_signals: z.array(z.string()).default([])
});

export const DealSchema = z.object({
  name: z.string(),
  company_id: z.string().uuid(),
  contact_ids: z.array(z.string().uuid()).default([]),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]),
  value: z.number().optional(),
  currency: z.string().default("USD"),
  probability: z.number().min(0).max(100).optional(),
  ai_health_score: z.number().min(0).max(100).optional(),
  ai_risk_flags: z.array(z.string()).default([])
});

