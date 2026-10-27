import type { Metadata } from "next";
import { HowItWorksContent } from "@/components/how-it-works/how-it-works-content";

export const metadata: Metadata = {
  title: "How it works",
  description: "How EVOLT turns charging data and Arduino bench readings into evidence-backed recommendations — architecture, data flow, models, scaling, workflows and limits.",
};

export default function HowItWorksPage() {
  return <HowItWorksContent />;
}
