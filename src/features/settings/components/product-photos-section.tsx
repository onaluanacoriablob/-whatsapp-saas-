"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Images, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

interface ProductImageGroup {
  id: string;
  label: string;
  image_urls: string[];
  created_at: string;
}

interface Props {
  workspaceId: string;
}

function PhotoGroup({
  group,
  onDeletePhoto,
  onDeleteGroup,
}: {
  group: ProductImageGroup;
  onDeletePhoto: (id: string, imageUrl: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
}) {
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  async function handleDeletePhoto(url: string) {
    setDeletingUrl(url);
    try {
      await onDeletePhoto(group.id, url);
    } finally {
      setDeletingUrl(null);
    }
  }

  async function handleDeleteGroup() {
    setDeletingGroup(true);
    try {
      await onDeleteGroup(group.id);
    } finally {
      setDeletingGroup(false);
    }
  }

  return (
    <li className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{group.label}</span>
        <button
          type="button"
          onClick={handleDeleteGroup}
          disabled={deletingGroup}
          aria-label={`Eliminar todas las fotos de ${group.label}`}
          aria-busy={deletingGroup}
          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {deletingGroup ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {group.image_urls.map((url) => (
          <div key={url} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border/60">
            {/* eslint-disable-next-line @next/next/no-img-element -- external storage URL, no next/image domain config needed for a settings thumbnail */}
            <img src={url} alt={`Foto de ${group.label}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => handleDeletePhoto(url)}
              disabled={deletingUrl === url}
              aria-label="Eliminar foto"
              aria-busy={deletingUrl === url}
              className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              {deletingUrl === url ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3 w-3" aria-hidden />
              )}
            </button>
          </div>
        ))}
      </div>
    </li>
  );
}

export function ProductPhotosSection({ workspaceId }: Props) {
  const [groups, setGroups] = useState<ProductImageGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/product-images`);
      const json = (await res.json()) as { data?: ProductImageGroup[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al cargar fotos");
      setGroups(json.data ?? []);
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

  async function handleUpload() {
    if (!label.trim()) {
      toast.error("El nombre del color es obligatorio");
      return;
    }
    if (files.length === 0) {
      toast.error("Elegí al menos una foto");
      return;
    }
    if (files.length > 4) {
      toast.error("Máximo 4 fotos por carga");
      return;
    }

    setIsUploading(true);
    try {
      const body = new FormData();
      body.set("label", label.trim());
      for (const f of files) body.append("files", f);

      const res = await fetch(`/api/workspace/${workspaceId}/product-images`, {
        method: "POST",
        body,
      });
      const json = (await res.json()) as { data?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al subir las fotos");

      toast.success("Fotos agregadas");
      setLabel("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeletePhoto(id: string, imageUrl: string) {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/product-images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, imageUrl }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al eliminar");
      toast.success("Foto eliminada");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  async function handleDeleteGroup(id: string) {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/product-images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al eliminar");
      toast.success("Color eliminado");
      setGroups((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">No pudimos cargar las fotos</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-sm font-medium text-foreground">
          Fotos de producto
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cargá fotos reales por color o variante. La IA puede enviarlas por
          WhatsApp cuando el cliente pide ver un color (tool{" "}
          <code className="font-mono">send_photo</code>).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="pp-label">Nombre del color</Label>
          <Input
            id="pp-label"
            value={label}
            placeholder="Marfil"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pp-files">Fotos (hasta 4)</Label>
          <input
            id="pp-files"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm file:mr-2 file:text-xs"
          />
        </div>
      </div>

      <Button type="button" size="sm" onClick={handleUpload} disabled={isUploading} aria-busy={isUploading}>
        {isUploading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            Subiendo…
          </>
        ) : (
          <>
            <Plus className="h-4 w-4 mr-1.5" aria-hidden />
            Agregar fotos
          </>
        )}
      </Button>

      <Separator />

      <div className="space-y-4">
        <h4 className="font-display text-sm font-medium text-foreground">
          Colores cargados
          {groups.length > 0 && (
            <span className="ml-2 font-mono text-xs text-muted-foreground font-normal">
              ({groups.length})
            </span>
          )}
        </h4>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 py-12 text-center">
            <Images className="h-9 w-9 text-muted-foreground/50" aria-hidden />
            <div>
              <p className="text-sm font-medium text-foreground">Sin fotos</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                Agregá la primera foto arriba para que la IA pueda enviarla por
                WhatsApp.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {groups.map((g) => (
              <PhotoGroup
                key={g.id}
                group={g}
                onDeletePhoto={handleDeletePhoto}
                onDeleteGroup={handleDeleteGroup}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
