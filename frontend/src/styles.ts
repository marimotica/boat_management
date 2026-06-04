import { css } from "lit";

// Mobile-first shared styles. Colors come from Home Assistant theme variables so
// the panel matches whatever theme the skipper runs (light, dark, custom), with
// sensible fallbacks when a variable is absent.
export const sharedStyles = css`
  :host {
    --bm-bg: var(--primary-background-color, #111418);
    --bm-surface: var(--card-background-color, #1c1f24);
    --bm-surface-2: var(--secondary-background-color, #23272e);
    --bm-text: var(--primary-text-color, #e1e3e6);
    --bm-text-dim: var(--secondary-text-color, #9aa0a6);
    --bm-accent: var(--primary-color, #03a9f4);
    --bm-on-accent: var(--text-primary-color, #fff);
    --bm-divider: var(--divider-color, rgba(255, 255, 255, 0.12));
    --bm-danger: var(--error-color, #db4437);
    --bm-radius: 14px;
    --bm-nav-h: 60px;

    display: block;
    height: 100%;
    color: var(--bm-text);
    background: var(--bm-bg);
    font-family: var(--paper-font-body1_-_font-family, "Roboto", sans-serif);
  }

  * {
    box-sizing: border-box;
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .muted {
    color: var(--bm-text-dim);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--bm-surface-2);
    color: var(--bm-text-dim);
    font-size: 12px;
    line-height: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }
  .field label {
    font-size: 13px;
    color: var(--bm-text-dim);
  }
  .field input,
  .field textarea,
  .field select {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--bm-divider);
    background: var(--bm-surface-2);
    color: var(--bm-text);
    font: inherit;
  }
  .field input:focus,
  .field textarea:focus,
  .field select:focus {
    outline: none;
    border-color: var(--bm-accent);
  }

  .btn {
    border: none;
    border-radius: 10px;
    padding: 12px 16px;
    font-weight: 600;
    background: var(--bm-surface-2);
    color: var(--bm-text);
  }
  .btn.primary {
    background: var(--bm-accent);
    color: var(--bm-on-accent);
  }
  .btn.danger {
    background: transparent;
    color: var(--bm-danger);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .banner {
    margin: 12px 16px;
    padding: 12px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bm-danger) 18%, transparent);
    border: 1px solid var(--bm-danger);
    color: var(--bm-text);
    font-size: 14px;
  }

  .empty {
    text-align: center;
    padding: 48px 24px;
    color: var(--bm-text-dim);
  }
`;
