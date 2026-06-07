import { useState } from "react";
import { X } from "lucide-react";
import type { QueryState } from "./QueryBar";
import { SavedQuery, loadSavedQueries, saveQuery, deleteSavedQuery } from "../lib/savedQueries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Props {
  current: QueryState;
  onLoad: (q: QueryState) => void;
}

export function SavedQueriesBar({ current, onLoad }: Props) {
  const [list, setList] = useState<SavedQuery[]>(() => loadSavedQueries());
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function confirmSave() {
    if (!name.trim()) { setNaming(false); return; }
    setList(saveQuery(name, current));
    setName("");
    setNaming(false);
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
      <span className="text-[11px] font-semibold tracking-wide text-ink-2">SAVED QUERIES</span>
      {list.map((q) => (
        <Badge variant="secondary" key={q.id} className="font-mono font-normal pr-0.5 cursor-pointer" onClick={() => onLoad(q.query)} title="Load query">
          {q.name}
          <button className="opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setList(deleteSavedQuery(q.id)); }} aria-label={`delete ${q.name}`}>
            <X size={11} />
          </button>
        </Badge>
      ))}
      {list.length === 0 && !naming && <span className="text-ink-3">none</span>}
      {naming ? (
        <Input autoFocus className="font-mono h-6 w-36" value={name} placeholder="query name…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") setNaming(false); }}
          onBlur={confirmSave} />
      ) : (
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setNaming(true)}>Save current</Button>
      )}
    </div>
  );
}
