import { Link } from "react-router-dom";

const objects = ["people", "companies", "deals"];

export function SidebarObjects() {
  return (
    <section className="mt-5">
      <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">Records</p>
      {objects.map((object) => (
        <Link key={object} to={`/dashboard/objects/${object}`} className="mb-1 block rounded-lg px-3 py-2 text-sm capitalize text-slate-400 hover:bg-white/[.04]">
          {object}
        </Link>
      ))}
    </section>
  );
}

