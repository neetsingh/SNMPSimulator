import logging
import json
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from api import CreateInstanceRequest, DeviceConfig, SimulationRequest, create_instance, get_instance, get_mib_tree, list_instances, registry, snmp_get, update_instance
from device import DeviceProfile
from mib import MibLoader
from simulator import Simulator


def test_router_profile_has_expected_oid_values():
    router = DeviceProfile.from_device_type("router")

    assert router.device_type == "router"
    assert router.system_name == "Router"
    assert router.oids["1.3.6.1.2.1.1.1.0"] == "Router"


def test_custom_mib_file_can_be_loaded_from_text():
    mib_text = """
    CUSTOM-MIB DEFINITIONS ::= BEGIN
    IMPORTS
      MODULE-IDENTITY, OBJECT-TYPE, enterprises
      FROM SNMPv2-SMI;

    acme MODULE-IDENTITY
      LAST-UPDATED \"202401010000Z\"
      ORGANIZATION \"Acme\"
      CONTACT-INFO \"ops@example.com\"
      DESCRIPTION \"Custom MIB for Acme devices\"
      REVISION \"202401010000\"
      DESCRIPTION \"Initial revision\"
      ::= { enterprises 99999 }

    acmeSystemName OBJECT-TYPE
      SYNTAX OCTET STRING
      ACCESS read-only
      STATUS current
      DESCRIPTION \"Device name\"
      ::= { acme 1 }
    END
    """

    mib = MibLoader.load_from_text(mib_text)

    assert mib.name == "CUSTOM-MIB"
    assert mib.oids["1.3.6.1.4.1.99999.1"] == "Acme device"


def test_simulator_handles_uint_and_string_oids():
    sim = Simulator()
    sim.register_device("switch", DeviceProfile.from_device_type("switch"))

    assert sim.get_oid_value("switch", "1.3.6.1.2.1.1.1.0") == "Switch"
    assert sim.get_oid_value("switch", "1.3.6.1.2.1.2.2.1.10.1") == 1


def test_unsupported_oid_raises_clear_error():
    sim = Simulator()
    sim.register_device("printer", DeviceProfile.from_device_type("printer"))

    try:
        sim.get_oid_value("printer", "1.3.6.1.2.1.999.1.0")
        assert False, "Expected KeyError for unsupported OID"
    except KeyError as exc:
        assert "unsupported" in str(exc).lower()


def test_real_airtel_vendor_mibs_are_discoverable():
    mib_dir = Path(r"D:\Projects\Airtel\Airtel_IWAN\MIB_files")
    vendor_mibs = MibLoader.load_directory(mib_dir)

    assert any("CAMBIUM" in name.upper() for name in vendor_mibs)
    assert any("RADWIN" in name.upper() for name in vendor_mibs)
    assert any("HFCI" in name.upper() for name in vendor_mibs)

    cambium = vendor_mibs["CAMBIUM-PMP80211-MIB"]
    assert "1.3.6.1.4.1.17713.21.1.1" in cambium.oids
    assert cambium.oids["1.3.6.1.4.1.17713.21.1.1"] == "cambiumCurrentSWInfo"

    radwin = vendor_mibs["RADWIN-MIB-WINLINK1000"]
    assert "1.3.6.1.4.1.4458.1000.1.1.1" in radwin.oids


def test_vendor_profile_uses_real_airtel_oids():
    cambium = DeviceProfile.from_vendor("cambium")
    radwin = DeviceProfile.from_vendor("radwin")

    assert cambium.vendor == "cambium"
    assert "1.3.6.1.4.1.17713.21.1.1" in cambium.oids
    assert cambium.oids["1.3.6.1.4.1.17713.21.1.1"] == "cambiumCurrentSWInfo"

    assert radwin.vendor == "radwin"
    assert "1.3.6.1.4.1.4458.1000.1.1.1" in radwin.oids


def test_vendor_aliases_match_real_airtel_names():
    cambium = DeviceProfile.from_vendor("cambium-epmp")
    radwin = DeviceProfile.from_vendor("radwin-winlink1000")
    hfcl = DeviceProfile.from_vendor("hfcl-tdma")

    assert cambium.system_name == "Cambium ePMP"
    assert radwin.system_name == "Radwin WinLink1000"
    assert hfcl.system_name == "HFCL TDMA ODU"


def test_vendor_registry_detects_airtel_mib_families():
    registry = MibLoader.load_vendor_registry(Path(r"D:\Projects\Airtel\Airtel_IWAN\MIB_files"))

    assert set(registry) >= {"cambium", "radwin", "hfcl"}
    assert "1.3.6.1.4.1.17713" in registry["cambium"]["oid_prefixes"]
    assert "1.3.6.1.4.1.4458" in registry["radwin"]["oid_prefixes"]
    assert "1.3.6.1.4.1.3577" in registry["hfcl"]["oid_prefixes"]


def test_simulator_can_load_vendor_profiles_from_mib_directory():
    sim = Simulator()
    profiles = sim.load_vendor_profiles_from_mib_directory(Path(r"D:\Projects\Airtel\Airtel_IWAN\MIB_files"))

    assert set(profiles) >= {"cambium", "radwin", "hfcl"}
    assert profiles["cambium"].vendor == "cambium"
    assert profiles["radwin"].vendor == "radwin"
    assert profiles["hfcl"].vendor == "hfcl"


