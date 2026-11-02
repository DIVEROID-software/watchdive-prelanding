export function startSitePresence(options: {
  site: "diveroid" | "watchdive";
  allowed?: () => boolean;
  endpoint?: string;
  env?: Window;
}): () => void;
