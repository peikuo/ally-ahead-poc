import { lazy, Suspense, type ReactNode } from "react";
import { useRoute } from "../../app/router";
import { Loading } from "../../components/Feedback";

const Console = lazy(() => import("./ConsultationConsole"));
export function ConsultationOpsRoute({ children }: { children: ReactNode }) {
  const route = useRoute();
  return route.split("?")[0] === "/ops/consultations" ? (
    <Suspense
      fallback={
        <div className="standalone-status">
          <Loading />
        </div>
      }
    >
      <Console />
    </Suspense>
  ) : (
    children
  );
}
