"use client";

import type {
  CarouselParamsInput,
  ContentChannel,
  PlanItemInputRaw,
} from "@forgecy/content/client";
import { AiProposal, Button, Input, Label } from "@forgecy/ui";
import { LayoutTemplate, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import {
  askPlanAction,
  createCarouselAction,
  planDecisionAction,
  savePlanItemAction,
} from "../actions";
import { carouselPath } from "../_lib/paths";
import { controlClass } from "./action-button";
import { Actions, Checks, Field, FormError, Toggle, formClass, useSave } from "./strategy-forms";

export interface PlanOptions {
  pillars: { id: string; name: string }[];
  rubrics: { id: string; name: string; pillarId: string }[];
  formats: { id: string; label: string; channel: ContentChannel }[];
  /** Approved catalog products; empty when the catalog is off. */
  products: { id: string; name: string }[];
}

const channels: { value: ContentChannel; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
];

// ---- Add / edit an item ----

export function PlanItemForm(props: {
  slug: string;
  clientId: string;
  id?: string;
  rev?: number;
  initial?: PlanItemInputRaw;
  options: PlanOptions;
  label: string;
}) {
  return (
    <Toggle label={props.label} edit={Boolean(props.id)}>
      {(close) => <PlanItemFields {...props} onClose={close} />}
    </Toggle>
  );
}

function PlanItemFields({
  slug,
  clientId,
  id,
  rev,
  initial,
  options,
  onClose,
}: Parameters<typeof PlanItemForm>[0] & { onClose(): void }) {
  const first = options.formats[0];
  const [v, setV] = useState<PlanItemInputRaw>(
    initial ?? {
      day: 1,
      channel: first?.channel ?? "instagram",
      format: (first?.id ?? "ig_4x5") as PlanItemInputRaw["format"],
      pillarId: options.pillars[0]?.id ?? "",
      theme: "",
    },
  );
  const { pending, error, run } = useSave();
  const set = (patch: Partial<PlanItemInputRaw>) => setV((cur) => ({ ...cur, ...patch }));
  const formats = options.formats.filter((f) => f.channel === v.channel);
  const rubrics = options.rubrics.filter((r) => r.pillarId === v.pillarId);
  if (!options.pillars.length)
    return <p className="text-body-sm text-fg-muted">Create a pillar in Strategy first.</p>;
  return (
    <form
      aria-label={id ? "Edit plan item" : "New plan item"}
      className={formClass}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePlanItemAction({ slug, clientId, id, rev, values: v }), onClose);
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Day (1–30)">
          {(fid) => (
            <Input
              id={fid}
              type="number"
              min={1}
              max={30}
              required
              value={v.day}
              onChange={(e) => set({ day: Number.parseInt(e.target.value, 10) || 1 })}
            />
          )}
        </Field>
        <Field label="Channel">
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.channel}
              onChange={(e) => {
                const channel = e.target.value as ContentChannel;
                const f = options.formats.find((x) => x.channel === channel);
                set({ channel, ...(f ? { format: f.id as PlanItemInputRaw["format"] } : {}) });
              }}
            >
              {channels.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Format">
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.format}
              onChange={(e) => set({ format: e.target.value as PlanItemInputRaw["format"] })}
            >
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Pillar">
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.pillarId}
              onChange={(e) => set({ pillarId: e.target.value, rubricId: null })}
            >
              {options.pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Rubric">
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.rubricId ?? ""}
              onChange={(e) => set({ rubricId: e.target.value || null })}
            >
              <option value="">None</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Theme">
          {(fid) => (
            <Input
              id={fid}
              required
              maxLength={120}
              value={v.theme}
              onChange={(e) => set({ theme: e.target.value })}
            />
          )}
        </Field>
        <Field label="Angle / hook">
          {(fid) => (
            <Input
              id={fid}
              maxLength={120}
              value={v.hook ?? ""}
              onChange={(e) => set({ hook: e.target.value })}
            />
          )}
        </Field>
        <div className="md:col-span-2">
          <Field label="Notes">
            {(fid) => (
              <textarea
                id={fid}
                rows={2}
                maxLength={1000}
                className={controlClass}
                value={v.notes ?? ""}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </Field>
        </div>
      </div>
      <Checks
        legend="Linked products"
        options={options.products.map((p) => ({ value: p.id, label: p.name }))}
        value={v.productIds ?? []}
        onChange={(productIds) => set({ productIds })}
      />
      <FormError error={error} />
      <Actions pending={pending} onCancel={onClose} />
    </form>
  );
}

