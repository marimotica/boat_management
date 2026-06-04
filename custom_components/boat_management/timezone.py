"""Pure timezone helpers for the boat_management integration.

A vessel moves globally, so its timezone is editable operational state and is
NOT the same as Home Assistant's configured timezone. UTC is canonical for
storage; local timestamps plus the timezone in effect are preserved for
historical meaning. None of this module may import Home Assistant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

_AVAILABLE: frozenset[str] | None = None


def _timezones() -> frozenset[str]:
    """Cache the IANA timezone set; building it repeatedly is wasteful."""
    global _AVAILABLE
    if _AVAILABLE is None:
        _AVAILABLE = frozenset(available_timezones())
    return _AVAILABLE


def is_valid_timezone(name: str | None) -> bool:
    """Return True if ``name`` is a valid IANA timezone such as Europe/Paris."""
    if not name or not isinstance(name, str):
        return False
    if name not in _timezones():
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def validate_timezone(name: str | None) -> str:
    """Validate and return an IANA timezone or raise ``ValueError``.

    The message is intentionally actionable per the logging policy: it tells the
    skipper exactly what kind of value is expected.
    """
    if not is_valid_timezone(name):
        raise ValueError(
            f'Invalid timezone "{name}"; expected an IANA timezone such as '
            "Europe/Paris or America/New_York"
        )
    return name  # type: ignore[return-value]


def utc_now() -> datetime:
    """Timezone-aware current UTC instant."""
    return datetime.now(UTC)


def to_utc_iso(value: datetime) -> str:
    """Serialize a datetime to a canonical UTC ISO-8601 string."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def parse_utc(value: str) -> datetime:
    """Parse an ISO-8601 string into an aware UTC datetime."""
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def to_local_iso(value: datetime, tz_name: str) -> str:
    """Render a UTC instant as a local ISO string in ``tz_name``.

    Used to capture the human-meaningful local timestamp at the moment an event
    happened. The returned string is never reinterpreted later.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(ZoneInfo(tz_name)).isoformat()


@dataclass(frozen=True, slots=True)
class EventTimestamp:
    """A captured moment, preserving UTC ordering and local meaning."""

    utc: datetime
    local_iso: str
    timezone_name: str

    @classmethod
    def capture(cls, tz_name: str, *, now: datetime | None = None) -> EventTimestamp:
        """Capture the current instant in vessel-local terms.

        ``timezone_name`` is stored so the local rendering stays correct even
        after the vessel timezone later changes (see DESIGN.md timezone policy).
        """
        instant = now or utc_now()
        return cls(
            utc=instant,
            local_iso=to_local_iso(instant, tz_name),
            timezone_name=tz_name,
        )
