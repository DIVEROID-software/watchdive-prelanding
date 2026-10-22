/** One bounded client lookup per page session; SSR always reads current state. */
export function createProgramStateReader(
  load: () => Promise<{ enabled: boolean }>,
  timeoutMs = 1500,
): (server: boolean) => Promise<{ enabled: boolean }> {
  let client: Promise<{ enabled: boolean }> | undefined;
  return (server) => {
    if (server) return load();
    client ??= new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ enabled: false }), timeoutMs);
      Promise.resolve().then(load).then(
        (state) => {
          clearTimeout(timer);
          resolve({ enabled: state.enabled === true });
        },
        () => {
          clearTimeout(timer);
          resolve({ enabled: false });
        },
      );
    });
    return client;
  };
}
