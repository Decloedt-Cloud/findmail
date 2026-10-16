"use client";

import { useState } from "react";

function avatarSrc(url: string) {
  return url.replace(/=s\d+(?=-|$)/, "=s176");
}

export function ChannelAvatar({ url, name, className }: { url: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold ${className}`}>
        {name.slice(0, 1)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarSrc(url)}
      alt=""
      referrerPolicy="no-referrer"
      className={`shrink-0 rounded-full object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
