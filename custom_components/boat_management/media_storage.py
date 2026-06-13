"""On-disk blob storage and the authenticated serving view for media.

The pure metadata/attach logic lives in :mod:`media`; this module owns the
Home-Assistant-coupled concerns: where blobs live on disk, the (executor-run)
file I/O helpers, and a :class:`HomeAssistantView` that streams a stored blob
back to an authenticated user.

Blobs live under ``hass.config.path(DOMAIN, <entry_id>, "media")`` -- on the
real filesystem, deliberately *not* in ``.storage/`` -- so large photos never
bloat the JSON vessel snapshot. The view is registered once per process
(idempotent), mirroring how the panel's static route is managed.
"""

from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, MEDIA_SUBDIR, MEDIA_URL_PREFIX

_LOGGER = logging.getLogger(__name__)

# Process-global flag, intentionally outside hass.data[DOMAIN] so it neither
# pollutes the coordinator registry nor is torn down on last-entry unload (the
# view, like the static route, cannot be cleanly removed from aiohttp).
_MEDIA_VIEW_REGISTERED: str = f"{DOMAIN}_media_view_registered"


def media_dir(hass: HomeAssistant, entry_id: str) -> Path:
    """Directory holding one vessel's uploaded blobs."""
    return Path(hass.config.path(DOMAIN, entry_id, MEDIA_SUBDIR))


def blob_path(hass: HomeAssistant, entry_id: str, stored_filename: str) -> Path:
    """Absolute path of a single blob from its portable stored basename."""
    return media_dir(hass, entry_id) / stored_filename


def write_blob(path: Path, payload: bytes) -> None:
    """Persist a blob, creating the parent directory. Run in an executor."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def delete_blob(path: Path) -> None:
    """Best-effort blob removal (used to clean up orphans). Run in an executor."""
    path.unlink(missing_ok=True)


class BoatMediaView(HomeAssistantView):
    """Serve an uploaded blob to an authenticated user by opaque document id."""

    url = MEDIA_URL_PREFIX + "/{entry_id}/{document_id}"
    name = f"api:{DOMAIN}:media"
    requires_auth = True

    async def get(
        self, request: web.Request, entry_id: str, document_id: str
    ) -> web.StreamResponse:
        """Return the blob bytes with its stored content type, or 404.

        Lookups are by opaque document id against the live vessel state, so a
        retired/detached document immediately stops resolving. Filenames are not
        trusted for path building -- only the metadata's ``stored_filename``.
        """
        hass: HomeAssistant = request.app["hass"]
        coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
        if coordinator is None:
            return web.Response(status=404)
        record = coordinator.data.documents.get(document_id)
        if not record:
            return web.Response(status=404)
        path = blob_path(hass, entry_id, record["stored_filename"])
        if not path.is_file():
            # Metadata without a blob is a real inconsistency; make it visible in
            # logs rather than silently returning an empty body.
            _LOGGER.warning(
                "Document %s metadata present but blob missing at %s",
                document_id,
                path,
            )
            return web.Response(status=404)
        body = await hass.async_add_executor_job(path.read_bytes)
        return web.Response(
            body=body,
            content_type=record.get("content_type") or "application/octet-stream",
            headers={"Cache-Control": "private, max-age=3600"},
        )


@callback
def async_register_media_view(hass: HomeAssistant) -> None:
    """Register the media serving view once per Home Assistant process."""
    if hass.data.get(_MEDIA_VIEW_REGISTERED):
        return
    hass.http.register_view(BoatMediaView())
    hass.data[_MEDIA_VIEW_REGISTERED] = True
