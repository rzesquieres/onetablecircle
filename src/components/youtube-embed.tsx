"use client";

import { useState } from "react";
import { youtubeEmbedUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "@/lib/youtube";

/**
 * Click-to-play YouTube video. Until the viewer taps play, only the thumbnail
 * image loads: no YouTube player, scripts or cookies, so the page stays fast.
 * The 16:9 box is the same size before and after, so nothing jumps.
 */
export function YouTubeEmbed({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <figure className="w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black">
        {playing ? (
          <iframe
            src={youtubeEmbedUrl(videoId)}
            title={title}
            className="absolute inset-0 size-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play: ${title}`}
            className="group absolute inset-0 size-full cursor-pointer focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-brand"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail; no remote image config needed */}
            <img
              src={youtubeThumbnailUrl(videoId)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => {
                // If the thumbnail can't load, show the plain dark box and play button, not a broken-image icon.
                e.currentTarget.hidden = true;
              }}
              className="absolute inset-0 size-full object-cover"
            />
            <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/10" />
            <span className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-transform group-hover:scale-105 group-active:scale-95 md:size-20">
              <svg viewBox="0 0 24 24" className="ml-1 size-7 md:size-9" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">{title}</span>
        <a
          href={youtubeWatchUrl(videoId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-ink-soft underline"
        >
          Watch on YouTube
        </a>
      </figcaption>
    </figure>
  );
}
