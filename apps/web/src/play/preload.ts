/**
 * Loads images ahead of the theater (F3.3), so a scene is whole when the curtain opens on it.
 * The theater asks for the same URLs right after; the browser has them by then.
 */

/** Longest the curtain stays shut for images: a slow or broken one must not hold up the show. */
export const IMAGE_WAIT_MS = 5000;

function load(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    // A failed image resolves too: the theater leaves that cutout out and shows the rest.
    image.onload = () => {
      resolve();
    };
    image.onerror = () => {
      resolve();
    };
    image.src = url;
  });
}

/** Resolves when every image has loaded or failed, or after `timeoutMs`. Never rejects. */
export function preloadImages(urls: readonly string[], timeoutMs = IMAGE_WAIT_MS): Promise<void> {
  if (urls.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const giveUp = window.setTimeout(resolve, timeoutMs);
    void Promise.all(urls.map(load)).then(() => {
      window.clearTimeout(giveUp);
      resolve();
    });
  });
}
