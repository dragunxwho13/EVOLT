import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { RecommendationFinder } from "@/components/recommendations/recommendation-finder";
import { ErrorState, PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { getDb } from "@/lib/db/client";
import { chargers, stations } from "@/lib/db/schema";
import { load } from "@/lib/http/load";

export const metadata: Metadata = { title: "Find alternatives" };

export default function RecommendationsPage() {
  return (
    <>
      <PageHeader
        title="Find a healthier alternative"
        description="Compatible chargers nearby, ranked so that credible health concerns always outweigh a small distance advantage."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <FinderLoader />
      </Suspense>
    </>
  );
}

async function FinderLoader() {
  await connection();
  const result = await load(async () => {
    const refs = await getDb()
      .select({ id: chargers.id, code: chargers.code, stationName: stations.name, healthStatus: chargers.healthStatus })
      .from(chargers)
      .innerJoin(stations, eq(stations.id, chargers.stationId))
      .where(eq(chargers.isSynthetic, false))
      .orderBy(asc(chargers.code));
    return { refs };
  });
  if (!result.ok) return <ErrorState {...result.error} />;
  return <RecommendationFinder references={result.data.refs} />;
}
