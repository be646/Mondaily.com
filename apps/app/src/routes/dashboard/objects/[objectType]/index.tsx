import { useParams } from "react-router-dom";
import { RecordTable } from "../../../../components/records/record-table";

export function ObjectIndexPage() {
  const { objectType = "records" } = useParams();
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold capitalize">{objectType}</h1>
      <RecordTable objectType={objectType} />
    </div>
  );
}

