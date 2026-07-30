const META_LEAD_RESERVE_RPC = "reserve_meta_lead_ingestion_v1";
const META_LEAD_COMPLETE_RPC = "complete_meta_lead_ingestion_v1";
const META_LEAD_FAIL_RPC = "fail_meta_lead_ingestion_v1";
const SUPABASE_RPC_TIMEOUT_MS = 5_000;

export type MetaLeadIngestionEnvironment = "production" | "preview" | "development";
export type MetaLeadIngestionOutcome = "new" | "duplicate" | "suspect" | "invalid";

export type MetaLeadIngestionReservation =
  | {
      state: "reserved";
      generation: number;
    }
  | {
      state: "in_progress";
      generation: number;
    }
  | {
      state: "complete";
      generation: number;
      outcome: MetaLeadIngestionOutcome;
      notionPageId?: string;
    };

type MetaLeadIngestionScope = {
  environment: MetaLeadIngestionEnvironment;
  platformLeadId: string;
};

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function supabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("Meta lead ingestion coordination is not configured");
  }
  return { url, serviceRoleKey };
}

function validateScope(scope: MetaLeadIngestionScope): void {
  if (!["production", "preview", "development"].includes(scope.environment)) {
    throw new Error("Invalid Meta lead ingestion environment");
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(scope.platformLeadId)) {
    throw new Error("Invalid Meta platform lead id");
  }
}

async function callRpc(
  rpc: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const config = supabaseConfig();
  const response = await fetchImpl(`${config.url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUPABASE_RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    // RPC responses are intentionally ignored because infrastructure errors can
    // include request details. Submitted Meta form fields never enter this RPC.
    throw new Error(`Meta lead ingestion coordination failed (${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Meta lead ingestion coordination returned invalid JSON");
  }
}

function positiveGeneration(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function notionPageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9-]{1,128}$/.test(normalized) ? normalized : undefined;
}

function ingestionOutcome(value: unknown): MetaLeadIngestionOutcome | null {
  return value === "new" || value === "duplicate" || value === "suspect" || value === "invalid"
    ? value
    : null;
}

export async function reserveMetaLeadIngestion(
  scope: MetaLeadIngestionScope,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaLeadIngestionReservation> {
  validateScope(scope);
  const response = await callRpc(
    META_LEAD_RESERVE_RPC,
    {
      p_environment: scope.environment,
      p_platform_lead_id: scope.platformLeadId,
    },
    fetchImpl,
  );
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Meta lead ingestion reservation returned an invalid response");
  }

  const record = response as Record<string, unknown>;
  const generation = positiveGeneration(record.generation);
  if (!generation) {
    throw new Error("Meta lead ingestion reservation returned an invalid generation");
  }
  if (record.state === "reserved") return { state: "reserved", generation };
  if (record.state === "in_progress") return { state: "in_progress", generation };
  if (record.state === "complete") {
    const outcome = ingestionOutcome(record.outcome);
    if (!outcome) {
      throw new Error("Meta lead ingestion reservation returned an invalid outcome");
    }
    const storedPageId = notionPageId(record.notion_page_id);
    if (
      (outcome === "invalid" && record.notion_page_id != null) ||
      (outcome !== "invalid" && !storedPageId)
    ) {
      throw new Error("Meta lead ingestion reservation returned an invalid CRM reference");
    }
    return {
      state: "complete",
      generation,
      outcome,
      ...(storedPageId ? { notionPageId: storedPageId } : {}),
    };
  }
  throw new Error("Meta lead ingestion reservation returned an invalid state");
}

export async function completeMetaLeadIngestion(
  args: MetaLeadIngestionScope & {
    generation: number;
    outcome: MetaLeadIngestionOutcome;
    notionPageId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  validateScope(args);
  if (!positiveGeneration(args.generation) || !ingestionOutcome(args.outcome)) {
    throw new Error("Invalid Meta lead ingestion completion");
  }
  const normalizedPageId = notionPageId(args.notionPageId);
  if (
    (args.outcome === "invalid" && args.notionPageId != null) ||
    (args.outcome !== "invalid" && !normalizedPageId)
  ) {
    throw new Error("Invalid Meta lead ingestion CRM reference");
  }
  const response = await callRpc(
    META_LEAD_COMPLETE_RPC,
    {
      p_environment: args.environment,
      p_platform_lead_id: args.platformLeadId,
      p_generation: args.generation,
      p_outcome: args.outcome,
      p_notion_page_id: normalizedPageId ?? null,
    },
    fetchImpl,
  );
  if (response !== true && response !== false) {
    throw new Error("Meta lead ingestion completion returned an invalid response");
  }
  return response;
}

export async function failMetaLeadIngestion(
  args: MetaLeadIngestionScope & { generation: number },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  validateScope(args);
  if (!positiveGeneration(args.generation)) {
    throw new Error("Invalid Meta lead ingestion generation");
  }
  const response = await callRpc(
    META_LEAD_FAIL_RPC,
    {
      p_environment: args.environment,
      p_platform_lead_id: args.platformLeadId,
      p_generation: args.generation,
    },
    fetchImpl,
  );
  if (response !== true && response !== false) {
    throw new Error("Meta lead ingestion failure release returned an invalid response");
  }
  return response;
}
