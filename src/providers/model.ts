import type { ProseModel } from "../types.js";

const MOCK: ProseModel = {
  name: "mock",
  polish: ({ draft }) => Promise.resolve(draft),
};

/**
 * Live models may restyle prose only. Callers pass the approved times and
 * case ids as facts and ask the model not to invent new ones. If the call
 * fails, the deterministic draft stands.
 */
function openAIModel(): ProseModel {
  return {
    name: "openai",
    async polish({ kind, draft, facts }) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return draft;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "You edit prose for a client-support analyst. Keep every time, name, case id, and commitment exactly as written. Do not add facts. Return only the edited text.",
              },
              {
                role: "user",
                content: `Kind: ${kind}\nFacts you must not contradict:\n${facts.join("\n")}\n\nDraft:\n${draft}`,
              },
            ],
          }),
        });
        if (!response.ok) return draft;
        const payload: unknown = await response.json();
        const text = readContent(payload);
        return text || draft;
      } catch {
        return draft;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function readContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = "choices" in payload ? payload.choices : undefined;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = "message" in choices[0] ? choices[0].message : undefined;
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  return typeof message.content === "string" ? message.content.trim() : "";
}

export function resolveModel(live: boolean): ProseModel {
  if (!live) return MOCK;
  if ((process.env.QUORUM_PROVIDER ?? "mock") !== "openai") return MOCK;
  if (!process.env.OPENAI_API_KEY) return MOCK;
  return openAIModel();
}
