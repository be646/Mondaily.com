// ─── Simulation Mode Store ────────────────────────────────────────────────────
// Module-level store + CustomEvent bus so any component can subscribe without
// a React context provider. State persists across navigation via localStorage.

export type SimView = "companies" | "people" | "deals";

const EV = "mondaily-sim-change";

function ls(k: string, fallback: string) {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}

export function getSimMode(): boolean  { return ls("sim_mode", "false") === "true"; }
export function getSimView(): SimView  { return (ls("sim_view", "companies")) as SimView; }

export function setSimMode(v: boolean) {
  try { localStorage.setItem("sim_mode", String(v)); } catch {}
  window.dispatchEvent(new Event(EV));
}
export function setSimView(v: SimView) {
  try { localStorage.setItem("sim_view", v); } catch {}
  window.dispatchEvent(new Event(EV));
}

export function onSimChange(fn: () => void) {
  window.addEventListener(EV, fn);
  return () => window.removeEventListener(EV, fn);
}

// ─── Dataset types ────────────────────────────────────────────────────────────
export interface SimRecord {
  id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

// ─── 20-row Companies ─────────────────────────────────────────────────────────
export const SIM_COMPANIES: SimRecord[] = [
  { id:"sc01", updated_at:"2026-05-30T09:00:00Z", data:{ name:"Stripe",         logo:"🟣", description:"Payments infrastructure for the internet",      arr:1_400_000_000, funding_raised:2_200_000_000, employee_range:"4001–7000",  country:"USA"         }},
  { id:"sc02", updated_at:"2026-05-28T11:00:00Z", data:{ name:"Vercel",         logo:"⚫", description:"Frontend cloud & deployment platform",          arr:  150_000_000, funding_raised:  313_000_000, employee_range:"201–500",   country:"USA"         }},
  { id:"sc03", updated_at:"2026-05-26T14:00:00Z", data:{ name:"Linear",         logo:"🔵", description:"Issue tracking for modern software teams",      arr:   40_000_000, funding_raised:   52_000_000, employee_range:"51–200",    country:"USA"         }},
  { id:"sc04", updated_at:"2026-05-24T10:00:00Z", data:{ name:"Retool",         logo:"🟠", description:"Low-code platform for internal tools",          arr:   55_000_000, funding_raised:  145_000_000, employee_range:"201–500",   country:"USA"         }},
  { id:"sc05", updated_at:"2026-05-22T08:30:00Z", data:{ name:"Figma",          logo:"🎨", description:"Collaborative interface design tool",           arr:  400_000_000, funding_raised:  333_000_000, employee_range:"501–1000",  country:"USA"         }},
  { id:"sc06", updated_at:"2026-05-20T16:00:00Z", data:{ name:"Notion",         logo:"⬜", description:"All-in-one connected workspace",               arr:  320_000_000, funding_raised:  343_000_000, employee_range:"501–1000",  country:"USA"         }},
  { id:"sc07", updated_at:"2026-05-18T13:00:00Z", data:{ name:"Supabase",       logo:"🟢", description:"Open source Firebase alternative",             arr:   30_000_000, funding_raised:  116_000_000, employee_range:"51–200",    country:"Singapore"   }},
  { id:"sc08", updated_at:"2026-05-16T09:45:00Z", data:{ name:"Loom",           logo:"🟡", description:"Async video messaging for work",               arr:   90_000_000, funding_raised:  203_000_000, employee_range:"201–500",   country:"USA"         }},
  { id:"sc09", updated_at:"2026-05-14T11:00:00Z", data:{ name:"Planetscale",    logo:"🪐", description:"Serverless MySQL-compatible database",          arr:   25_000_000, funding_raised:  105_000_000, employee_range:"51–200",    country:"USA"         }},
  { id:"sc10", updated_at:"2026-05-12T15:30:00Z", data:{ name:"Clerk",          logo:"🔐", description:"Authentication & user management APIs",        arr:   18_000_000, funding_raised:   67_000_000, employee_range:"51–200",    country:"USA"         }},
  { id:"sc11", updated_at:"2026-05-10T10:00:00Z", data:{ name:"Resend",         logo:"📧", description:"Email API for developers",                     arr:    8_000_000, funding_raised:   20_000_000, employee_range:"11–50",     country:"USA"         }},
  { id:"sc12", updated_at:"2026-05-08T14:00:00Z", data:{ name:"Railway",        logo:"🚂", description:"Deploy code, databases and apps instantly",    arr:   12_000_000, funding_raised:   24_000_000, employee_range:"11–50",     country:"Canada"      }},
  { id:"sc13", updated_at:"2026-05-06T09:00:00Z", data:{ name:"Miro",           logo:"🟡", description:"Online collaborative whiteboard platform",      arr:  450_000_000, funding_raised:  476_000_000, employee_range:"1001–2000", country:"Netherlands" }},
  { id:"sc14", updated_at:"2026-05-04T12:00:00Z", data:{ name:"Descript",       logo:"🎙️", description:"AI-powered video and podcast editor",          arr:   35_000_000, funding_raised:  100_000_000, employee_range:"201–500",   country:"USA"         }},
  { id:"sc15", updated_at:"2026-05-02T08:00:00Z", data:{ name:"Hex",            logo:"🔷", description:"Modern data workspace for teams",              arr:   22_000_000, funding_raised:   56_000_000, employee_range:"51–200",    country:"USA"         }},
  { id:"sc16", updated_at:"2026-04-30T11:00:00Z", data:{ name:"Airbyte",        logo:"🔗", description:"Open-source data integration platform",        arr:   45_000_000, funding_raised:  181_000_000, employee_range:"201–500",   country:"USA"         }},
  { id:"sc17", updated_at:"2026-04-28T14:00:00Z", data:{ name:"Hasura",         logo:"🌊", description:"Instant GraphQL & REST APIs on your database", arr:   30_000_000, funding_raised:  100_000_000, employee_range:"201–500",   country:"USA"         }},
  { id:"sc18", updated_at:"2026-04-26T09:30:00Z", data:{ name:"Tally",          logo:"📝", description:"Beautifully simple form builder",              arr:    5_000_000, funding_raised:    2_500_000, employee_range:"11–50",     country:"Belgium"     }},
  { id:"sc19", updated_at:"2026-04-24T10:00:00Z", data:{ name:"Raycast",        logo:"⚡", description:"Supercharged Mac productivity launcher",       arr:   15_000_000, funding_raised:   30_000_000, employee_range:"51–200",    country:"Germany"     }},
  { id:"sc20", updated_at:"2026-04-22T13:00:00Z", data:{ name:"Cal.com",        logo:"📅", description:"Open-source scheduling infrastructure",        arr:    6_000_000, funding_raised:   32_000_000, employee_range:"11–50",     country:"USA"         }},
];

// ─── 20-row People ────────────────────────────────────────────────────────────
export const SIM_PEOPLE: SimRecord[] = [
  { id:"sp01", updated_at:"2026-05-31T09:00:00Z", data:{ avatar:"👤", name:"Guillermo Rauch",   email:"g@vercel.com",           job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/rauchg",          twitter:"@rauchg",          twitter_followers: 420_000 }},
  { id:"sp02", updated_at:"2026-05-30T10:00:00Z", data:{ avatar:"👤", name:"Patrick Collison",  email:"patrick@stripe.com",     job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/patrickcollison", twitter:"@patrickc",        twitter_followers: 380_000 }},
  { id:"sp03", updated_at:"2026-05-29T11:00:00Z", data:{ avatar:"👤", name:"Dylan Field",       email:"dylan@figma.com",        job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/dylanfield",      twitter:"@zoink",           twitter_followers: 210_000 }},
  { id:"sp04", updated_at:"2026-05-28T08:30:00Z", data:{ avatar:"👤", name:"Ivan Zhao",         email:"ivan@notion.so",         job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/ivanhzhao",       twitter:"@ivanhzhao",       twitter_followers:  95_000 }},
  { id:"sp05", updated_at:"2026-05-27T09:00:00Z", data:{ avatar:"👤", name:"Karri Saarinen",    email:"karri@linear.app",       job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/karrisaarinen",   twitter:"@karrisaarinen",   twitter_followers: 130_000 }},
  { id:"sp06", updated_at:"2026-05-26T10:00:00Z", data:{ avatar:"👤", name:"Paul Copplestone",  email:"paul@supabase.io",       job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/paulcopplestone", twitter:"@kiwicopple",      twitter_followers:  72_000 }},
  { id:"sp07", updated_at:"2026-05-25T11:00:00Z", data:{ avatar:"👤", name:"David Hsu",         email:"david@retool.com",       job_title:"CEO & Co-founder",          linkedin:"linkedin.com/in/david-hsu-retool",twitter:"@hsuedavid",      twitter_followers:  41_000 }},
  { id:"sp08", updated_at:"2026-05-24T09:30:00Z", data:{ avatar:"👤", name:"Sarah Chen",        email:"s.chen@vercel.com",      job_title:"VP of Engineering",         linkedin:"linkedin.com/in/sarahchen",       twitter:"@sarahchen",       twitter_followers:  18_400 }},
  { id:"sp09", updated_at:"2026-05-23T14:00:00Z", data:{ avatar:"👤", name:"Marcus Rivera",     email:"m.rivera@linear.app",    job_title:"Head of Product",           linkedin:"linkedin.com/in/mrivera",         twitter:"@mrivera",         twitter_followers:   9_200 }},
  { id:"sp10", updated_at:"2026-05-22T10:00:00Z", data:{ avatar:"👤", name:"Priya Nair",        email:"priya@notion.so",        job_title:"Growth Lead",               linkedin:"linkedin.com/in/priyanair",       twitter:"@priyanair",       twitter_followers:   6_700 }},
  { id:"sp11", updated_at:"2026-05-21T09:00:00Z", data:{ avatar:"👤", name:"Tom Eriksson",      email:"tom@figma.com",          job_title:"Senior Product Designer",   linkedin:"linkedin.com/in/tomeriksson",     twitter:"@tomeriksson",     twitter_followers:  24_100 }},
  { id:"sp12", updated_at:"2026-05-20T11:30:00Z", data:{ avatar:"👤", name:"Yuki Tanaka",       email:"yuki@retool.com",        job_title:"Solutions Engineer",        linkedin:"linkedin.com/in/yukitanaka",      twitter:"@yukitanaka",      twitter_followers:   3_900 }},
  { id:"sp13", updated_at:"2026-05-19T08:00:00Z", data:{ avatar:"👤", name:"Amara Osei",        email:"amara@supabase.io",      job_title:"Developer Advocate",        linkedin:"linkedin.com/in/amaraosei",       twitter:"@amaraosei",       twitter_followers:  11_500 }},
  { id:"sp14", updated_at:"2026-05-18T10:00:00Z", data:{ avatar:"👤", name:"Jake Whitmore",     email:"jake@loom.com",          job_title:"Account Executive",         linkedin:"linkedin.com/in/jakewhitmore",    twitter:"@jakewhit",        twitter_followers:   2_300 }},
  { id:"sp15", updated_at:"2026-05-17T13:00:00Z", data:{ avatar:"👤", name:"Diana Popescu",     email:"diana@planetscale.com",  job_title:"Engineering Manager",       linkedin:"linkedin.com/in/dianapopescu",    twitter:"@dianapop",        twitter_followers:   7_800 }},
  { id:"sp16", updated_at:"2026-05-16T09:00:00Z", data:{ avatar:"👤", name:"James Liu",         email:"james@clerk.dev",        job_title:"Developer Relations Lead",  linkedin:"linkedin.com/in/jamesliu",        twitter:"@jliu_dev",        twitter_followers:  15_200 }},
  { id:"sp17", updated_at:"2026-05-15T11:00:00Z", data:{ avatar:"👤", name:"Nina Braun",        email:"nina@raycast.com",       job_title:"Head of Design",            linkedin:"linkedin.com/in/ninabraun",       twitter:"@ninabraun",       twitter_followers:   8_900 }},
  { id:"sp18", updated_at:"2026-05-14T14:00:00Z", data:{ avatar:"👤", name:"Léa Fontaine",      email:"lea@cal.com",            job_title:"Community Manager",         linkedin:"linkedin.com/in/leafonaine",      twitter:"@leafont",         twitter_followers:   4_100 }},
  { id:"sp19", updated_at:"2026-05-13T09:30:00Z", data:{ avatar:"👤", name:"Ravi Sharma",       email:"ravi@airbyte.com",       job_title:"Senior Data Engineer",      linkedin:"linkedin.com/in/ravisharma",      twitter:"@ravisharma_data", twitter_followers:   5_600 }},
  { id:"sp20", updated_at:"2026-05-12T10:00:00Z", data:{ avatar:"👤", name:"Chloe Andersen",    email:"chloe@hex.tech",         job_title:"Product Marketing Manager", linkedin:"linkedin.com/in/chloeandersen",   twitter:"@chloe_and",       twitter_followers:   3_300 }},
];

// ─── 20-row Deals ─────────────────────────────────────────────────────────────
const STAGES = ["Lead","Qualified","In Progress","Proposal","Negotiation","Closed Won","Closed Lost"] as const;
export const SIM_DEALS: SimRecord[] = [
  { id:"sd01", updated_at:"2026-06-01T09:00:00Z", data:{ indicator:"🟢", name:"Stripe Enterprise Expansion",     stage:"Closed Won",   value:  480_000, owner:"Sarah Chen"     }},
  { id:"sd02", updated_at:"2026-06-01T10:00:00Z", data:{ indicator:"🟡", name:"Figma Design Ops Bundle",         stage:"Negotiation",  value:  240_000, owner:"Priya Nair"     }},
  { id:"sd03", updated_at:"2026-05-31T09:00:00Z", data:{ indicator:"🟡", name:"Vercel Pro Fleet Upgrade",        stage:"Proposal",     value:  185_000, owner:"Marcus Rivera"  }},
  { id:"sd04", updated_at:"2026-05-30T11:00:00Z", data:{ indicator:"🔵", name:"Notion Workspace Scale",          stage:"In Progress",  value:  120_000, owner:"Jake Whitmore"  }},
  { id:"sd05", updated_at:"2026-05-29T08:30:00Z", data:{ indicator:"🔵", name:"Linear Dev Team Expansion",       stage:"Qualified",    value:   56_000, owner:"Marcus Rivera"  }},
  { id:"sd06", updated_at:"2026-05-28T10:00:00Z", data:{ indicator:"🔵", name:"Retool Internal Tools Rollout",   stage:"In Progress",  value:   98_500, owner:"Amara Osei"     }},
  { id:"sd07", updated_at:"2026-05-27T14:00:00Z", data:{ indicator:"⚪", name:"Supabase Scale-Up Plan",          stage:"Lead",         value:   42_000, owner:"Tom Eriksson"   }},
  { id:"sd08", updated_at:"2026-05-26T09:00:00Z", data:{ indicator:"🟢", name:"Loom Video Platform",             stage:"Closed Won",   value:  115_000, owner:"Jake Whitmore"  }},
  { id:"sd09", updated_at:"2026-05-25T11:00:00Z", data:{ indicator:"🔴", name:"Planetscale DB Migration",        stage:"Closed Lost",  value:   88_000, owner:"Diana Popescu"  }},
  { id:"sd10", updated_at:"2026-05-24T10:00:00Z", data:{ indicator:"⚪", name:"Clerk Auth Integration",          stage:"Lead",         value:   28_000, owner:"James Liu"      }},
  { id:"sd11", updated_at:"2026-05-23T13:00:00Z", data:{ indicator:"🟡", name:"Miro Whiteboard Enterprise",      stage:"Proposal",     value:  310_000, owner:"Priya Nair"     }},
  { id:"sd12", updated_at:"2026-05-22T09:30:00Z", data:{ indicator:"🔵", name:"Airbyte Data Pipeline",           stage:"In Progress",  value:   74_000, owner:"Ravi Sharma"    }},
  { id:"sd13", updated_at:"2026-05-21T11:00:00Z", data:{ indicator:"⚪", name:"Raycast Team Licence",            stage:"Lead",         value:   18_500, owner:"Nina Braun"     }},
  { id:"sd14", updated_at:"2026-05-20T14:00:00Z", data:{ indicator:"🟢", name:"Resend Transactional Email",      stage:"Closed Won",   value:   32_000, owner:"Chloe Andersen" }},
  { id:"sd15", updated_at:"2026-05-19T09:00:00Z", data:{ indicator:"🔵", name:"Hex Analytics Workspace",         stage:"Qualified",    value:   55_000, owner:"Ravi Sharma"    }},
  { id:"sd16", updated_at:"2026-05-18T10:00:00Z", data:{ indicator:"🟡", name:"Cal.com Scheduling Suite",        stage:"Negotiation",  value:   22_000, owner:"Léa Fontaine"   }},
  { id:"sd17", updated_at:"2026-05-17T13:00:00Z", data:{ indicator:"🔴", name:"Hasura GraphQL Platform",         stage:"Closed Lost",  value:   67_000, owner:"Sarah Chen"     }},
  { id:"sd18", updated_at:"2026-05-16T09:00:00Z", data:{ indicator:"🔵", name:"Descript Podcast Toolkit",        stage:"In Progress",  value:   48_000, owner:"Jake Whitmore"  }},
  { id:"sd19", updated_at:"2026-05-15T11:00:00Z", data:{ indicator:"🟢", name:"Tally Forms Enterprise",          stage:"Closed Won",   value:   15_000, owner:"Léa Fontaine"   }},
  { id:"sd20", updated_at:"2026-05-14T10:00:00Z", data:{ indicator:"⚪", name:"Railway Infrastructure Upgrade",  stage:"Lead",         value:   38_000, owner:"Marcus Rivera"  }},
];

export const SIM_VIEWS: { key: SimView; label: string; records: SimRecord[]; columns: string[] }[] = [
  {
    key: "companies",
    label: "Companies",
    records: SIM_COMPANIES,
    columns: ["name","logo","description","arr","funding_raised","employee_range","country"],
  },
  {
    key: "people",
    label: "People",
    records: SIM_PEOPLE,
    columns: ["avatar","name","email","job_title","linkedin","twitter","twitter_followers"],
  },
  {
    key: "deals",
    label: "Deals",
    records: SIM_DEALS,
    columns: ["indicator","name","stage","value","owner"],
  },
];

export function getSimViewData(view: SimView) {
  return SIM_VIEWS.find(v => v.key === view)!;
}
