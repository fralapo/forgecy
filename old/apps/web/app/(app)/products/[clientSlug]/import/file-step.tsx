"use client";

import { Button, Card, cn } from "@forgecy/ui";
import { FileUp, FolderUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ActionMessage, useCatalogAction } from "../../_components/client";
import { selectClass } from "../../_components/ui";
import { paths } from "../../_lib/paths";
import { optionsAction, removeFileAction, rereadCsvAction, setRouteAction } from "./actions";

export interface FileRowView {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  size: string;
  valid: boolean;
  message: string | null;
  errorCode: string | null;
  route: string;
  routes: Array<{ value: string; label: string }>;
  children: Array<{
    id: string;
    name: string;
    kindLabel: string;
    valid: boolean;
    message: string | null;
  }>;
}

const delimiters = ["comma", "semicolon", "tab", "pipe"] as const;

interface Upload {
  key: string;
  name: string;
  progress: number;
  error?: string;
  done?: boolean;
}

/** Walks dropped folders (webkitGetAsEntry) so a folder of photos and texts keeps its paths. */
async function collect(items: DataTransferItemList): Promise<Array<{ file: File; path: string }>> {
  const out: Array<{ file: File; path: string }> = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      out.push({ file, path: `${prefix}${file.name}` });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, "");
  return out;
}

