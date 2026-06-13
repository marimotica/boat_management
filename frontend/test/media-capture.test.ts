import { describe, it, expect, afterEach } from "vitest";
import {
  BoatMediaCapture,
  readFileAsBase64,
  type MediaPick,
} from "../src/media-capture";
import type { ResolvedMedia } from "../src/types";
import { mount, nextEvent } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

function q(el: HTMLElement, selector: string): HTMLElement | null {
  return el.shadowRoot!.querySelector(selector);
}
function qa(el: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll(selector));
}

// Attach a file to a hidden <input type=file> the way a real picker would, then
// fire the change event the component listens for. happy-dom's `files` is
// read-only, so define it; the component reads `files?.[0]`.
function pick(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("readFileAsBase64", () => {
  it("encodes raw bytes as base64 with no data: prefix", async () => {
    // Includes high bytes (0xFA, 0xFF) to prove the chunked binary-string path
    // round-trips non-ASCII data intact.
    const bytes = new Uint8Array([0, 1, 65, 66, 67, 250, 255]);
    const out = await readFileAsBase64(new Blob([bytes]));
    expect(out).not.toContain(",");
    expect(out).not.toContain("data:");
    // Decode back and compare byte-for-byte.
    const decoded = Uint8Array.from(atob(out), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("encodes a known ASCII payload deterministically", async () => {
    const out = await readFileAsBase64(new Blob(["ABC"]));
    expect(out).toBe("QUJD");
  });
});

describe("<boat-media-capture> create mode (canAdd=false)", () => {
  it("shows a save-first hint and no capture buttons", async () => {
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      canAdd: false,
    });
    expect(q(el, ".hint")).not.toBeNull();
    expect(q(el, ".add")).toBeNull();
    expect(q(el, "#camera")).toBeNull();
    expect(q(el, "#file")).toBeNull();
  });
});

describe("<boat-media-capture> edit mode (canAdd=true)", () => {
  it("offers camera and file inputs instead of the hint", async () => {
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      canAdd: true,
    });
    expect(q(el, ".hint")).toBeNull();
    const camera = q(el, "#camera") as HTMLInputElement;
    const file = q(el, "#file") as HTMLInputElement;
    expect(camera).not.toBeNull();
    // The camera input opens the rear camera straight to capture on mobile.
    expect(camera.getAttribute("capture")).toBe("environment");
    expect(camera.getAttribute("accept")).toBe("image/*");
    // The generic file input also accepts PDFs.
    expect(file.getAttribute("accept")).toBe("image/*,application/pdf");
  });

  it("emits bm-media-pick with the base64 payload when a file is chosen", async () => {
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      canAdd: true,
    });
    const event = nextEvent<MediaPick>(el, "bm-media-pick");
    pick(
      q(el, "#file") as HTMLInputElement,
      new File(["ABC"], "manual.pdf", { type: "application/pdf" }),
    );
    expect(await event).toMatchObject({
      detail: { filename: "manual.pdf", content_type: "application/pdf", data: "QUJD" },
    });
  });

  it("falls back to a generic content type when the browser omits one", async () => {
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      canAdd: true,
    });
    const event = nextEvent<MediaPick>(el, "bm-media-pick");
    pick(q(el, "#file") as HTMLInputElement, new File(["X"], "blob.bin"));
    expect((await event).detail.content_type).toBe("application/octet-stream");
  });

  it("bubbles the pick across shadow boundaries so the shell can catch it", async () => {
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      canAdd: true,
    });
    const host = document.createElement("div");
    el.parentElement!.replaceChild(host, el);
    host.appendChild(el);
    const event = nextEvent<MediaPick>(host, "bm-media-pick");
    pick(q(el, "#file") as HTMLInputElement, new File(["ABC"], "a.jpg", {
      type: "image/jpeg",
    }));
    expect((await event).detail.data).toBe("QUJD");
  });
});

describe("<boat-media-capture> rendering attached media", () => {
  it("renders an image tile when a signed URL is resolved", async () => {
    const media: ResolvedMedia[] = [
      { id: "d1", filename: "a.jpg", kind: "image", url: "/m/d1?authSig=z" },
    ];
    const el = await mount<BoatMediaCapture>("boat-media-capture", { media });
    const img = q(el, ".item img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("/m/d1?authSig=z");
    expect(q(el, ".pending")).toBeNull();
  });

  it("holds a placeholder while an image URL is still being signed", async () => {
    const media: ResolvedMedia[] = [
      { id: "d1", filename: "a.jpg", kind: "image", url: null },
    ];
    const el = await mount<BoatMediaCapture>("boat-media-capture", { media });
    expect(q(el, ".pending")).not.toBeNull();
    expect(q(el, ".item img")).toBeNull();
  });

  it("renders a labelled link for non-image documents", async () => {
    const media: ResolvedMedia[] = [
      { id: "d2", filename: "engine-manual.pdf", kind: "document", url: "/m/d2?z" },
    ];
    const el = await mount<BoatMediaCapture>("boat-media-capture", { media });
    const doc = q(el, ".item .doc") as HTMLAnchorElement;
    expect(doc).not.toBeNull();
    expect(q(el, ".item .ext")!.textContent).toBe("PDF");
    expect(doc.getAttribute("href")).toBe("/m/d2?z");
  });

  it("emits bm-media-remove with the document id when × is tapped", async () => {
    const media: ResolvedMedia[] = [
      { id: "d9", filename: "a.jpg", kind: "image", url: "/m/d9" },
    ];
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      media,
      canAdd: true,
    });
    const event = nextEvent<string>(el, "bm-media-remove");
    (q(el, ".item .rm") as HTMLButtonElement).click();
    expect(await event).toMatchObject({ detail: "d9" });
  });

  it("disables removal while a write is in flight", async () => {
    const media: ResolvedMedia[] = [
      { id: "d9", filename: "a.jpg", kind: "image", url: "/m/d9" },
    ];
    const el = await mount<BoatMediaCapture>("boat-media-capture", {
      media,
      canAdd: true,
      disabled: true,
    });
    expect(qa(el, ".add button").every((b) => (b as HTMLButtonElement).disabled)).toBe(
      true,
    );
    expect((q(el, ".item .rm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders one tile per resolved media entry", async () => {
    const media: ResolvedMedia[] = [
      { id: "d1", filename: "a.jpg", kind: "image", url: "/m/d1" },
      { id: "d2", filename: "b.pdf", kind: "document", url: "/m/d2" },
    ];
    const el = await mount<BoatMediaCapture>("boat-media-capture", { media });
    expect(qa(el, ".item")).toHaveLength(2);
  });
});
