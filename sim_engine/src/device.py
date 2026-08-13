from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict


@dataclass
class DeviceProfile:
    device_type: str
    system_name: str
    vendor: str = "generic"
    oids: Dict[str, object] = field(default_factory=dict)

    @classmethod
    def from_device_type(cls, device_type: str) -> "DeviceProfile":
        base_profiles = {
            "router": {
                "system_name": "Router",
                "oids": {
                    "1.3.6.1.2.1.1.1.0": "Router",
                    "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.99999.1",
                    "1.3.6.1.2.1.2.2.1.10.1": 1,
                    "1.3.6.1.2.1.2.2.1.11.1": 1,
                },
            },
            "switch": {
                "system_name": "Switch",
                "oids": {
                    "1.3.6.1.2.1.1.1.0": "Switch",
                    "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.99999.2",
                    "1.3.6.1.2.1.2.2.1.10.1": 1,
                    "1.3.6.1.2.1.2.2.1.11.1": 2,
                },
            },
            "firewall": {
                "system_name": "Firewall",
                "oids": {
                    "1.3.6.1.2.1.1.1.0": "Firewall",
                    "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.99999.3",
                    "1.3.6.1.2.1.2.2.1.10.1": 1,
                    "1.3.6.1.2.1.2.2.1.11.1": 3,
                },
            },
            "printer": {
                "system_name": "Printer",
                "oids": {
                    "1.3.6.1.2.1.1.1.0": "Printer",
                    "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.99999.4",
                    "1.3.6.1.2.1.2.2.1.10.1": 1,
                    "1.3.6.1.2.1.2.2.1.11.1": 4,
                },
            },
            "ap": {
                "system_name": "Access Point",
                "oids": {
                    "1.3.6.1.2.1.1.1.0": "Access Point",
                    "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.99999.5",
                    "1.3.6.1.2.1.2.2.1.10.1": 1,
                    "1.3.6.1.2.1.2.2.1.11.1": 5,
                },
            },
            "server": {
                "system_name": "Server",
                "oids": {
                    "1.3.6.1.2.1.1.1.0": "Server",
                    "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.99999.6",
                    "1.3.6.1.2.1.2.2.1.10.1": 1,
                    "1.3.6.1.2.1.2.2.1.11.1": 6,
                },
            },
        }

        if device_type not in base_profiles:
            raise ValueError(f"Unsupported device type: {device_type}")

        profile = base_profiles[device_type]
        return cls(device_type=device_type, system_name=profile["system_name"], oids=profile["oids"].copy())

    @classmethod
    def from_vendor(cls, vendor: str) -> "DeviceProfile":
        vendor_name = vendor.lower().replace("_", "-")
        aliases = {
            "cambium": "cambium",
            "cambium-epmp": "cambium",
            "epmp": "cambium",
            "radwin": "radwin",
            "radwin-winlink1000": "radwin",
            "winlink1000": "radwin",
            "hfcl": "hfcl",
            "hfcl-tdma": "hfcl",
            "tdma": "hfcl",
        }
        resolved_vendor = aliases.get(vendor_name)

        if resolved_vendor is None:
            raise ValueError(f"Unsupported vendor profile: {vendor}")

        vendor_profiles = {
            "cambium": {
                "device_type": "wireless_ap",
                "system_name": "Cambium ePMP",
                "vendor": "cambium",
                "oids": {
                    "1.3.6.1.4.1.17713.21.1.1": "cambiumCurrentSWInfo",
                    "1.3.6.1.4.1.17713.21.1.2": "cambiumHWInfo",
                    "1.3.6.1.4.1.17713.21.1.3": "cambiumLinkStatus",
                    "1.3.6.1.4.1.17713.21.1.4": "cambiumRFStatus",
                    "1.3.6.1.4.1.17713.21.4.1": "cambiumSystemLog",
                    "1.3.6.1.4.1.17713.21.4.2": "cambiumDHCP",
                },
            },
            "radwin": {
                "device_type": "wireless_link",
                "system_name": "Radwin WinLink1000",
                "vendor": "radwin",
                "oids": {
                    "1.3.6.1.4.1.4458.1000.1.1.1": "winlink1000OduAdmProductType",
                    "1.3.6.1.4.1.4458.1000.1.1.2": "winlink1000OduAdmHwRev",
                    "1.3.6.1.4.1.4458.1000.1.1.3": "winlink1000OduAdmSwRev",
                    "1.3.6.1.4.1.4458.1000.1.1.4": "winlink1000OduAdmLinkName",
                    "1.3.6.1.4.1.4458.1000.1.1.10": "winlink1000OduAdmBroadcast",
                    "1.3.6.1.4.1.4458.1000.1.1.13": "winlink1000OduBuzzerAdminState",
                },
            },
            "hfcl": {
                "device_type": "outdoor_unit",
                "system_name": "HFCL TDMA ODU",
                "vendor": "hfcl",
                "oids": {
                    "1.3.6.1.4.1.3577.1.1": "oduHostName",
                    "1.3.6.1.4.1.3577.1.2": "oduMacAddress",
                    "1.3.6.1.4.1.3577.1.3": "oduSerialNo",
                    "1.3.6.1.4.1.3577.1.4": "oduSnmpAgentVersion",
                    "1.3.6.1.4.1.3577.1.5": "oduDateAndTime",
                    "1.3.6.1.4.1.3577.1.6": "oduUpTime",
                },
            },
        }

        profile = vendor_profiles[resolved_vendor]
        return cls(
            device_type=profile["device_type"],
            system_name=profile["system_name"],
            vendor=profile["vendor"],
            oids=profile["oids"].copy(),
        )
