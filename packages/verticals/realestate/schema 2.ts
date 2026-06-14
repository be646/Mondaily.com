import { z } from "zod";

export const PropertySchema = z.object({
  address: z.string(),
  city: z.string(),
  postcode: z.string(),
  country: z.string().default("GB"),
  type: z.enum(["residential", "commercial", "industrial", "land"]),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  size_sqft: z.number().optional(),
  purchase_price: z.number().optional(),
  current_valuation: z.number().optional(),
  monthly_rent: z.number().optional(),
  status: z.enum(["available", "let", "under_offer", "sold", "maintenance"]),
  compliance_flags: z.array(z.string()).default([])
});

