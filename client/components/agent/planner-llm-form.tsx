"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearPlannerLlm, savePlannerLlm } from "@/lib/api";
import type { AgentWalletInfo } from "@/lib/types";

const DEFAULT_HOST = "https://ollama.com";

/** The signed-in user's own Ollama key for Scout's planning, so their runs use their quota and not the server's. */
export function PlannerLlmForm({ current, onChanged }: { current: AgentWalletInfo["plannerLlm"]; onChanged: () => void }) {
  const [host, setHost] = useState(current?.host ?? DEFAULT_HOST);
  const [model, setModel] = useState(current?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [working, setWorking] = useState<"save" | "remove" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setWorking("save");
    setNotice(null);
    try {
      const saved = await savePlannerLlm({ host: host.trim() || undefined, model: model.trim() || undefined, apiKey: apiKey.trim() || undefined });
      setApiKey("");
      setModel(saved.model);
      setNotice({ ok: true, text: `Saved. Your runs now plan with ${saved.model}.` });
      onChanged();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setWorking(null);
    }
  }

  async function remove() {
    setWorking("remove");
    setNotice(null);
    try {
      await clearPlannerLlm();
      setApiKey("");
      setHost(DEFAULT_HOST);
      setModel("");
      setNotice({ ok: true, text: "Removed. Your runs plan on the server's key again." });
      onChanged();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Could not remove." });
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-medium">Your Ollama key for planning</h3>
        <p className="text-xs text-muted-foreground">
          {current
            ? `Your runs plan with ${current.model} using your own key.`
            : "Optional. Without it, your runs plan on the server's key. Add your own so they use your Ollama quota instead."}{" "}
          The key is encrypted on the server and never shown again. It is only used to plan your tasks; the sellers you hire use their own.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-key" className="text-xs text-muted-foreground">
            API key (ollama.com/settings/keys)
          </Label>
          <Input id="llm-key" type="password" autoComplete="off" className="font-mono" placeholder={current?.hasKey ? "saved - leave empty to keep" : "paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-model" className="text-xs text-muted-foreground">
            Model
          </Label>
          <Input id="llm-model" className="font-mono" placeholder="server default" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-host" className="text-xs text-muted-foreground">
            Host
          </Label>
          <Input id="llm-host" className="font-mono" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={working !== null || (!apiKey.trim() && !current)}>
          {working === "save" ? "Checking your key…" : current ? "Update" : "Save key"}
        </Button>
        {current ? (
          <Button size="sm" variant="outline" onClick={remove} disabled={working !== null}>
            {working === "remove" ? "Removing…" : "Remove"}
          </Button>
        ) : null}
      </div>
      {notice ? <p className={"rounded-lg border px-3 py-2 text-sm " + (notice.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad")}>{notice.text}</p> : null}
    </div>
  );
}
