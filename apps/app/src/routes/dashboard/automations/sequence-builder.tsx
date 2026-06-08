import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageSkeleton } from "../../../components/ui/page-state";
import { apiClient } from "../../../lib/api-client";

export function SequenceBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (id === "new") {
      apiClient.post<{ id: string }>("/sequences", {
        name: "New Sequence",
        stop_on_reply: true,
        sending_days: ["mon","tue","wed","thu","fri"],
        send_start: "09:00",
        send_end: "17:00",
        daily_limit: 50,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        unsubscribe: true
      }).then((seq) => {
        navigate(`/automations/sequences/${seq.id}`, { replace: true });
      }).catch(() => {
        navigate("/automations", { replace: true });
      });
    }
  }, [id, navigate]);

  if (id === "new") return <PageSkeleton />;

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold mb-4">Sequence Builder</h1>
      <p className="text-muted-foreground">Sequence ID: {id}</p>
      <p className="text-sm text-muted-foreground mt-2">Full sequence builder coming soon.</p>
    </div>
  );
}
