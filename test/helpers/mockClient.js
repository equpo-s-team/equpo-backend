/**
 * Creates a mock pg PoolClient whose query() returns responses in sequence.
 * Each call to query() advances the index by one.
 *
 * When queries run concurrently via Promise.all, Node.js microtask scheduling
 * means all first-round awaits fire before any second-round await. This makes
 * the ordering predictable: fill responses[] in the order the queries appear
 * in the source code, accounting for parallel execution with Promise.all.
 */
export function makeSequentialClient(responses) {
  let i = 0;
  return {
    query: async () => {
      const response = responses[i] ?? { rowCount: 0, rows: [] };
      i++;
      return response;
    },
  };
}
