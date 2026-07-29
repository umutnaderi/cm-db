#!/usr/bin/env python3
"""Apply reviewed player component fields and release resolved quarantines."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import REGISTRY_DB, registry_connection
from player_components import (
    COMPONENT_RESOLUTIONS,
    REFERENCE_COMPONENT_RESOLUTIONS,
    apply_component_fields,
    load_all_component_resolutions,
)


def apply(
    registry_path: Path,
    resolutions_path: Path,
    reference_resolutions_path: Path,
) -> dict[str, int]:
    connection = registry_connection(registry_path)
    try:
        resolutions = load_all_component_resolutions(
            resolutions_path,
            reference_resolutions_path,
        )
        connection.execute("BEGIN IMMEDIATE")
        result = apply_component_fields(
            connection,resolutions,clear_quarantine=True
        )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument(
        "--component-resolutions",
        type=Path,
        default=COMPONENT_RESOLUTIONS,
    )
    parser.add_argument(
        "--reference-component-resolutions",
        type=Path,
        default=REFERENCE_COMPONENT_RESOLUTIONS,
    )
    args = parser.parse_args()
    result = apply(
        args.registry,
        args.component_resolutions,
        args.reference_component_resolutions,
    )
    print(
        "reviewed components: {components}; members: {members}; "
        "derived DOBs changed: {changed}; quarantine rows cleared: "
        "{quarantine_cleared}".format(**result)
    )


if __name__ == "__main__":
    main()
