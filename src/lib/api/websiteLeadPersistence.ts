type WebsiteLeadExternalWrites = Record<string, unknown>;

/**
 * Enforces the website lead durability boundary:
 * 1. store the pseudonymous lead,
 * 2. store its validation event,
 * 3. perform CRM/Meta writes,
 * 4. merge the external-write result back into the same lead row.
 *
 * Boolean storage APIs fail closed here so the caller cannot report a
 * successful signup while silently dropping the dashboard's source of truth.
 */
export async function persistNewWebsiteLeadDurably<
  TExternal extends WebsiteLeadExternalWrites,
>(args: {
  writePreliminary: () => Promise<boolean>;
  writeValidation: () => Promise<boolean>;
  writeNotionAndMeta: () => Promise<TExternal>;
  writeFinal: (external: TExternal) => Promise<boolean>;
}): Promise<TExternal> {
  if (!(await args.writePreliminary())) {
    throw new Error("Website lead outcome storage is unavailable");
  }
  if (!(await args.writeValidation())) {
    throw new Error("Website lead validation event storage is unavailable");
  }

  const external = await args.writeNotionAndMeta();
  if (!(await args.writeFinal(external))) {
    throw new Error("Website lead final outcome storage is unavailable");
  }
  return external;
}

export async function persistDuplicateWebsiteLeadDurably(args: {
  writeOutcome: () => Promise<boolean>;
}): Promise<void> {
  if (!(await args.writeOutcome())) {
    throw new Error("Website duplicate lead outcome storage is unavailable");
  }
}
