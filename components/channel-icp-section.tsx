import type { ChannelIcp } from "@/lib/icp/channel-icp";

function Points({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ChannelIcpSection({ profile }: { profile: ChannelIcp | null }) {
  return (
    <section className="space-y-2">
      <p className="text-muted-foreground">Channel ICP</p>
      {profile ? (
        <div className="space-y-2">
          <p className="font-medium">{profile.name}</p>
          <p className="whitespace-pre-wrap">{profile.description}</p>
          <Points label="Interests" items={profile.interests} />
          <Points label="Problems" items={profile.problems} />
          <Points label="Goals" items={profile.goals} />
          <Points label="Use cases" items={profile.useCases} />
          <Points label="Product categories" items={profile.productCategories} />
        </div>
      ) : (
        <p>No channel ICP is stored yet.</p>
      )}
    </section>
  );
}
