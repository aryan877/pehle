import { ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";

import { cx, errorMessage, useToast } from "~/components/ui";
import { uploadPhoto } from "~/lib/api";
import { mediaUrl } from "~/lib/format";

import { move } from "./queries";

export interface Photo {
  key: string;
  /** Stored path once uploaded. */
  path: string | null;
  /** What to show: an object URL while uploading, then the stored file. */
  src: string;
}

export const MAX_PHOTOS = 9;

export function photosFrom(paths: (string | null | undefined)[]): Photo[] {
  return paths.filter((p): p is string => Boolean(p)).map((path) => ({ key: path, path, src: mediaUrl(path)! }));
}

export function photoPaths(photos: Photo[]): { imagePath: string | null; galleryPaths: string[] } {
  const paths = photos.map((p) => p.path).filter((p): p is string => Boolean(p));
  return { imagePath: paths[0] ?? null, galleryPaths: paths.slice(1, MAX_PHOTOS) };
}

/** Marketplace's photo box: add up to nine, drag or use the arrows to reorder, the first is the cover. */
export function PhotoGrid({ photos, setPhotos }: { photos: Photo[]; setPhotos: Dispatch<SetStateAction<Photo[]>> }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [dragging, setDragging] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const left = MAX_PHOTOS - photos.length;

  const add = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    if (list.length > left) toast(`Only ${MAX_PHOTOS} photos per item. Added the first ${left}.`, "info");
    for (const file of list.slice(0, left)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const src = URL.createObjectURL(file);
      setPhotos((current) => [...current, { key, path: null, src }]);
      uploadPhoto(file)
        .then((uploaded) => setPhotos((current) => current.map((p) => (p.key === key ? { ...p, path: uploaded.path } : p))))
        .catch((e) => {
          toast(`A photo didn't upload: ${errorMessage(e)}`, "error");
          setPhotos((current) => current.filter((p) => p.key !== key));
        });
    }
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      className="hidden"
      onChange={(e) => {
        add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (!photos.length) {
    return (
      <div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setFileOver(true);
          }}
          onDragLeave={() => setFileOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setFileOver(false);
            add(e.dataTransfer.files);
          }}
          className={cx(
            "flex h-40 w-full flex-col items-center justify-center gap-1 rounded-lg border border-line-strong bg-surface-2 text-center transition hover:bg-surface-3",
            fileOver && "border-accent bg-accent-soft",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-3">
            <ImagePlus className="size-5" />
          </span>
          <span className="text-[15px] font-semibold">Add photos</span>
          <span className="text-[13px] text-muted">or drag and drop, up to {MAX_PHOTOS}</span>
        </button>
        {picker}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setFileOver(true);
        }
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        setFileOver(false);
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          add(e.dataTransfer.files);
        }
      }}
      className={cx("rounded-lg", fileOver && "ring-2 ring-accent")}
    >
      <p className="mb-2 text-[13px] text-muted">
        Photos {photos.length} of {MAX_PHOTOS}. The first is the cover. Drag or use the arrows to reorder.
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((photo, index) => (
          <li
            key={photo.key}
            draggable
            onDragStart={(e) => {
              setDragging(index);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(index));
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (dragging !== null) e.preventDefault();
            }}
            onDrop={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              e.stopPropagation();
              setPhotos((current) => move(current, dragging, index));
              setDragging(null);
            }}
            className={cx("tile group aspect-square cursor-grab active:cursor-grabbing", dragging === index && "opacity-40")}
          >
            <img src={photo.src} alt={`Photo ${index + 1}`} className="size-full object-cover" draggable={false} />
            {index === 0 ? <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 text-[11px] font-bold leading-5 text-white">Cover</span> : null}
            {!photo.path ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="size-5 animate-spin text-white" aria-label="Uploading" />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setPhotos((current) => current.filter((p) => p.key !== photo.key))}
              className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
              aria-label={`Remove photo ${index + 1}`}
            >
              <X className="size-4" />
            </button>
            <div className="absolute inset-x-1 bottom-1 flex justify-between">
              {index > 0 ? (
                <button
                  type="button"
                  onClick={() => setPhotos((current) => move(current, index, index - 1))}
                  className="inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                  aria-label={index === 1 ? `Make photo ${index + 1} the cover` : `Move photo ${index + 1} earlier`}
                >
                  <ChevronLeft className="size-4" />
                </button>
              ) : (
                <span />
              )}
              {index < photos.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setPhotos((current) => move(current, index, index + 1))}
                  className="inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                  aria-label={`Move photo ${index + 1} later`}
                >
                  <ChevronRight className="size-4" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {left > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface-2 text-[13px] font-semibold text-fg-2 transition hover:bg-surface-3 hover:text-fg"
            >
              <ImagePlus className="size-5" /> Add
            </button>
          </li>
        ) : null}
      </ul>
      {picker}
    </div>
  );
}

/** One photo for a shop avatar or cover: upload, then hand the stored path back. */
export function useSingleUpload(onUploaded: (path: string, src: string) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setBusy(true);
        try {
          const uploaded = await uploadPhoto(file);
          onUploaded(uploaded.path, URL.createObjectURL(file));
        } catch (err) {
          toast(errorMessage(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { busy, open: () => input.current?.click(), element };
}
