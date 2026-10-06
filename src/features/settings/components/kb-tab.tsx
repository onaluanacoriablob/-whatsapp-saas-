"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  BookOpen,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceType = "doc" | "faq" | "url" | "snippet";

interface KbDocument {
  id: string;
  title: string;
  source_type: string;
  content: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  doc: "Documento",
  faq: "FAQ",
  url: "URL",
  snippet: "Snippet",
};

const SOURCE_TYPE_COLORS: Record<SourceType, string> = {
  doc: "text-blue-400 border-blue-400/30",
  faq: "text-amber-400 border-amber-400/30",
  url: "text-purple-400 border-purple-400/30",
  snippet: "text-green-400 border-green-400/30",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Document row ──────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: KbDocument;
  onDelete: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sourceType = (doc.source_type as SourceType) ?? "doc";
  const colorClass = SOURCE_TYPE_COLORS[sourceType] ?? SOURCE_TYPE_COLORS.doc;
  const label = SOURCE_TYPE_LABELS[sourceType] ?? doc.source_type;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(doc.id);
    } finally {
      setDeleting(false);
    }
  }

  const chunkCount =
    typeof doc.meta?.chunk_count === "number" ? doc.meta.chunk_count : null;

  return (
    <li className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex flex-1 items-center gap-3 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Ocultar" : "Ver"} chunks de ${doc.title}`}
        >
          {expanded ? (
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}

          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-foreground truncate">
              {doc.title}
            </span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {formatDate(doc.created_at)}
              {chunkCount !== null && ` · ${chunkCount} chunks`}
            </span>
          </span>

          <Badge
            variant="outline"
            className={`text-xs font-normal shrink-0 ${colorClass}`}
          >
            {label}
          </Badge>
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          aria-label={`Eliminar documento ${doc.title}`}
          aria-busy={deleting}
          className="ml-2 shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 p-4">
          {doc.content ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
              {doc.content}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Este documento no tiene contenido de texto.
            </p>
          )}
          {chunkCount !== null && (
            <p className="mt-3 text-xs text-muted-foreground/70">
              {chunkCount} chunk(s) indexados para búsqueda semántica.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
}

export function KbTab({ workspaceId }: Props) {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("doc");
  const [content, setContent] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/kb`);
      const json = (await res.json()) as {
        data?: KbDocument[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Error al cargar documentos");
      setDocuments(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: load resets loading/error before each (re)fetch
    load();
  }, [load]);

  async function handleAdd() {
    if (!title.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    const body =
      sourceType === "url"
        ? { title: title.trim(), content: urlInput.trim(), sourceType }
        : { title: title.trim(), content: content.trim(), sourceType };

    if (!body.content) {
      toast.error(
        sourceType === "url"
          ? "Ingresa una URL"
          : "El contenido es obligatorio",
      );
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/kb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        data?: { documentId: string; chunksCreated: number };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Error al agregar documento");

      toast.success(
        `Documento agregado — ${json.data?.chunksCreated ?? 0} chunks generados`,
      );

      // Reset form
      setTitle("");
      setContent("");
      setUrlInput("");
      setSourceType("doc");

      // Reload list
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al agregar");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/kb`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al eliminar");
      toast.success("Documento eliminado");
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-36" />
        </div>
        <Separator />
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">
            No pudimos cargar los documentos
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Reintentar
        </Button>
      </div>
    );
  }

  // ── Data ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Section 1 — Upload form */}
      <div className="space-y-4">
        <div>
          <h3 className="font-display text-sm font-medium text-foreground">
            Agregar documento
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            El contenido se divide en chunks y se embebe para búsqueda
            semántica.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="kb-title">Título</Label>
          <Input
            id="kb-title"
            value={title}
            placeholder="Preguntas frecuentes de precios"
            onChange={(e) => setTitle(e.target.value)}
            aria-required="true"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="kb-source-type">Tipo de fuente</Label>
          <select
            id="kb-source-type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {(Object.keys(SOURCE_TYPE_LABELS) as SourceType[]).map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {sourceType === "url" ? (
          <div className="space-y-1.5">
            <Label htmlFor="kb-url">URL</Label>
            <Input
              id="kb-url"
              type="url"
              value={urlInput}
              placeholder="https://ejemplo.com/articulo"
              onChange={(e) => setUrlInput(e.target.value)}
              aria-required="true"
            />
            <p className="text-xs text-muted-foreground">
              Descargamos la página y extraemos su texto automáticamente para
              indexarlo. Funciona mejor con páginas públicas de contenido.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="kb-content">
              Contenido{" "}
              <span className="text-muted-foreground font-normal">
                (máx. 10,000 caracteres)
              </span>
            </Label>
            <Textarea
              id="kb-content"
              value={content}
              placeholder="Pega el texto del documento aquí…"
              onChange={(e) => setContent(e.target.value)}
              maxLength={10_000}
              rows={6}
              className="resize-none font-mono text-xs"
              aria-required="true"
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {content.length.toLocaleString("es-MX")} / 10,000
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={isAdding}
            aria-busy={isAdding}
          >
            {isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
                Procesando…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1.5" aria-hidden />
                Agregar documento
              </>
            )}
          </Button>
          {isAdding && (
            <p className="text-xs text-muted-foreground">
              Dividiendo en chunks y generando embeddings…
            </p>
          )}
        </div>
      </div>

      <Separator />

      {/* Section 2 — Document list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-medium text-foreground">
            Documentos
            {documents.length > 0 && (
              <span className="ml-2 font-mono text-xs text-muted-foreground font-normal">
                ({documents.length})
              </span>
            )}
          </h3>
        </div>

        {documents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-12 text-center">
            <BookOpen
              className="h-9 w-9 text-muted-foreground/50"
              aria-hidden
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                Sin documentos
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                La IA usará este knowledge base para responder preguntas. Agrega
                el primer documento arriba.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {documents.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} onDelete={handleDelete} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
