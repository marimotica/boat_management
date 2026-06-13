import { LitElement, html, css, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { sharedStyles } from "./styles";
import type { ResolvedMedia } from "./types";

// Read a picked file as raw base64 (no `data:` prefix), which is exactly what
// the upload command expects. We decode via arrayBuffer rather than FileReader's
// data URL so there is no prefix to strip and the result is deterministic under
// test. btoa needs a binary string, so chunk the bytes to avoid blowing the
// argument limit on large (multi-MB) photos.
export async function readFileAsBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface MediaPick {
  filename: string;
  content_type: string;
  data: string;
}

// Presentational photo/PDF strip + capture affordance for a record. It renders
// already-attached media (resolved to signed URLs by the shell) and, in edit
// mode (`canAdd`), offers a camera capture and a file upload. It owns no
// persistence: picking a file emits `bm-media-pick` with the base64 payload and
// tapping remove emits `bm-media-remove` with the opaque document id; the shell
// runs the upload/detach and refreshes. Attaching needs an existing target id,
// so on create (`canAdd` false) it shows a "save first" hint instead.
@customElement("boat-media-capture")
export class BoatMediaCapture extends LitElement {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        margin-bottom: 14px;
      }
      label.title {
        display: block;
        font-size: 13px;
        color: var(--bm-text-dim);
        margin-bottom: 6px;
      }
      .strip {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .item {
        position: relative;
        width: 84px;
        height: 84px;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface-2);
      }
      .item a,
      .item .doc {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        color: var(--bm-text-dim);
      }
      .item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .item .doc {
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        text-align: center;
        font-size: 11px;
        word-break: break-word;
      }
      .item .ext {
        font-size: 12px;
        font-weight: 700;
        color: var(--bm-text);
      }
      .item .pending {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: var(--bm-text-dim);
      }
      /* Remove (×) sits in the corner of each tile. */
      .item .rm {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        font-size: 15px;
        line-height: 22px;
        padding: 0;
        text-align: center;
      }
      .item .rm:disabled {
        opacity: 0.5;
      }
      .add {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .add button {
        border: 1px solid var(--bm-divider);
        background: var(--bm-surface-2);
        color: var(--bm-text);
        border-radius: 10px;
        padding: 10px 14px;
        font-weight: 600;
        font-size: 13px;
      }
      .add button:disabled {
        opacity: 0.5;
      }
      input[type="file"] {
        display: none;
      }
      .hint {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--bm-text-dim);
      }
    `,
  ];

  @property({ attribute: false }) media: ResolvedMedia[] = [];
  // True in edit mode (the target record exists, so uploads have a target id).
  @property({ type: Boolean }) canAdd = false;
  @property({ type: Boolean }) disabled = false;
  @property() label = "Photos & documents";

  @query("#camera") private _camera!: HTMLInputElement;
  @query("#file") private _file!: HTMLInputElement;

  override render() {
    return html`<label class="title">${this.label}</label>
      ${this.media.length
        ? html`<div class="strip">
            ${this.media.map((m) => this._renderItem(m))}
          </div>`
        : nothing}
      ${this.canAdd ? this._renderAdd() : this._renderHint()}`;
  }

  private _renderItem(m: ResolvedMedia) {
    const isImage = m.kind === "image";
    let body;
    if (isImage && m.url) {
      body = html`<a href=${m.url} target="_blank" rel="noopener"
        ><img src=${m.url} alt=${m.filename}
      /></a>`;
    } else if (isImage) {
      // Signed URL not resolved yet: hold the tile so the layout is stable.
      body = html`<div class="pending">…</div>`;
    } else {
      // Non-image (PDF/other): a labelled link rather than an inline preview.
      const ext = extOf(m.filename);
      body = m.url
        ? html`<a href=${m.url} target="_blank" rel="noopener" class="doc"
            ><span class="ext">${ext}</span><span>${m.filename}</span></a
          >`
        : html`<div class="doc">
            <span class="ext">${ext}</span><span>${m.filename}</span>
          </div>`;
    }
    return html`<div class="item">
      ${body}
      <button
        class="rm"
        type="button"
        aria-label="Remove"
        title="Remove"
        ?disabled=${this.disabled}
        @click=${() => this._remove(m.id)}
      >
        ×
      </button>
    </div>`;
  }

  private _renderAdd() {
    return html`<div class="add">
      <button
        type="button"
        class="capture"
        ?disabled=${this.disabled}
        @click=${() => this._camera.click()}
      >
        Take photo
      </button>
      <button
        type="button"
        class="upload"
        ?disabled=${this.disabled}
        @click=${() => this._file.click()}
      >
        Upload file
      </button>
      <!-- capture=environment opens the rear camera directly on mobile. -->
      <input
        id="camera"
        type="file"
        accept="image/*"
        capture="environment"
        @change=${this._onFile}
      />
      <input
        id="file"
        type="file"
        accept="image/*,application/pdf"
        @change=${this._onFile}
      />
    </div>`;
  }

  private _renderHint() {
    return html`<p class="hint">Save to add photos or documents.</p>`;
  }

  private async _onFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear so picking the same file again still fires a change event.
    input.value = "";
    if (!file) return;
    const data = await readFileAsBase64(file);
    this.dispatchEvent(
      new CustomEvent<MediaPick>("bm-media-pick", {
        detail: {
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          data,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _remove(id: string): void {
    this.dispatchEvent(
      new CustomEvent<string>("bm-media-remove", {
        detail: id,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

// Upper-case file extension for a document tile label (e.g. "PDF"), or "FILE".
function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "FILE";
  return filename.slice(dot + 1).toUpperCase();
}

declare global {
  interface HTMLElementTagNameMap {
    "boat-media-capture": BoatMediaCapture;
  }
}
