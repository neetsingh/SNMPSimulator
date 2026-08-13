---
name: snmpsimulator
description: "Use when: creating or updating the Python SNMP simulator project, adding device profiles, implementing MIB support, or changing CLI behavior for simulating vendor SNMP agents."
---

# SNMP Simulator

Use this skill when working on a Python project that simulates SNMP-enabled devices and supports MIB-based behavior.

## Scope
- Device profiles for common vendor equipment
- OID and table simulation
- MIB parsing and validation
- CLI and library entry points
- Trap and poll simulation logic

## Preferred design
- model device behavior as data-driven profiles
- isolate the SNMP protocol layer from business logic
- keep MIB mappings explicit and typed
- add sample configurations for common network devices

## Guidance for new work
- Start from a device class or vendor profile, not from the protocol transport first
- Keep MIB support additive and reversible
- Favor reusable abstractions over duplicated per-device code
- Ensure new features include tests for both normal and unsupported OID paths

## Validation checklist
- Unit tests cover core OID responses
- MIB loads succeed for expected fixtures
- Unsupported values fail cleanly
- CLI or library usage remains clear and predictable

## Typical tasks
- Add a new device family and response tables
- Support a new vendor MIB or enterprise OID tree
- Extend trap generation and event behavior
- Improve CLI configuration for running simulated agents
