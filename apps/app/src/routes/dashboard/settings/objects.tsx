import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Calendar,
  CheckSquare,
  ChevronRight,
  Database,
  File,
  FunctionSquare,
  Hash,
  Link,
  List,
  Lock,
  Mail,
  Percent,
  Phone,
  Plus,
  Text,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

type AttributeType = "text" | "long_text" | "number" | "currency" | "percentage" | "date" | "datetime" | "checkbox" | "select" | "multi_select" | "url" | "email" | "phone" | "relation" | "formula" | "file";
interface Attribute { id?: string; name: string; type: AttributeType; required?: boolean; unique?: boolean }
interface ObjectDefinition { id: string; name_singular?: string; name_plural: string; slug: string; icon?: string; color?: string; is_standard?: boolean; vertical?: string; attributes: Attribute[] }

const typeOptions: { type: AttributeType; label: string; icon: typeof Text }[] = [
  { type: "text", label: "Text", icon: Text }, { type: "long_text", label: "Long text", icon: Text },
  { type: "number", label: "Number", icon: Hash }, { type: "currency", label: "Currency", icon: Hash },
  { type: "percentage", label: "Percentage", icon: Percent }, { type: "date", label: "Date", icon: Calendar },
  { type: "datetime", label: "Date + time", icon: Calendar }, { type: "checkbox", label: "Checkbox", icon: CheckSquare },
  { type: "select", label: "Select", icon: List }, { type: "multi_select", label: "Multi-select", icon: List },
  { type: "url", label: "URL", icon: Link }, { type: "email", label: "Email", icon: Mail },
  { type: "phone", label: "Phone", icon: Phone }, { type: "relation", label: "Relation", icon: AtSign },
  { type: "formula", label: "Formula", icon: FunctionSquare }, { type: "file", label: "File", icon: File }
];

const colors = ["red", "orange", "amber", "emerald", "cyan", "blue", "violet", "pink"];
const apiType = (type: AttributeType) => type === "number" || type === "date" || type === "select" || type === "relation" ? type : type === "multi_select" ? "select" : "text";

