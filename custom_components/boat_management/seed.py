"""Seed catalogue: a curated, owner-overridable starter set of systems and
catalogue tasks (pure over :class:`BoatData`).

This is opt-in. It exists so a fresh vessel is not a blank slate, but it never
invents *active* work: it only populates the finite, owner-controlled
definitions (systems + Boat Task Catalogue). Seeding is idempotent and matches
existing records by display name (case-insensitive) so re-running it does not
create duplicates. Catalogue tasks still flow through ``create_catalogue_task``
so reference validation and audit events stay consistent.

This module must not import Home Assistant.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .const import TriggerSource
from .data import BoatData
from .systems import create_system
from .task_catalogue import create_catalogue_task

# --- Curated defaults -------------------------------------------------------
# Systems mirror the skipper-friendly domains in AGENTS.md. Each entry is
# (name, category, description).
DEFAULT_SYSTEMS: tuple[tuple[str, str, str], ...] = (
    ("Propulsion", "mechanical", "Engine, gearbox, shaft, and propeller."),
    ("Electrical", "electrical", "Batteries, charging, and distribution."),
    ("Rigging", "rig", "Standing and running rigging, sails, and spars."),
    ("Navigation", "electronics", "Instruments, autopilot, and chartplotter."),
    ("Fresh Water", "plumbing", "Tanks, pumps, and potable water system."),
    ("Waste Water", "plumbing", "Heads, holding tanks, and grey water."),
    ("Fuel", "mechanical", "Fuel tanks, filters, and supply lines."),
    ("Ground Tackle", "deck", "Anchor, rode, windlass, and snubbers."),
    ("Safety", "safety", "Lifesaving, fire, bilge, and emergency gear."),
    ("Tender", "auxiliary", "Dinghy, outboard, and davits."),
)

# Each catalogue task references a system by display name (resolved at apply
# time). Trigger rules are advisory defaults the owner can tune later.
DEFAULT_CATALOGUE_TASKS: tuple[dict[str, Any], ...] = (
    {
        "title": "Change engine oil and filter",
        "system": "Propulsion",
        "description": "Replace engine oil and oil filter.",
        "estimated_duration_minutes": 90,
        "safety_notes": "Engine off and cool. Hot oil burns.",
        "trigger_rules": [
            {
                "source": TriggerSource.ENGINE_HOURS.value,
                "key": "engine",
                "threshold": 100,
            },
        ],
    },
    {
        "title": "Replace raw water impeller",
        "system": "Propulsion",
        "description": "Inspect and replace the raw water pump impeller.",
        "estimated_duration_minutes": 60,
        "trigger_rules": [
            {
                "source": TriggerSource.ENGINE_HOURS.value,
                "key": "engine",
                "threshold": 500,
            },
        ],
    },
    {
        "title": "Service fuel filters and bleed system",
        "system": "Fuel",
        "description": "Replace primary and secondary fuel filters; bleed air.",
        "estimated_duration_minutes": 60,
        "trigger_rules": [
            {
                "source": TriggerSource.ENGINE_HOURS.value,
                "key": "engine",
                "threshold": 250,
            },
        ],
    },
    {
        "title": "Test and equalize battery bank",
        "system": "Electrical",
        "description": "Check electrolyte, voltages, and connections.",
        "estimated_duration_minutes": 45,
        "trigger_rules": [
            {"source": TriggerSource.CALENDAR.value, "key": "quarterly"},
        ],
    },
    {
        "title": "Inspect standing rigging",
        "system": "Rigging",
        "description": "Check terminals, swages, and tension for corrosion or cracks.",
        "estimated_duration_minutes": 120,
        "safety_notes": "Use proper aloft safety when going up the mast.",
        "trigger_rules": [
            {"source": TriggerSource.SEASONAL_TRANSITION.value, "key": "pre_season"},
        ],
    },
    {
        "title": "Update charts and waypoints",
        "system": "Navigation",
        "description": "Apply chart updates and verify routes before passage.",
        "estimated_duration_minutes": 30,
        "trigger_rules": [
            {"source": TriggerSource.PASSAGE_PLAN.value, "key": "pre_departure"},
        ],
    },
    {
        "title": "Sanitize fresh water tanks",
        "system": "Fresh Water",
        "description": "Flush and sanitize potable water tanks and lines.",
        "estimated_duration_minutes": 90,
        "trigger_rules": [
            {"source": TriggerSource.CALENDAR.value, "key": "biannual"},
        ],
    },
    {
        "title": "Service holding tank and heads",
        "system": "Waste Water",
        "description": "Pump out, flush, and check valves and hoses.",
        "estimated_duration_minutes": 60,
        "trigger_rules": [
            {"source": TriggerSource.CALENDAR.value, "key": "quarterly"},
        ],
    },
    {
        "title": "Inspect anchor rode and windlass",
        "system": "Ground Tackle",
        "description": "Check rode, shackles, and lubricate the windlass.",
        "estimated_duration_minutes": 45,
        "trigger_rules": [
            {"source": TriggerSource.SEASONAL_TRANSITION.value, "key": "pre_season"},
        ],
    },
    {
        "title": "Service liferaft and check safety gear",
        "system": "Safety",
        "description": "Send liferaft for service; check flares and extinguishers.",
        "estimated_duration_minutes": 60,
        "safety_notes": "Verify expiry dates on all pyrotechnics.",
        "trigger_rules": [
            {"source": TriggerSource.CALENDAR.value, "key": "annual"},
        ],
    },
    {
        "title": "Service outboard engine",
        "system": "Tender",
        "description": "Change gear oil, check impeller, and inspect the tender.",
        "estimated_duration_minutes": 60,
        "trigger_rules": [
            {"source": TriggerSource.CALENDAR.value, "key": "annual"},
        ],
    },
    # Restock is deliberately system-less: low stock can hit any domain, and a
    # keyless inventory rule matches every low-stock category so the standing
    # suggestion engine always has a task to point at.
    {
        "title": "Restock low inventory",
        "description": "Reorder a consumable or spare that has hit its reorder level.",
        "estimated_duration_minutes": 15,
        "trigger_rules": [
            {"source": TriggerSource.INVENTORY.value},
        ],
    },
    {
        "title": "Address failed inspection finding",
        "system": "Safety",
        "description": "Correct a defect raised by a failed inspection or survey.",
        "estimated_duration_minutes": 60,
        "safety_notes": "Do not return the vessel to service until the finding clears.",
        "trigger_rules": [
            {"source": TriggerSource.INSPECTION_RESULT.value, "key": "fail"},
        ],
    },
)


@dataclass(slots=True)
class SeedReport:
    """Outcome of a seed run. ``dry_run`` reports would-be changes only."""

    dry_run: bool
    systems_added: list[str] = field(default_factory=list)
    systems_skipped: list[str] = field(default_factory=list)
    tasks_added: list[str] = field(default_factory=list)
    tasks_skipped: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.systems_added or self.tasks_added)

    def as_dict(self) -> dict[str, Any]:
        return {
            "dry_run": self.dry_run,
            "systems_added": list(self.systems_added),
            "systems_skipped": list(self.systems_skipped),
            "tasks_added": list(self.tasks_added),
            "tasks_skipped": list(self.tasks_skipped),
        }


def _system_index(data: BoatData) -> dict[str, str]:
    """Map lower-cased system name -> system id for dedup and ref resolution."""
    return {sys.name.strip().lower(): sys.id for sys in data.systems.values()}


def _task_titles(data: BoatData) -> set[str]:
    return {task.title.strip().lower() for task in data.task_catalogue.values()}


def apply_seed_catalogue(
    data: BoatData,
    *,
    dry_run: bool = False,
    actor: str | None = None,
    now: datetime | None = None,
) -> SeedReport:
    """Populate missing default systems and catalogue tasks.

    Idempotent: records already present (matched by name/title,
    case-insensitively) are skipped. With ``dry_run`` no state is mutated and
    the report describes what *would* be added.
    """
    report = SeedReport(dry_run=dry_run)
    system_ids = _system_index(data)
    existing_titles = _task_titles(data)

    for name, category, description in DEFAULT_SYSTEMS:
        key = name.strip().lower()
        if key in system_ids:
            report.systems_skipped.append(name)
            continue
        report.systems_added.append(name)
        if dry_run:
            continue
        system = create_system(
            data,
            name=name,
            category=category,
            description=description,
            actor=actor,
            now=now,
        )
        system_ids[key] = system.id

    for spec in DEFAULT_CATALOGUE_TASKS:
        title = spec["title"]
        if title.strip().lower() in existing_titles:
            report.tasks_skipped.append(title)
            continue
        report.tasks_added.append(title)
        if dry_run:
            continue
        fields = {k: v for k, v in spec.items() if k not in ("title", "system")}
        # Resolve the referenced system by name; a freshly seeded system is in
        # the index now. If the owner removed the system, the task is created
        # without that ref rather than failing the whole seed run.
        system_name = spec.get("system")
        if system_name:
            sid = system_ids.get(system_name.strip().lower())
            if sid:
                fields["system_refs"] = [sid]
        create_catalogue_task(data, title=title, actor=actor, now=now, **fields)
        existing_titles.add(title.strip().lower())

    return report
