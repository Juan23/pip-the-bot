// Runs `check` at most once per `ms`: calls within that window share its answer. A failed check isn't kept.
export function reuse<T>(check: () => Promise<T>, ms: number) {
  let saved: { at: number; answer: Promise<T> } | null = null;
  const cached = () => {
    if (!saved || Date.now() - saved.at >= ms) {
      const answer: Promise<T> = check().catch((e) => { if (saved?.answer === answer) saved = null; throw e; });
      saved = { at: Date.now(), answer };
    }
    return saved.answer;
  };
  return Object.assign(cached, { reset: () => { saved = null; } });
}
