import type { Metadata } from "next";
import { loadStudio } from "@/lib/store";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const title = loadStudio(id)?.title?.trim();
  return { title: title ? (title.length > 60 ? `${title.slice(0, 57)}…` : title) : "Studio" };
}

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
