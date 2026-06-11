export interface DemoRecord {
  id: string;
  data: Record<string, unknown>;
  updated_at: string;
  ai_summary?: string;
}

const d = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();

export const DEMO_COMPANIES: DemoRecord[] = [
  { id: "demo-c1", updated_at: d(1),  data: { name: "Vercel Inc.",       description: "Frontend cloud platform",              arr: 120_000_000, funding_raised: 313_000_000, employee_range: "201–500"  } },
  { id: "demo-c2", updated_at: d(3),  data: { name: "Linear",            description: "Issue tracking for modern teams",      arr: 35_000_000,  funding_raised: 52_000_000,  employee_range: "51–200"   } },
  { id: "demo-c3", updated_at: d(5),  data: { name: "Loom",              description: "Async video messaging",                arr: 80_000_000,  funding_raised: 203_000_000, employee_range: "201–500"  } },
  { id: "demo-c4", updated_at: d(7),  data: { name: "Notion",            description: "All-in-one workspace",                 arr: 300_000_000, funding_raised: 343_000_000, employee_range: "501–1000" } },
  { id: "demo-c5", updated_at: d(10), data: { name: "Figma",             description: "Collaborative design tool",            arr: 400_000_000, funding_raised: 333_000_000, employee_range: "501–1000" } },
  { id: "demo-c6", updated_at: d(12), data: { name: "Retool",            description: "Low-code internal tools",              arr: 50_000_000,  funding_raised: 145_000_000, employee_range: "201–500"  } },
  { id: "demo-c7", updated_at: d(14), data: { name: "Supabase",          description: "Open-source Firebase alternative",     arr: 22_000_000,  funding_raised: 116_000_000, employee_range: "51–200"   } },
  { id: "demo-c8", updated_at: d(18), data: { name: "Planetscale",       description: "Serverless MySQL platform",            arr: 18_000_000,  funding_raised: 105_000_000, employee_range: "51–200"   } },
];

export const DEMO_PEOPLE: DemoRecord[] = [
  { id: "demo-p1", updated_at: d(2),  data: { name: "Sarah Chen",        email: "sarah@vercel.com",       job_title: "VP of Engineering",    linkedin: "linkedin.com/in/sarahchen",   twitter: "@sarahchen",   twitter_followers: 18_400  } },
  { id: "demo-p2", updated_at: d(4),  data: { name: "Marcus Rivera",     email: "marcus@linear.app",      job_title: "Head of Product",       linkedin: "linkedin.com/in/mrivera",     twitter: "@mrivera",     twitter_followers: 9_200   } },
  { id: "demo-p3", updated_at: d(6),  data: { name: "Priya Nair",        email: "priya@notion.so",        job_title: "Growth Lead",           linkedin: "linkedin.com/in/priyanair",   twitter: "@priyanair",   twitter_followers: 6_700   } },
  { id: "demo-p4", updated_at: d(8),  data: { name: "Tom Eriksson",      email: "tom@figma.com",          job_title: "Senior Designer",       linkedin: "linkedin.com/in/tomeriksson", twitter: "@tomeriksson", twitter_followers: 24_100  } },
  { id: "demo-p5", updated_at: d(11), data: { name: "Yuki Tanaka",       email: "yuki@retool.com",        job_title: "Solutions Engineer",    linkedin: "linkedin.com/in/yukitanaka",  twitter: "@yukitanaka",  twitter_followers: 3_900   } },
  { id: "demo-p6", updated_at: d(13), data: { name: "Amara Osei",        email: "amara@supabase.io",      job_title: "Developer Advocate",    linkedin: "linkedin.com/in/amaraosei",   twitter: "@amaraosei",   twitter_followers: 11_500  } },
  { id: "demo-p7", updated_at: d(16), data: { name: "Jake Whitmore",     email: "jake@loom.com",          job_title: "Account Executive",     linkedin: "linkedin.com/in/jakewhitmore",twitter: "@jakewhit",    twitter_followers: 2_300   } },
  { id: "demo-p8", updated_at: d(20), data: { name: "Diana Popescu",     email: "diana@planetscale.com",  job_title: "Engineering Manager",   linkedin: "linkedin.com/in/dianapopescu",twitter: "@dianapop",    twitter_followers: 7_800   } },
];

export const DEMO_DEALS: DemoRecord[] = [
  { id: "demo-d1", updated_at: d(1),  data: { name: "Vercel Enterprise Expansion", stage: "Negotiation",  owner: "Jake Whitmore",  value: 180_000 } },
  { id: "demo-d2", updated_at: d(3),  data: { name: "Notion Q3 Renewal",           stage: "Closed Won",   owner: "Sarah Chen",     value: 95_000  } },
  { id: "demo-d3", updated_at: d(5),  data: { name: "Figma Design Ops Bundle",      stage: "Proposal",     owner: "Priya Nair",     value: 240_000 } },
  { id: "demo-d4", updated_at: d(7),  data: { name: "Linear Startup Pack",          stage: "Qualified",    owner: "Marcus Rivera",  value: 28_000  } },
  { id: "demo-d5", updated_at: d(9),  data: { name: "Retool Internal Tools",        stage: "Closed Won",   owner: "Amara Osei",     value: 67_500  } },
  { id: "demo-d6", updated_at: d(12), data: { name: "Supabase Scale-Up",            stage: "Lead",         owner: "Tom Eriksson",   value: 42_000  } },
  { id: "demo-d7", updated_at: d(15), data: { name: "Loom Video Platform",          stage: "Proposal",     owner: "Jake Whitmore",  value: 115_000 } },
  { id: "demo-d8", updated_at: d(19), data: { name: "Planetscale DB Migration",     stage: "Closed Lost",  owner: "Diana Popescu",  value: 88_000  } },
];

export function getDemoRecords(objectType: string): DemoRecord[] | null {
  const t = objectType.toLowerCase();
  if (t.includes("compan") || t.includes("org") || t.includes("account")) return DEMO_COMPANIES;
  if (t.includes("people") || t.includes("person") || t.includes("contact")) return DEMO_PEOPLE;
  if (t.includes("deal") || t.includes("crm") || t.includes("opportunit") || t.includes("pipeline")) return DEMO_DEALS;
  return null;
}
