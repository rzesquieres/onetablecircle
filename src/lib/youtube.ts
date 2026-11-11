/**
 * OneTableCircle's YouTube videos and channel, kept in one place so every
 * link and embed updates together. No "?si=" share-tracking parameters.
 */
export const YOUTUBE_CHANNEL_URL = "https://youtube.com/@onetablecircle";

/** "What is OneTableCircle?" intro video. */
export const INTRO_VIDEO = {
  id: "VNJGXb27zT8",
  title: "What is OneTableCircle?",
} as const;

/** Short link that opens a video on YouTube. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://youtu.be/${videoId}`;
}

/** Thumbnail image. hqdefault exists for every video, unlike maxresdefault. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Player address on YouTube's privacy-enhanced domain. autoplay=1 because the
 * player only loads after the viewer taps play; rel=0 keeps the suggested
 * videos at the end to our own channel.
 */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
}
