import { z } from "zod";

export const InvoiceSchema = z.object({
  number: z.string(),
  client_id: z.string().uuid(),
  line_items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    tax_rate: z.number().default(0)
  })),
  subtotal: z.number(),
  tax_total: z.number(),
  total: z.number(),
  currency: z.string().default("GBP"),
  status: z.enum(["draft", "sent", "viewed", "paid", "overdue", "cancelled"]),
  due_date: z.string()
});

