"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAgent, testAgent } from "@/lib/api";
import { toUnits, usdc } from "@/lib/format";
import type { AgentInfo, Service } from "@/lib/types";
import { ListingPreview, priceProblem, usePublicBase } from "./listing-preview";
import { Wizard, type WizardStep } from "./wizard";

const FIELD =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const DEFAULT_HOST = "https://ollama.com";

/** Same rule as the server's listing ids (src/registry/store.ts slug). */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);

interface FormState {
  name: string;
  description: string;
  priceUsdc: string;
  host: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

const STARTER: FormState = {
  name: "",
  description: "",
  priceUsdc: "0.003",
  host: DEFAULT_HOST,
  apiKey: "",
  model: "gpt-oss:20b",
  systemPrompt: "",
};

export function LlmAgentForm({
  wallet,
  editing,
  info,
  onSaved,
  onCancel,
}: {
  wallet: string;
  editing: Service | null;
  info?: AgentInfo;
  onSaved: (s: Service) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    editing && info
      ? { name: editing.name, description: editing.description, priceUsdc: usdc(editing.price), host: info.host, apiKey: "", model: info.model, systemPrompt: info.systemPrompt }
      : STARTER,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState("The sea at night.");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const keySaved = Boolean(editing && info?.hasKey);
  const publicBase = usePublicBase();

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const out = await testAgent({
        ...(editing ? { id: editing.id } : {}),
        host: form.host.trim(),
        model: form.model.trim(),
        systemPrompt: form.systemPrompt,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        text: sample,
      });
      setTestResult({ ok: true, text: `${out.answer}\n\n(${out.model}, ${(out.ms / 1000).toFixed(1)} s, nothing was paid)` });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  /** True when a new agent was saved, so the wizard starts over. */
  async function submit(): Promise<boolean> {
    setError(null);
    const price = toUnits(form.priceUsdc);
    if (!price || Number(price) === 0) {
      setError("Price must be a number like 0.003 (USDC, up to 6 decimals).");
      return false;
    }
    if (Number(price) > 100_000) {
      setError("Price can be at most 0.10 USDC per call.");
      return false;
    }
    setSaving(true);
    try {
      const saved = await saveAgent({
        ...(editing ? { id: editing.id } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        price,
        host: form.host.trim(),
        model: form.model.trim(),
        systemPrompt: form.systemPrompt,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      });
      onSaved(saved);
      if (!editing) setForm(STARTER);
      else set({ apiKey: "" });
      return !editing;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the agent.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const steps: WizardStep[] = [
    {
      title: "Basics",
      hint: "No server needed: we host the paid endpoint for you.",
      problem: !form.name.trim()
        ? "Give your agent a name."
        : !form.description.trim()
          ? "Say what it is good for; buyer agents read this to decide whether to hire you."
          : priceProblem(form.priceUsdc),
      content: (
        <>
          <p className="text-sm text-muted-foreground">
            A buyer sends <span className="font-mono text-foreground">{`{"text": "..."}`}</span>, pays your wallet, and we ask your model (with your key and your system prompt) and return{" "}
            <span className="font-mono text-foreground">{`{"answer": "...", "model": "..."}`}</span>. If the model fails, the buyer is not charged.
          </p>
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input id="a-name" className="font-mono" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="pirate-poet" disabled={Boolean(editing)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-price" className="text-xs text-muted-foreground">
                Price (USDC / call)
              </Label>
              <Input id="a-price" inputMode="decimal" className="font-mono" value={form.priceUsdc} onChange={(e) => set({ priceUsdc: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-desc" className="text-xs text-muted-foreground">
              What is it good for? (buyer agents read this to decide whether to hire you)
            </Label>
            <Input id="a-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Rewrites any text as a short pirate poem." maxLength={400} />
          </div>
        </>
      ),
    },
    {
      title: "Model",
      hint: "Which Ollama model answers, and how it should behave.",
      problem: !form.host.trim()
        ? "Add the Ollama host."
        : !form.model.trim()
          ? "Name the model to use."
          : !form.systemPrompt.trim()
            ? "Write a system prompt."
            : null,
      content: (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-host" className="text-xs text-muted-foreground">
                Ollama host (public https)
              </Label>
              <Input id="a-host" className="font-mono" value={form.host} onChange={(e) => set({ host: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-key" className="text-xs text-muted-foreground">
                Ollama API key
              </Label>
              <Input
                id="a-key"
                type="password"
                autoComplete="off"
                className="font-mono"
                value={form.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                placeholder={keySaved ? "saved, leave blank to keep" : "from ollama.com/settings/keys"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-model" className="text-xs text-muted-foreground">
                Model
              </Label>
              <Input id="a-model" className="font-mono" value={form.model} onChange={(e) => set({ model: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-prompt" className="text-xs text-muted-foreground">
              System prompt
            </Label>
            <textarea
              id="a-prompt"
              rows={5}
              className={FIELD + " resize-y"}
              value={form.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder="You are a pirate poet. Answer in two rhyming lines."
              maxLength={4000}
            />
          </div>
        </>
      ),
    },
    {
      title: "Try & list",
      hint: "Ask it something for free before buyers can pay for it.",
      problem: null,
      content: (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
          <Label htmlFor="a-sample" className="text-xs text-muted-foreground">
            Try it (free, only you can do this, up to 20 per hour)
          </Label>
          <div className="flex gap-2">
            <Input
              id="a-sample"
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              onKeyDown={(e) => {
                // Enter here runs the free test, not the paid listing.
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!testing && form.systemPrompt.trim() && sample.trim()) void test();
              }}
              maxLength={4000}
            />
            <Button type="button" variant="outline" onClick={test} disabled={testing || !form.systemPrompt.trim() || !sample.trim()}>
              {testing ? "Asking…" : "Test it"}
            </Button>
          </div>
          <div aria-live="polite">
            {testResult ? (
              <pre className={"whitespace-pre-wrap rounded-md px-3 py-2 text-xs " + (testResult.ok ? "bg-muted" : "border border-bad/40 bg-bad/10 text-bad")}>{testResult.text}</pre>
            ) : null}
          </div>
        </div>
      ),
    },
  ];

  const id = editing?.id ?? (slug(form.name) || "your-agent");

  return (
    <Wizard
      steps={steps}
      submitting={saving}
      error={error}
      submitLabel={editing ? "Save changes" : "List my agent"}
      submittingLabel="Saving…"
      onSubmit={submit}
      onCancel={editing ? onCancel : undefined}
      preview={
        <ListingPreview
          draft={{
            name: form.name,
            category: "inference",
            description: form.description,
            priceUsdc: form.priceUsdc,
            endpoint: `${publicBase}/sellers/u/${id}/ask`,
            method: "POST",
            wallet,
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
            outputSchema: { type: "object", properties: { answer: { type: "string" }, model: { type: "string" } } },
          }}
        />
      }
    />
  );
}
