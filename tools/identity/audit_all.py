#!/usr/bin/env python3
"""Run every canonical identity audit and write one summary."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from audit_clubs import audit as audit_clubs
from audit_competitions import audit as audit_competitions
from audit_links import audit as audit_nations
from audit_players import audit as audit_players
from common import AUDIT_DIR, REGISTRY_DB


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry",type=Path,default=REGISTRY_DB)
    parser.add_argument("--audit-dir",type=Path,default=AUDIT_DIR)
    arguments=parser.parse_args()
    started=time.monotonic()
    arguments.audit_dir.mkdir(parents=True,exist_ok=True)
    results={}
    for label,function in (
        ("nations",audit_nations),
        ("competitions",audit_competitions),
        ("clubs",audit_clubs),
        ("players",audit_players),
    ):
        print(f"Auditing {label}...",flush=True)
        results[label]=function(arguments.registry,arguments.audit_dir)
        print(json.dumps({label:results[label]},sort_keys=True),flush=True)
    results["elapsed_seconds"]=round(time.monotonic()-started,1)
    output=arguments.audit_dir/"canonical_audit_summary.json"
    temporary=output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(results,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    temporary.replace(output)
    print(json.dumps(results,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
