import { z } from "zod";

export const PortfolioCompanySchema = z.object({
  name: z.string(),
  domain: z.string().optional(),
  sector: z.string(),
  stage: z.enum(["pre_seed", "seed", "series_a", "series_b", "series_c", "growth", "public"]),
  investment_date: z.string(),
  investment_amount: z.number(),
  currency: z.string().default("USD"),
  status: z.enum(["active", "exited", "written_off", "ipo"]),
  covenant_flags: z.array(z.string()).default([])
});

