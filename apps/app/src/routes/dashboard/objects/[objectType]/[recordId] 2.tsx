import { useParams } from "react-router-dom";
import { RecordDetail } from "../../../../components/records/record-detail";

export function RecordDetailPage() {
  const { recordId = "", objectType = "" } = useParams();
  return <RecordDetail recordId={recordId} objectType={objectType} />;
}
