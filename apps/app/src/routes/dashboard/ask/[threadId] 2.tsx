import { useParams } from "react-router-dom";
import { AskMondaily } from "../../../components/ai/ask-mondaily";

export function AskPage() {
  const { threadId } = useParams();
  return <AskMondaily key={threadId ?? "new"} />;
}
