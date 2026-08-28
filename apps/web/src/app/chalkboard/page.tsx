"use client";

import { useSearchParams } from "next/navigation";

import { ChalkboardWorkspace } from "../../features/chalkboard/components/chalkboard-workspace";

export default function ChalkboardPage() {
  const searchParams = useSearchParams();
  return <ChalkboardWorkspace
    requestedClassroomId={searchParams.get("id")}
    requestedDraftRunId={searchParams.get("draft")}
  />;
}
