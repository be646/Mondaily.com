import { z } from "zod";

export const EmployeeSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  department: z.string(),
  manager_id: z.string().uuid().optional(),
  start_date: z.string(),
  skills: z.array(z.string()).default([]),
  performance_score: z.number().min(1).max(5).optional()
});

export const CandidateSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role_applied: z.string(),
  stage: z.enum(["applied", "screening", "interview", "offer", "hired", "rejected"]),
  ai_score: z.number().min(0).max(100).optional()
});

