# AGENTS.md

## Project mission
This repository is a Python-based SNMP simulator for network devices. The project should model common vendor devices available in the market and allow simulation of SNMP agent behavior from standard and vendor-specific MIB files.

## Core goals
- Simulate SNMP agents with realistic object identifiers (OIDs)
- Support common device types such as routers, switches, firewalls, printers, Wi-Fi access points, and servers
- Allow MIB-driven behavior for standard and custom enterprise trees
- Support both polling and trap-style events
- Provide a clean Python API and CLI for starting, configuring, and testing simulated agents

## Expected architecture
- `sim_engine/src/`: backend Python modules (`api.py`, `cli.py`, `device.py`, `mib.py`, `simulator.py`)
- `sim_engine/tests/`: automated behavior tests for engine and API
- `sim_engine/examples/`: sample topology and device configurations
- `sim_ui/src/app/`: Angular UI for visual topology control and SNMP operations

## Coding conventions
- Prefer Python 3.11+ features and type hints for public interfaces
- Use dataclasses for device definitions, configuration, and OID mapping entries
- Keep the simulator engine separate from MIB parsing and vendor profiles
- Treat MIBs as data sources, not hardcoded assumptions; validate all OIDs before exposing them
- Use clear error messages for unknown MIBs, missing indexes, or unsupported SNMP versions
- Keep runtime behavior deterministic unless a feature explicitly requires randomness
- Prefer small, testable functions over large monolithic simulation loops

## Device and MIB rules
- Vendor profiles should be reusable and composable rather than one-off custom objects
- Device behavior should be driven by a schema such as: device type, system metadata, interfaces, tables, traps, and OID values
- MIB support should support both standard RFC MIBs and enterprise/vendor MIBs
- If a requested OID is not in the active MIB or device profile, fail clearly and return a controlled error instead of silently producing invalid data
- Trap generation should follow realistic timing and object mappings, not random hard-coded payloads

## Testing expectations
- Write tests for OID lookups, unsupported objects, trap creation, and MIB loading
- Prefer real MIB files for integration-style validation when practical
- Verify both CLI behavior and library-level APIs before closing work
- Add fixture data for at least one common device family and one custom MIB scenario

## Preferred workflow for agents
1. Start by identifying the device class or MIB feature being added
2. Add or update the smallest relevant model and interface before modifying behavior
3. Keep CLI/API changes consistent with the existing command structure
4. Validate with the narrowest relevant pytest set
5. If a feature depends on vendor-specific MIB syntax, validate the translation path before finalizing the patch

## Commands and validation
- Use `pytest` for the project test suite
- Use `snmpsim` and `snmpsim-api` entry points for smoke testing where applicable
- Prefer targeted tests over broad runs during iteration
- When adding a new device type, also include the associated sample configuration or fixture

## Practical advice for this repo
This project is likely to combine a simulator engine with real SNMP protocol handling. Keep the low-level protocol logic isolated and the device schemas explicit. The best long-term design is a library that can load a device profile, bind MIB definitions, and serve OIDs in a predictable and testable way.