export function FileStep(props: {
  clientId: string;
  clientSlug: string;
  importId: string;
  files: FileRowView[];
  limitsText: string;
  aiReason: string | null;
  options: { language: string; matchImages: boolean; official: boolean };
}) {
  const router = useRouter();
  const t = useTranslations("products");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const action = useCatalogAction();
  const ids = { clientId: props.clientId, importId: props.importId };

  function send(item: { file: File; path: string }, key: string) {
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", paths.upload(props.clientSlug, props.importId));
      xhr.setRequestHeader("x-file-path", encodeURIComponent(item.path));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          setUploads((u) =>
            u.map((x) =>
              x.key === key ? { ...x, progress: Math.round((e.loaded / e.total) * 100) } : x,
            ),
          );
      };
      xhr.onload = () => {
        let error: string | undefined;
        if (xhr.status >= 400) {
          try {
            const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
            error = body.message
              ? body.error
                ? t("errors.withCode", { message: body.message, code: body.error })
                : body.message
              : t("fileStep.uploadFailed");
          } catch {
            error = xhr.status === 401 ? t("fileStep.sessionExpired") : t("fileStep.uploadFailed");
          }
        }
        setUploads((u) =>
          u.map((x) => (x.key === key ? { ...x, progress: 100, done: !error, error } : x)),
        );
        resolve();
      };
      xhr.onerror = () => {
        setUploads((u) =>
          u.map((x) => (x.key === key ? { ...x, error: t("fileStep.connectionLost") } : x)),
        );
        resolve();
      };
      xhr.send(item.file);
    });
  }

  async function uploadAll(list: Array<{ file: File; path: string }>) {
    if (list.length === 0) return;
    const stamp = Date.now();
    const queued = list.map((item, i) => ({ item, key: `${stamp}-${i}` }));
    setUploads((u) => [
      ...u.filter((x) => !x.done),
      ...queued.map(({ item, key }) => ({ key, name: item.path, progress: 0 })),
    ]);
    // Three at a time: enough to keep the line busy without flooding the server.
    let next = 0;
    const worker = async () => {
      while (next < queued.length) {
        const q = queued[next++]!;
        await send(q.item, q.key);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    router.refresh();
  }

  function saveOptions(form: HTMLFormElement) {
    const fd = new FormData(form);
    action.run(() =>
      optionsAction({
        ...ids,
        options: {
          // Same default as importOptions in @forgecy/catalog (a stored value, kept as is).
          language: String(fd.get("language") || "English"),
          matchImages: fd.get("matchImages") === "on",
          official: fd.get("official") === "yes",
        },
      }),
    );
  }

  const fromInput = (files: FileList | null) =>
    void uploadAll(
      Array.from(files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })),
    );

  return (
    <Card>
      <h2 className="text-heading-sm">{t("fileStep.title")}</h2>
      <div
        role="button"
        tabIndex={0}
        aria-label={t("fileStep.dropLabel")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void collect(e.dataTransfer.items).then(uploadAll);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center focus-visible:outline-2 focus-visible:outline-focus",
          over ? "border-primary bg-app" : "border-control",
        )}
      >
        <p className="text-body-md text-fg">{t("fileStep.dropText")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
            <FileUp aria-hidden />
            {t("fileStep.chooseFiles")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => folderInput.current?.click()}>
            <FolderUp aria-hidden />
            {t("fileStep.chooseFolder")}
          </Button>
        </div>
        <p className="text-body-sm text-fg-muted">{props.limitsText}</p>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => fromInput(e.target.files)}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          // @ts-expect-error webkitdirectory is not in React's input attributes
          webkitdirectory=""
          onChange={(e) => fromInput(e.target.files)}
        />
      </div>
      {props.aiReason ? <p className="text-body-sm text-fg-muted">{props.aiReason}</p> : null}

      {uploads.length ? (
        <ul aria-live="polite" className="space-y-2">
          {uploads.map((u) => (
            <li key={u.key} className="text-body-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate text-fg">{u.name}</span>
                <span className={u.error ? "text-error" : "text-fg-muted"}>
                  {u.error ?? (u.done ? t("fileStep.uploaded") : `${u.progress}%`)}
                </span>
              </div>
              {!u.done && !u.error ? (
                <div
                  role="progressbar"
                  aria-valuenow={u.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t("fileStep.uploading", { name: u.name })}
                  className="mt-1 h-1 w-full rounded-sm bg-subtle"
                >
                  <div
                    className="h-full rounded-sm bg-primary"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ActionMessage result={action.result} />
      {props.files.length ? (
        <ul className="divide-y divide-subtle rounded-md border border-subtle">
          {props.files.map((f) => (
            <li key={f.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-body-md text-fg">{f.name}</p>
                  <p
                    id={`file-${f.id}-status`}
                    className={cn("text-body-sm", f.valid ? "text-fg-muted" : "text-error")}
                  >
                    {f.kindLabel} · {f.size} ·{" "}
                    {f.message ?? (f.valid ? t("files.valid") : t("files.invalid"))}
                    {f.errorCode && !f.valid ? ` (${f.errorCode})` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {f.routes.length ? (
                    <select
                      aria-label={t("fileStep.routeFor", { name: f.name })}
                      aria-describedby={`file-${f.id}-status`}
                      className={selectClass}
                      value={f.route}
                      disabled={action.pending}
                      onChange={(e) =>
                        action.run(() =>
                          setRouteAction({ ...ids, fileId: f.id, route: e.target.value }),
                        )
                      }
                    >
                      {f.routes.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("fileStep.remove", { name: f.name })}
                    disabled={action.pending}
                    onClick={() => action.run(() => removeFileAction({ ...ids, fileId: f.id }))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              {f.errorCode === "IMPORT-CSV-ENCODING" ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    action.run(() =>
                      rereadCsvAction({
                        ...ids,
                        fileId: f.id,
                        encoding: String(fd.get("encoding")),
                        delimiter: String(fd.get("delimiter")),
                      }),
                    );
                  }}
                >
                  <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
                    {t("fileStep.encoding")}
                    <select name="encoding" className={selectClass} defaultValue="windows-1252">
                      <option value="utf-8">{t("fileStep.encodingUtf8")}</option>
                      <option value="windows-1252">{t("fileStep.encodingWindows")}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
                    {t("fileStep.delimiter")}
                    <select name="delimiter" className={selectClass} defaultValue="semicolon">
                      {delimiters.map((d) => (
                        <option key={d} value={d}>
                          {t(`fileStep.delimiters.${d}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" size="sm" variant="secondary" disabled={action.pending}>
                    {t("fileStep.readAgain")}
                  </Button>
                </form>
              ) : null}
              {f.children.length ? (
                <details>
                  <summary className="cursor-pointer text-body-sm text-fg-muted">
                    {t("fileStep.contents", { count: f.children.length })}
                  </summary>
                  <ul className="mt-2 space-y-1 text-body-sm">
                    {f.children.map((c) => (
                      <li key={c.id} className={c.valid ? "text-fg-muted" : "text-error"}>
                        {c.name} · {c.kindLabel}
                        {c.message ? ` · ${c.message}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="space-y-3 border-t border-subtle pt-4"
        onChange={(e) => {
          // Text is saved on blur, choices right away.
          if ((e.target as unknown as HTMLInputElement).type !== "text")
            saveOptions(e.currentTarget);
        }}
        onBlur={(e) => {
          if ((e.target as unknown as HTMLInputElement).name === "language")
            saveOptions(e.currentTarget);
        }}
        onSubmit={(e) => e.preventDefault()}
      >
        <h3 className="text-label font-medium text-fg">{t("fileStep.options")}</h3>
        <label className="flex flex-col gap-1 text-body-sm text-fg-muted">
          {t("fileStep.language")}
          <input
            name="language"
            defaultValue={props.options.language}
            className={cn(selectClass, "w-60")}
            maxLength={40}
          />
        </label>
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            name="matchImages"
            defaultChecked={props.options.matchImages}
            className="size-4"
          />
          {props.aiReason ? t("fileStep.matchImagesNoAi") : t("fileStep.matchImages")}
        </label>
        <fieldset className="text-body-sm text-fg">
          <legend className="mb-1">{t("fileStep.official")}</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input
              type="radio"
              name="official"
              value="yes"
              defaultChecked={props.options.official}
            />{" "}
            {t("fileStep.yes")}
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="official"
              value="no"
              defaultChecked={!props.options.official}
            />{" "}
            {t("fileStep.no")}
          </label>
        </fieldset>
      </form>
    </Card>
  );
}
