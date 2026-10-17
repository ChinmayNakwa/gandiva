"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { playSettled, setSoundEnabled, useSoundEnabled } from "@/lib/sound";

export function SoundToggle() {
  const on = useSoundEnabled();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={on}
      onClick={() => {
        setSoundEnabled(!on);
        if (!on) playSettled(); // a sample, so you know what to listen for
      }}
      className="gap-2 font-mono text-xs"
    >
      {on ? <Volume2Icon /> : <VolumeXIcon />}
      payment sounds {on ? "on" : "off"}
    </Button>
  );
}
