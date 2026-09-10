"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Row = { id: number; name: string; kind: "BONUS" | "DEDUCTION"; amount: string; isProrated: boolean };

export function SalaryComponentsEditor({ initial = [] }: { initial?: Omit<Row, "id">[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map((r, i) => ({ ...r, id: i })));
  const [next, setNext] = useState(initial.length);
  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Recurring components</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setRows((rs) => [...rs, { id: next, name: "", kind: "BONUS", amount: "", isProrated: false }]); setNext(next + 1); }}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {rows.length === 0 && <p className="text-xs text-slate-500">Allowances (earnings) or recurring deductions such as provident fund. Optional.</p>}
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2">
          <Input name="componentName[]" placeholder="Medical allowance" value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} aria-label="Component name" />
          <Select name="componentKind[]" value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value as Row["kind"] })} className="w-32" aria-label="Kind"><option value="BONUS">Earning</option><option value="DEDUCTION">Deduction</option></Select>
          <Input name="componentAmount[]" placeholder="5000" inputMode="decimal" value={r.amount} onChange={(e) => update(r.id, { amount: e.target.value })} className="w-28" aria-label="Amount" />
          <label className="flex items-center gap-1 text-xs text-slate-600" title="Reduce proportionally with unpaid days">
            <input type="checkbox" checked={r.isProrated} onChange={(e) => update(r.id, { isProrated: e.target.checked })} className="h-4 w-4 rounded border-slate-300" /> pro-rate
            <input type="hidden" name="componentProrated[]" value={r.isProrated ? "1" : "0"} />
          </label>
          <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
