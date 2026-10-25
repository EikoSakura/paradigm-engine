/* Portrait framing: where an actor's picture sits in its frame and how
   far in, one setting on the actor, read by the PC and NPC Files, the
   Party File's member cards, and the chat band alike. x and y are the
   focus point as percentages of the picture, zoom a scale from 1 to 3;
   the frame covers with the focus point held still as the zoom changes. */

export const FRAME_DEFAULT = { x: 50, y: 0, zoom: 1 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.2;

export function cleanFrame(raw) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    x: Math.clamp(num(raw?.x, FRAME_DEFAULT.x), 0, 100),
    y: Math.clamp(num(raw?.y, FRAME_DEFAULT.y), 0, 100),
    zoom: Math.clamp(Math.round(num(raw?.zoom, FRAME_DEFAULT.zoom) * 10) / 10, ZOOM_MIN, ZOOM_MAX)
  };
}

export function frameOf(actor) {
  return cleanFrame(actor?.getFlag("paradigm-engine", "frame"));
}

/* The inline style that puts a covering picture in its frame. */
export function frameStyle(frame) {
  const f = cleanFrame(frame);
  return `object-position: ${f.x}% ${f.y}%; transform: scale(${f.zoom}); transform-origin: ${f.x}% ${f.y}%;`;
}

/* The actor's own portrait when it is a real picture: Foundry's default
   icon and any other SVG have no ground of their own and cannot fill a
   frame. */
export function portraitOf(actor) {
  const img = actor?.img ?? "";
  if (!img || img === foundry.documents.BaseActor.DEFAULT_ICON) return "";
  if (/\.svg(\?.*)?$/i.test(img)) return "";
  return img;
}

/* Drag to frame: pointer movement across the frame moves the focus point
   the other way, so the picture follows the pointer; a drag shorter than
   a click's worth leaves the frame alone. Returns the frame to store once
   the pointer lifts, or null for a click. */
export function wireFrameDrag(img, frame, onCommit) {
  let start = null;
  let live = { ...frame };
  let moved = false;
  const apply = () => { img.style.cssText = frameStyle(live); };
  img.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, fx: live.x, fy: live.y };
    moved = false;
    img.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  img.addEventListener("pointermove", event => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    const rect = img.getBoundingClientRect();
    live.x = Math.clamp(start.fx - (dx / rect.width) * 100, 0, 100);
    live.y = Math.clamp(start.fy - (dy / rect.height) * 100, 0, 100);
    apply();
  });
  const end = event => {
    if (!start) return;
    start = null;
    if (img.hasPointerCapture?.(event.pointerId)) img.releasePointerCapture(event.pointerId);
    if (moved) onCommit(cleanFrame(live));
  };
  img.addEventListener("pointerup", end);
  img.addEventListener("pointercancel", end);
}