def test_simulator_registers_multiple_devices_and_builds_topology():
    sim = Simulator()
    sim.register_devices_from_config(
        [
            {"name": "core-r1", "device": "router"},
            {"name": "edge-sw1", "device": "switch"},
            {"name": "ap-cambium-1", "vendor": "cambium"},
        ]
    )

    topology = sim.build_topology(
        [
            {"source": "core-r1", "target": "edge-sw1", "link_type": "ethernet"},
            {"source": "edge-sw1", "target": "ap-cambium-1", "link_type": "wireless"},
        ]
    )

    assert set(sim.list_devices()) == {"core-r1", "edge-sw1", "ap-cambium-1"}
    assert len(topology["nodes"]) == 3
    assert len(topology["links"]) == 2
    assert "edge-sw1" in topology["neighbors"]["core-r1"]
    assert "core-r1" in topology["neighbors"]["edge-sw1"]


def test_snmp_get_and_set_are_logged(caplog):
    sim = Simulator()
    sim.register_device("switch", DeviceProfile.from_device_type("switch"))

    with caplog.at_level(logging.INFO, logger="snmpsim"):
        value = sim.get_oid_value("switch", "1.3.6.1.2.1.1.1.0")
        assert value == "Switch"

        updated = sim.set_oid_value("switch", "1.3.6.1.2.1.1.1.0", "Updated Switch")
        assert updated == "Updated Switch"

    messages = [record.getMessage() for record in caplog.records]
    assert any("SNMP GET" in message and "switch" in message and "1.3.6.1.2.1.1.1.0" in message for message in messages)
    assert any("SNMP SET" in message and "switch" in message and "Updated Switch" in message for message in messages)


def test_device_config_requires_exactly_one_selector():
    try:
        DeviceConfig(name="bad-device", device="router", vendor="cambium")
        assert False, "Expected validation failure when both vendor and device are provided"
    except ValidationError as exc:
        assert "Exactly one of 'vendor' or 'device'/'device_type' must be provided" in str(exc)


def test_simulation_request_requires_unique_device_names():
    try:
        SimulationRequest(
            devices=[
                DeviceConfig(name="dup", device="router"),
                DeviceConfig(name="dup", device="switch"),
            ],
            topology=[],
        )
        assert False, "Expected validation failure for duplicate names"
    except ValidationError as exc:
        assert "Each device name must be unique" in str(exc)


def test_simulate_maps_invalid_topology_to_http_400():
    request = CreateInstanceRequest(
        instance_name="bad-topology",
        devices=[DeviceConfig(name="r1", device="router")],
        topology=[{"source": "r1", "target": "missing-node", "link_type": "ethernet"}],
    )

    try:
        create_instance(request)
        assert False, "Expected HTTPException for invalid topology"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "Unknown topology target device" in str(exc.detail)


def test_api_can_create_and_fetch_named_instance():
    registry.instances.clear()
    response = create_instance(
        CreateInstanceRequest(
            instance_name="branch-lab",
            devices=[DeviceConfig(name="r1", device="router")],
            topology=[],
            design_layout={"r1": {"x": 180, "y": 220}},
            design_viewport={"scale": 1.25, "pan_x": 30, "pan_y": 45},
        )
    )

    assert response["instance_name"] == "branch-lab"
    assert response["devices"][0]["name"] == "r1"
    assert response["design_layout"]["r1"]["x"] == 180
    assert response["design_viewport"]["scale"] == 1.25

    fetched = get_instance(response["instance_id"])
    assert fetched["instance_id"] == response["instance_id"]
    assert fetched["instance_name"] == "branch-lab"
    assert fetched["design_layout"]["r1"]["y"] == 220
    assert fetched["design_viewport"]["pan_x"] == 30


def test_api_lists_instances():
    registry.instances.clear()
    created = create_instance(
        CreateInstanceRequest(
            instance_name="ops-lab",
            devices=[DeviceConfig(name="sw1", device="switch")],
            topology=[],
        )
    )

    listed = list_instances()
    assert len(listed) == 1
    assert listed[0]["instance_id"] == created["instance_id"]
    assert listed[0]["device_count"] == 1


def test_api_can_update_existing_instance_layout():
    registry.instances.clear()
    created = create_instance(
        CreateInstanceRequest(
            instance_name="ops-lab",
            devices=[DeviceConfig(name="sw1", device="switch")],
            topology=[],
            design_layout={"sw1": {"x": 100, "y": 120}},
        )
    )

    updated = update_instance(
        created["instance_id"],
        CreateInstanceRequest(
            instance_name="ops-lab-updated",
            devices=[DeviceConfig(name="sw1", device="switch")],
            topology=[],
            design_layout={"sw1": {"x": 340, "y": 280}},
            design_viewport={"scale": 0.9, "pan_x": -20, "pan_y": 12},
        ),
    )

    assert updated["instance_id"] == created["instance_id"]
    assert updated["instance_name"] == "ops-lab-updated"
    assert updated["design_layout"]["sw1"]["x"] == 340
    assert updated["design_viewport"]["pan_y"] == 12


def test_snmp_get_uses_instance_scope():
    registry.instances.clear()
    created = create_instance(
        CreateInstanceRequest(
            instance_name="snmp-lab",
            devices=[DeviceConfig(name="sw1", device="switch")],
            topology=[],
        )
    )

    response = snmp_get(created["instance_id"], payload=type("Payload", (), {"device_name": "sw1", "oid": "1.3.6.1.2.1.1.1.0"})())
    assert response["instance_id"] == created["instance_id"]
    assert response["value"] == "Switch"


def test_api_exposes_mib_tree():
    response = get_mib_tree(r"D:\Projects\Airtel\Airtel_IWAN\MIB_files")

    assert response["path"].endswith("MIB_files")
    assert any(module["name"] == "CAMBIUM-PMP80211-MIB" for module in response["modules"])
    cambium = next(module for module in response["modules"] if module["name"] == "CAMBIUM-PMP80211-MIB")
    assert any(field["oid"] == "1.3.6.1.4.1.17713.21.1.1" for field in cambium["fields"])
