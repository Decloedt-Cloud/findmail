import { CreatorsTable } from "@/components/creators-table";

export default function CreatorsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Creators</h1>
      <CreatorsTable onlyWithEmail={false} />
    </div>
  );
}
