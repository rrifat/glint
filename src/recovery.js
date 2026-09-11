// Recovery deliberately ignores old offsets and provider message IDs. Those
// describe the source page, and cannot disambiguate passages on another page.
export function recoveryMatch(text, anchor) {
  const quote = anchor?.exact;
  if (!quote) return { status: "missing" };
  let best = null,
    tied = false;
  for (
    let start = text.indexOf(quote);
    start !== -1;
    start = text.indexOf(quote, start + 1)
  ) {
    const end = start + quote.length;
    let context = 0;
    for (
      let i = 1;
      i <= (anchor.prefix || "").length &&
      text[start - i] === anchor.prefix.at(-i);
      i++
    )
      context++;
    for (
      let i = 0;
      i < (anchor.suffix || "").length && text[end + i] === anchor.suffix[i];
      i++
    )
      context++;
    if (!best || context > best.context) {
      best = { start, end, context };
      tied = false;
    } else if (context === best.context) tied = true;
  }
  if (!best) return { status: "missing" };
  if (tied) return { status: "ambiguous" };
  return { status: "matched", start: best.start, end: best.end };
}

export function recoveryCopies(
  source,
  destination,
  target,
  uuid = () => crypto.randomUUID(),
) {
  const rows = [...destination];
  let added = 0,
    skipped = 0;
  for (const row of source) {
    if (
      rows.some(
        (existing) =>
          existing.recovery?.conversation === row.conversation &&
          existing.recovery?.id === row.id,
      )
    ) {
      skipped++;
      continue;
    }
    rows.push({
      ...row,
      id: uuid(),
      conversation: target.conversation,
      provider: target.provider,
      scope: "page",
      messageId: null,
      url: target.url,
      title: target.title,
      originalUrl: row.originalUrl || row.url,
      recovery: { conversation: row.conversation, id: row.id },
    });
    added++;
  }
  return { rows, added, skipped };
}
