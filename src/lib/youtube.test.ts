import { describe, expect, it } from "vitest";
import {
  INTRO_VIDEO,
  YOUTUBE_CHANNEL_URL,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "./youtube";

describe("youtube links", () => {
  it("points at the intro video and channel", () => {
    expect(youtubeWatchUrl(INTRO_VIDEO.id)).toBe("https://youtu.be/VNJGXb27zT8");
    expect(YOUTUBE_CHANNEL_URL).toBe("https://youtube.com/@onetablecircle");
  });

  it("embeds from the privacy-enhanced domain with own-channel suggestions", () => {
    const url = new URL(youtubeEmbedUrl(INTRO_VIDEO.id));
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe("/embed/VNJGXb27zT8");
    expect(url.searchParams.get("rel")).toBe("0");
    expect(url.searchParams.get("autoplay")).toBe("1");
  });

  it("uses a thumbnail that exists for every video", () => {
    expect(youtubeThumbnailUrl(INTRO_VIDEO.id)).toBe("https://i.ytimg.com/vi/VNJGXb27zT8/hqdefault.jpg");
  });

  it("carries no share-tracking parameters", () => {
    for (const u of [YOUTUBE_CHANNEL_URL, youtubeWatchUrl(INTRO_VIDEO.id), youtubeEmbedUrl(INTRO_VIDEO.id)]) {
      expect(new URL(u).searchParams.has("si")).toBe(false);
    }
  });
});
