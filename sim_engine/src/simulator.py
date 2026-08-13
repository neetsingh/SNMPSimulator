from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Iterable

from device import DeviceProfile
from mib import MibLoader

logger = logging.getLogger("snmpsim")


class Simulator:
    def __init__(self) -> None:
        self.devices: Dict[str, DeviceProfile] = {}

    def register_device(self, name: str, profile: DeviceProfile) -> None:
        self.devices[name] = profile

    def register_vendor_device(self, name: str, vendor: str) -> DeviceProfile:
        profile = DeviceProfile.from_vendor(vendor)
        self.register_device(name, profile)
        return profile

    def load_vendor_profiles_from_mib_directory(self, path: str | Path) -> Dict[str, DeviceProfile]:
        registry = MibLoader.load_vendor_registry(path)
        profiles: Dict[str, DeviceProfile] = {}

        for vendor, data in registry.items():
            try:
                profile = DeviceProfile.from_vendor(vendor)
            except ValueError:
                continue
            profiles[vendor] = profile

        return profiles

    def get_oid_value(self, device_name: str, oid: str) -> object:
        profile = self.devices.get(device_name)
        if profile is None:
            logger.error("SNMP GET failed for device %s: unknown device", device_name)
            raise KeyError(f"Unknown device: {device_name}")

        if oid not in profile.oids:
            logger.error("SNMP GET failed for device %s on OID %s: unsupported OID", device_name, oid)
            raise KeyError(f"Unsupported OID for device '{device_name}': {oid}")

        value = profile.oids[oid]
        logger.info("SNMP GET device=%s oid=%s value=%s", device_name, oid, value)
        return value

    def set_oid_value(self, device_name: str, oid: str, value: object) -> object:
        profile = self.devices.get(device_name)
        if profile is None:
            logger.error("SNMP SET failed for device %s: unknown device", device_name)
            raise KeyError(f"Unknown device: {device_name}")

        if oid not in profile.oids:
            logger.error("SNMP SET failed for device %s on OID %s: unsupported OID", device_name, oid)
            raise KeyError(f"Unsupported OID for device '{device_name}': {oid}")

        profile.oids[oid] = value
        logger.info("SNMP SET device=%s oid=%s value=%s", device_name, oid, value)
        return profile.oids[oid]

    def generate_trap(self, device_name: str, oid: str, value: object) -> dict:
        payload = {
            "device": device_name,
            "oid": oid,
            "value": value,
            "timestamp": "now",
        }
        logger.info("SNMP TRAP device=%s oid=%s value=%s", device_name, oid, value)
        return payload

    def list_devices(self) -> Dict[str, str]:
        return {name: profile.vendor for name, profile in self.devices.items()}

    def register_devices_from_config(
        self,
        device_configs: Iterable[dict[str, Any]],
        vendor_profiles: Dict[str, DeviceProfile] | None = None,
    ) -> Dict[str, DeviceProfile]:
        registered: Dict[str, DeviceProfile] = {}
        vendor_profiles = vendor_profiles or {}

        for item in device_configs:
            name = item.get("name")
            if not name:
                raise ValueError("Each configured device must include a non-empty 'name'")

            vendor = item.get("vendor")
            device_type = item.get("device") or item.get("device_type")

            if vendor:
                normalized_vendor = str(vendor).lower().replace("_", "-")
                profile = vendor_profiles.get(normalized_vendor)
                if profile is None:
                    profile = DeviceProfile.from_vendor(normalized_vendor)
            elif device_type:
                profile = DeviceProfile.from_device_type(str(device_type))
            else:
                raise ValueError(
                    f"Configured device '{name}' must include either 'vendor' or 'device'"
                )

            self.register_device(str(name), profile)
            registered[str(name)] = profile

        return registered

    def build_topology(self, links: Iterable[dict[str, Any]]) -> dict[str, Any]:
        topology_links: list[dict[str, Any]] = []
        neighbors: dict[str, list[str]] = {name: [] for name in self.devices}

        for link in links:
            source = str(link.get("source", ""))
            target = str(link.get("target", ""))
            if not source or not target:
                raise ValueError("Each topology link must include both 'source' and 'target'")
            if source not in self.devices:
                raise KeyError(f"Unknown topology source device: {source}")
            if target not in self.devices:
                raise KeyError(f"Unknown topology target device: {target}")

            neighbors[source].append(target)
            neighbors[target].append(source)

            topology_links.append(
                {
                    "source": source,
                    "target": target,
                    "link_type": link.get("link_type", "ethernet"),
                }
            )

        topology = {
            "nodes": [
                {
                    "name": name,
                    "vendor": profile.vendor,
                    "device_type": profile.device_type,
                }
                for name, profile in self.devices.items()
            ],
            "links": topology_links,
            "neighbors": neighbors,
        }
        logger.info(
            "Built topology with %s nodes and %s links",
            len(topology["nodes"]),
            len(topology_links),
        )
        return topology
