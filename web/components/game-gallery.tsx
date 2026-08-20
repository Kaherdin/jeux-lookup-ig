"use client";
import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

const https = (u?: string | null) => (u ? u.replace(/^http:/, "https:") : "");

/**
 * Galerie de captures : mosaïque cliquable + visionneuse plein écran
 * (yet-another-react-lightbox : flèches clavier, zoom, bande de miniatures, compteur).
 */
export function GameGallery({ screenshots, titre }: { screenshots: string[]; titre: string }) {
  const [index, setIndex] = useState(-1);
  const slides = screenshots.map((s) => ({ src: https(s) }));
  if (!slides.length) return null;

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slides.map((s, i) => (
          <button key={i} type="button" onClick={() => setIndex(i)}
            aria-label={`${titre} — capture ${i + 1} sur ${slides.length}`}
            className="group relative aspect-video overflow-hidden rounded-md bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
            <img src={s.src} alt="" loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105 group-hover:opacity-90" />
          </button>
        ))}
      </div>

      <Lightbox
        open={index >= 0}
        index={Math.max(index, 0)}
        close={() => setIndex(-1)}
        slides={slides}
        plugins={[Zoom, Thumbnails, Counter]}
        carousel={{ finite: true }}
        controller={{ closeOnBackdropClick: true }}
        thumbnails={{ width: 140, height: 80, border: 0, borderRadius: 6, gap: 8 }}
        styles={{ container: { backgroundColor: "rgba(0,0,0,.92)" } }}
      />
    </>
  );
}
