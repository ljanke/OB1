import {
  CHAT_API_BASE,
  CHAT_API_KEY,
  CHAT_MODEL,
  ENABLE_METADATA_EXTRACTION,
} from "./config.ts";

const SYSTEM_PROMPT =
  `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`;

const FALLBACK = { topics: ["uncategorized"], type: "observation" } as const;

export async function extractMetadata(
  text: string,
): Promise<Record<string, unknown>> {
  if (!ENABLE_METADATA_EXTRACTION) return { ...FALLBACK };

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CHAT_API_KEY) headers.Authorization = `Bearer ${CHAT_API_KEY}`;

    const r = await fetch(`${CHAT_API_BASE}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: CHAT_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });

    if (!r.ok) return { ...FALLBACK };
    const d = await r.json();
    const content = d?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ...FALLBACK };
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return { ...FALLBACK };
    return parsed as Record<string, unknown>;
  } catch {
    return { ...FALLBACK };
  }
}