export function ObjectsSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["object-definitions"], queryFn: () => apiClient.get<ObjectDefinition[]>("/settings/objects") });
  const [selectedId, setSelectedId] = useState<string>();
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [objectOpen, setObjectOpen] = useState(false);
  const [attribute, setAttribute] = useState<Attribute>({ name: "", type: "text", required: false, unique: false });
  const [selectOptions, setSelectOptions] = useState(["New option"]);
  const [relationObject, setRelationObject] = useState("");
  const [customObject, setCustomObject] = useState({ singular: "", plural: "", icon: "circle", color: "red", vertical: "sales" });
  const objects = query.data ?? [];
  const selected = objects.find((item) => item.id === selectedId) ?? objects[0];

  useEffect(() => {
    if (!selectedId && objects[0]) setSelectedId(objects[0].id);
  }, [objects, selectedId]);

  const createObject = useMutation({
    mutationFn: () => apiClient.post("/settings/objects", {
      name: customObject.plural || `${customObject.singular}s`,
      slug: (customObject.plural || customObject.singular).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ...customObject
    }),
    onSuccess: () => { setObjectOpen(false); setCustomObject({ singular: "", plural: "", icon: "circle", color: "red", vertical: "sales" }); qc.invalidateQueries({ queryKey: ["object-definitions"] }); }
  });
  const createAttribute = useMutation({
    mutationFn: () => apiClient.post(`/settings/objects/${selected?.id}/attributes`, {
      name: attribute.name,
      type: apiType(attribute.type),
      display_type: attribute.type,
      required: attribute.required,
      unique: attribute.unique,
      options: selectOptions,
      relation_object: relationObject
    }),
    onSuccess: () => { setAttributeOpen(false); setAttribute({ name: "", type: "text", required: false, unique: false }); qc.invalidateQueries({ queryKey: ["object-definitions"] }); }
  });

  return (
    <div>
      <PageHeader title="Objects & attributes" description="Define the record schemas Mondaily agents can read and update." />
      {query.isLoading ? <PageSkeleton rows={8} /> : objects.length === 0 ? <EmptyState icon={Database} title="No object definitions" description="Create your first custom object to begin." action={<button onClick={() => setObjectOpen(true)} className="rounded-md bg-red-600 px-3 py-2 text-sm">Create custom object</button>} /> : (
        <div className="grid min-h-[560px] grid-cols-[220px_1fr] overflow-hidden rounded-lg border border-white/10">
          <aside className="border-r border-white/10 p-3">
            <div className="mb-3 flex items-center justify-between px-2"><span className="text-xs font-medium uppercase text-slate-500">Objects</span><button onClick={() => setObjectOpen(true)} className="text-red-400" aria-label="Create custom object"><Plus size={14} /></button></div>
            <div className="space-y-1">{objects.map((object) => <button key={object.id} onClick={() => setSelectedId(object.id)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${selected?.id === object.id ? "bg-white/10" : "text-slate-400 hover:bg-white/[.04]"}`}><span className={`h-2.5 w-2.5 rounded-full bg-${object.color ?? "slate"}-500`} /><span className="min-w-0 flex-1 truncate">{object.name_plural}</span>{object.is_standard ? <Lock size={11} className="text-slate-600" /> : <ChevronRight size={12} />}</button>)}</div>
            <button onClick={() => setObjectOpen(true)} className="mt-4 flex w-full items-center gap-2 rounded-md border border-dashed border-white/10 px-3 py-2 text-sm text-slate-500"><Plus size={13} /> Custom object</button>
          </aside>

          {selected ? <section className="p-5">
            <div className="mb-6 flex items-start justify-between"><div><div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-md bg-red-500/10 text-red-300"><Database size={16} /></div><div><h2 className="font-medium">{selected.name_plural}</h2><p className="text-xs text-slate-500">{selected.slug} · {selected.vertical ?? "shared"}</p></div>{selected.is_standard ? <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-500">Standard</span> : null}</div></div><button onClick={() => setAttributeOpen(true)} className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm"><Plus size={13} /> Add attribute</button></div>
            {selected.attributes.length ? <div className="overflow-hidden rounded-md border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/[.03] text-xs text-slate-500"><tr><th className="p-3">Attribute name</th><th className="p-3">Type</th><th className="p-3">Required</th><th className="p-3">Unique</th><th className="p-3" /></tr></thead><tbody>{selected.attributes.map((item) => <tr key={item.id || item.name} className="border-t border-white/10"><td className="p-3 font-medium">{item.name}</td><td className="p-3 capitalize text-slate-400">{item.type.replace("_", " ")}</td><td className="p-3 text-slate-500">{item.required ? "Yes" : "No"}</td><td className="p-3 text-slate-500">{item.unique ? "Yes" : "No"}</td><td className="p-3 text-right"><button className="text-slate-600 hover:text-red-400" aria-label={`Delete ${item.name}`}><Trash2 size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Database} title="No attributes" description="Add fields that describe this object." />}
          </section> : null}
        </div>
      )}

      {attributeOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-black/60"><form onSubmit={(event) => { event.preventDefault(); if (attribute.name.trim()) createAttribute.mutate(); }} className="h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#111419] p-6"><div className="mb-6 flex items-center justify-between"><div><h2 className="font-medium">Add attribute</h2><p className="text-xs text-slate-500">Add a field to {selected?.name_plural}.</p></div><button type="button" onClick={() => setAttributeOpen(false)}><X size={17} /></button></div><label className="text-sm">Attribute name<input value={attribute.name} onChange={(event) => setAttribute({ ...attribute, name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label><p className="mb-2 mt-5 text-sm">Type</p><div className="grid grid-cols-2 gap-2">{typeOptions.map(({ type, label, icon: Icon }) => <button type="button" key={type} onClick={() => setAttribute({ ...attribute, type })} className={`flex items-center gap-2 rounded-md border p-3 text-left text-sm ${attribute.type === type ? "border-red-500 bg-red-500/5" : "border-white/10"}`}><Icon size={14} /><span>{label}</span></button>)}</div>{attribute.type === "select" || attribute.type === "multi_select" ? <div className="mt-5"><p className="mb-2 text-sm">Options</p>{selectOptions.map((option, index) => <div key={index} className="mb-2 flex gap-2"><input value={option} onChange={(event) => setSelectOptions(selectOptions.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="h-9 flex-1 rounded-md border border-white/10 bg-transparent px-3 text-sm" /><button type="button" onClick={() => setSelectOptions(selectOptions.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button></div>)}<button type="button" onClick={() => setSelectOptions([...selectOptions, ""])} className="text-xs text-red-400">+ Add option</button></div> : null}{attribute.type === "relation" ? <label className="mt-5 block text-sm">Related object<select value={relationObject} onChange={(event) => setRelationObject(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#111419] px-3"><option value="">Select object</option>{objects.map((object) => <option key={object.id} value={object.slug}>{object.name_plural}</option>)}</select></label> : null}<div className="mt-5 grid grid-cols-2 gap-3"><Toggle label="Required" checked={attribute.required ?? false} change={(checked) => setAttribute({ ...attribute, required: checked })} /><Toggle label="Unique" checked={attribute.unique ?? false} change={(checked) => setAttribute({ ...attribute, unique: checked })} /></div><button disabled={!attribute.name.trim()} className="mt-6 h-10 w-full rounded-md bg-red-600 text-sm disabled:opacity-40">Save attribute</button></form></div> : null}

      {objectOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"><form onSubmit={(event) => { event.preventDefault(); if (customObject.singular.trim()) createObject.mutate(); }} className="w-full max-w-lg rounded-lg border border-white/10 bg-[#111419] p-5"><div className="mb-5 flex items-center justify-between"><h2 className="font-medium">Create custom object</h2><button type="button" onClick={() => setObjectOpen(false)}><X size={16} /></button></div><div className="grid grid-cols-2 gap-3"><Field label="Singular name" value={customObject.singular} onChange={(value) => setCustomObject({ ...customObject, singular: value, plural: customObject.plural || `${value}s` })} placeholder="Investor" /><Field label="Plural name" value={customObject.plural} onChange={(value) => setCustomObject({ ...customObject, plural: value })} placeholder="Investors" /><Field label="Icon" value={customObject.icon} onChange={(value) => setCustomObject({ ...customObject, icon: value })} placeholder="circle" /><label className="text-sm">Vertical<select value={customObject.vertical} onChange={(event) => setCustomObject({ ...customObject, vertical: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#111419] px-3">{["sales", "realestate", "hr", "finance", "investments", "shared"].map((item) => <option key={item}>{item}</option>)}</select></label></div><p className="mb-2 mt-4 text-sm">Color</p><div className="flex gap-2">{colors.map((color) => <button type="button" key={color} onClick={() => setCustomObject({ ...customObject, color })} className={`h-7 w-7 rounded-full bg-${color}-500 ${customObject.color === color ? "ring-2 ring-white ring-offset-2 ring-offset-[#111419]" : ""}`} aria-label={color} />)}</div><button className="mt-6 h-10 w-full rounded-md bg-red-600 text-sm">Create object</button></form></div> : null}
    </div>
  );
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (value: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-md border border-white/10 p-3 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => change(event.target.checked)} /></label>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="text-sm">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 h-10 w-full rounded-md border border-white/10 bg-transparent px-3" /></label>;
}
