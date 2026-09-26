export type BehaviorRow = {
  when: string;
  locale: string;
  device: string;
  country: string;
  timezone: string;
  durationSec: number;
  scroll: number;
  viewport: string;
  referrer: string;
  campaign: string;
  sections: string;
  clicks: string;
};

export type BehaviorReport = {
  configured: boolean;
  rows: BehaviorRow[];
  sessions: number;
  devices: Array<{ name: string; count: number }>;
  countries: Array<{ name: string; count: number }>;
  meanDuration: number;
  meanScroll: number;
  topClicks: Array<{ name: string; count: number }>;
};