// ---- “Propose plan” ----

export function AskPlanForm({
  slug,
  clientId,
  running,
  disabledReason,
}: {
  slug: string;
  clientId: string;
  running: boolean;
  disabledReason?: string | null;
}) {
  const [instruction, setInstruction] = useState("");
  const [chosen, setChosen] = useState<string[]>(["instagram"]);
  const id = useId();
  const { pending, error, run } = useSave();
  return (
    <form
      aria-label="Propose plan"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            askPlanAction({
              slug,
              clientId,
              instruction: instruction.trim(),
              channels: chosen as ContentChannel[],
            }),
          () => setInstruction(""),
        );
      }}
    >
      <Checks legend="Channels" options={channels} value={chosen} onChange={setChosen} />
      <div className="space-y-1">
        <Label htmlFor={id}>Instruction for the Planner (optional)</Label>
        <textarea
          id={id}
          rows={2}
          maxLength={500}
          className={controlClass}
          placeholder="E.g. launch of the new collection in the second week"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={pending || running || !chosen.length || Boolean(disabledReason)}
      >
        <Sparkles aria-hidden />
        Propose plan
      </Button>
      {disabledReason ? <p className="text-body-sm text-fg-muted">{disabledReason}</p> : null}
      <FormError error={error} />
    </form>
  );
}

// ---- Proposed plan: “Activate plan” / “Discard” ----

export function PlanProposal({
  slug,
  clientId,
  planId,
  title,
  agent,
  sources,
  children,
}: {
  slug: string;
  clientId: string;
  planId: string;
  title: string;
  agent: string;
  sources: { label: string }[];
  children: ReactNode;
}) {
  const { pending, error, run } = useSave();
  const decide = (decision: "activate" | "discard") => {
    const question =
      decision === "activate"
        ? "Activate this plan? The current plan will be replaced; items still pending will be accepted."
        : "Discard the proposed plan?";
    if (!window.confirm(question)) return;
    run(() => planDecisionAction({ slug, clientId, planId, decision }));
  };
  return (
    <AiProposal
      title={title}
      agent={agent}
      sources={sources}
      pending={pending}
      acceptLabel="Activate plan"
      rejectLabel="Discard"
      onAccept={() => decide("activate")}
      onReject={() => decide("discard")}
    >
      <div className="space-y-3">
        {children}
        <FormError error={error} />
      </div>
    </AiProposal>
  );
}

// ---- “Create carousel” from a plan item ----

export function CreateCarouselButton({
  slug,
  clientId,
  params,
  disabledReason,
}: {
  slug: string;
  clientId: string;
  params: CarouselParamsInput | null;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !params}
        title={disabledReason ?? undefined}
        onClick={() =>
          params &&
          start(async () => {
            setError(null);
            const r = await createCarouselAction({ slug, clientId, params, brief: {} });
            if (!r.ok) setError(r.error);
            else router.push(carouselPath(slug, r.id) as never);
          })
        }
      >
        <LayoutTemplate aria-hidden />
        Create carousel
      </Button>
      {disabledReason ? (
        <span className="max-w-xs text-body-sm text-fg-muted">{disabledReason}</span>
      ) : null}
      <FormError error={error} />
    </span>
  );
}
