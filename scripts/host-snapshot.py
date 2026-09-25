#!/usr/bin/env python3
"""host-snapshot.py — print one JSON health snapshot of this VM and its containers.

Run on the host by admin-job-runner.sh, which inserts the output into
source.host_snapshots for /admin. It lives on the host for the same reason the
runner does: container memory and connection counts need the Docker socket,
and the API must never have it.

Stdlib only (the host has python3, not the services' venvs). Every section is
best effort: a failure lands in "errors" and the rest of the snapshot still
records, so one broken probe cannot blank the whole panel.

Connection counts read /proc/net/tcp{,6} inside the container rather than
`ss` on the host. Published ports are DNAT'd by iptables straight into the
container's network namespace, so the host's own socket table never sees
those connections; the container's does, with the real client address.
HTTP/3 (UDP 443) has no connection state there and is not counted.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import UTC, datetime
from typing import Any

PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "nba")
# Compose service -> inbound ports worth counting. Caddy is every visitor to
# the site (and to /mcp); MCP only ever sees Caddy, so its count is the number
# of open MCP HTTP streams.
LISTEN_PORTS: dict[str, tuple[int, ...]] = {"caddy": (80, 443), "mcp": (8000,)}
TOP_PEERS = 10
TCP_ESTABLISHED = "01"
TIMEOUT_SECONDS = 20

UNITS = {
    "b": 1,
    "kb": 1000,
    "mb": 1000**2,
    "gb": 1000**3,
    "tb": 1000**4,
    "kib": 1024,
    "mib": 1024**2,
    "gib": 1024**3,
    "tib": 1024**4,
}


def run(*args: str) -> str:
    return subprocess.run(
        args, check=True, capture_output=True, text=True, timeout=TIMEOUT_SECONDS
    ).stdout


def parse_size(value: str) -> int | None:
    """``"290.8MiB"`` -> bytes, as printed by ``docker stats``."""
    match = re.fullmatch(r"\s*([\d.]+)\s*([A-Za-z]+)\s*", value)
    if not match or match.group(2).lower() not in UNITS:
        return None
    return int(float(match.group(1)) * UNITS[match.group(2).lower()])


def host_section() -> dict[str, Any]:
    meminfo: dict[str, int] = {}
    with open("/proc/meminfo") as handle:
        for line in handle:
            key, _, rest = line.partition(":")
            meminfo[key] = int(rest.split()[0]) * 1024
    with open("/proc/loadavg") as handle:
        load = [float(part) for part in handle.read().split()[:3]]
    with open("/proc/uptime") as handle:
        uptime = float(handle.read().split()[0])
    disk = shutil.disk_usage("/")
    return {
        "mem_total_bytes": meminfo["MemTotal"],
        # MemAvailable, not MemFree: page cache is reclaimable, so "free" alone
        # makes a healthy Linux box look nearly full.
        "mem_available_bytes": meminfo["MemAvailable"],
        "swap_total_bytes": meminfo.get("SwapTotal", 0),
        "swap_free_bytes": meminfo.get("SwapFree", 0),
        "load_1m": load[0],
        "load_5m": load[1],
        "load_15m": load[2],
        "cpu_count": os.cpu_count() or 1,
        "uptime_seconds": int(uptime),
        "disk_total_bytes": disk.total,
        "disk_used_bytes": disk.used,
    }


def containers_section() -> list[dict[str, Any]]:
    ids = run(
        "docker",
        "ps",
        "-a",
        "-q",
        "--no-trunc",
        "--filter",
        f"label=com.docker.compose.project={PROJECT}",
    ).split()
    if not ids:
        return []
    inspected = json.loads(run("docker", "inspect", *ids))
    containers: list[dict[str, Any]] = []
    running_ids: list[str] = []
    for item in inspected:
        labels = item["Config"].get("Labels") or {}
        state = item["State"]
        oneoff = labels.get("com.docker.compose.oneoff") == "True"
        # An exited one-off (`compose run --rm` that did not clean up) or a
        # finished migrate is not news; a long-lived service that exited is.
        if not state.get("Running") and (oneoff or state.get("ExitCode") == 0):
            continue
        if state.get("Running"):
            running_ids.append(item["Id"])
        health = (state.get("Health") or {}).get("Status")
        containers.append(
            {
                "id": item["Id"],
                "name": item["Name"].lstrip("/"),
                "service": labels.get("com.docker.compose.service"),
                "oneoff": oneoff,
                "status": state.get("Status"),
                "health": health,
                "exit_code": state.get("ExitCode"),
                "oom_killed": bool(state.get("OOMKilled")),
                "restart_count": item.get("RestartCount", 0),
                "started_at": state.get("StartedAt"),
                "mem_limit_bytes": item["HostConfig"].get("Memory") or None,
                "mem_used_bytes": None,
                "cpu_percent": None,
                "pids": None,
            }
        )
    if running_ids:
        stats: dict[str, dict[str, str]] = {}
        for line in run(
            "docker", "stats", "--no-stream", "--no-trunc", "--format", "{{json .}}", *running_ids
        ).splitlines():
            row = json.loads(line)
            stats[row["ID"]] = row
        for container in containers:
            row = stats.get(container["id"])
            if row is None:
                continue
            used, _, limit = row.get("MemUsage", "").partition("/")
            container["mem_used_bytes"] = parse_size(used)
            # No compose mem_limit means docker reports the host total; keep
            # that so a percentage is still meaningful.
            container["mem_limit_bytes"] = container["mem_limit_bytes"] or parse_size(limit)
            try:
                container["cpu_percent"] = float(row.get("CPUPerc", "").rstrip("%"))
                container["pids"] = int(row.get("PIDs", ""))
            except ValueError:
                pass
    for container in containers:
        del container["id"]
    return sorted(containers, key=lambda container: container["name"])


def decode_address(hex_address: str) -> str:
    """Decode a /proc/net/tcp{,6} address: 32-bit words, each little-endian."""
    raw = bytes.fromhex(hex_address)
    words = b"".join(raw[index : index + 4][::-1] for index in range(0, len(raw), 4))
    if len(words) == 4:
        return ".".join(str(byte) for byte in words)
    if words[:12] == b"\x00" * 10 + b"\xff\xff":
        return ".".join(str(byte) for byte in words[12:])
    groups = [f"{int.from_bytes(words[index : index + 2], 'big'):x}" for index in range(0, 16, 2)]
    return ":".join(groups)


def established_peers(proc_net_tcp: str, ports: tuple[int, ...]) -> Counter[str]:
    peers: Counter[str] = Counter()
    for line in proc_net_tcp.splitlines():
        fields = line.split()
        if len(fields) < 4 or fields[3] != TCP_ESTABLISHED or ":" not in fields[1]:
            continue
        local_port = int(fields[1].rsplit(":", 1)[1], 16)
        if local_port not in ports:
            continue
        peers[decode_address(fields[2].rsplit(":", 1)[0])] += 1
    return peers


def connections_section() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for service, ports in LISTEN_PORTS.items():
        ids = run(
            "docker",
            "ps",
            "-q",
            "--filter",
            f"label=com.docker.compose.project={PROJECT}",
            "--filter",
            f"label=com.docker.compose.service={service}",
            "--filter",
            "label=com.docker.compose.oneoff=False",
        ).split()
        if not ids:
            continue
        # tcp6 may not exist (IPv6 disabled); cat still prints tcp and exits 1.
        proc = subprocess.run(
            ["docker", "exec", ids[0], "cat", "/proc/net/tcp", "/proc/net/tcp6"],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        peers = established_peers(proc.stdout, ports)
        result.append(
            {
                "service": service,
                "ports": list(ports),
                "established": sum(peers.values()),
                "distinct_peers": len(peers),
                "top_peers": [
                    {"address": address, "connections": count}
                    for address, count in peers.most_common(TOP_PEERS)
                ],
            }
        )
    return result


def main() -> int:
    snapshot: dict[str, Any] = {
        "collected_at": datetime.now(UTC).isoformat(),
        "project": PROJECT,
        "host": None,
        "containers": [],
        "connections": [],
        "errors": [],
    }
    for key, collect in (
        ("host", host_section),
        ("containers", containers_section),
        ("connections", connections_section),
    ):
        try:
            snapshot[key] = collect()
        except Exception as exc:  # noqa: BLE001 - one broken probe must not drop the rest
            snapshot["errors"].append(f"{key}: {type(exc).__name__}: {exc}"[:300])
    json.dump(snapshot, sys.stdout, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
