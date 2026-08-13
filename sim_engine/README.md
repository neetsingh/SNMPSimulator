# SNMP Simulator

A Python project for simulating common SNMP-enabled network devices and loading MIB-driven behavior.

## Features
- Device profiles for routers, switches, firewalls, printers, Wi-Fi access points, and servers
- MIB loading from text or file input
- OID lookups and device registration
- Basic trap-style event simulation via the simulator API
- CLI entry point for starting multiple simulated devices and topology from configuration

## Installation

```bash
python -m pip install -e .
```

## Quick start

```python
from device import DeviceProfile
from simulator import Simulator

router = DeviceProfile.from_device_type("router")
sim = Simulator()
sim.register_device("edge-router", router)

print(sim.get_oid_value("edge-router", "1.3.6.1.2.1.1.1.0"))
```

## API for sim_ui

Run the backend API:

```bash
cd src
python api.py
```

Base URL:

```text
http://127.0.0.1:8000/api
```

Primary endpoints:
- `POST /api/instances`: create a named simulation instance from UI input
- `GET /api/instances`: list existing simulation instances
- `GET /api/instances/{instance_id}`: fetch a simulation instance snapshot
- `DELETE /api/instances/{instance_id}`: remove a simulation instance
- `GET /api/instances/{instance_id}/topology`: fetch topology for one instance
- `POST /api/instances/{instance_id}/snmp/get`: fetch an OID value from one instance
- `POST /api/instances/{instance_id}/snmp/set`: update an OID value on one instance
- `POST /api/simulate`: submit `devices` and `topology` configuration
- `GET /api/health`: backend health check

### Configuration format

```json
{
	"devices": [
		{"name": "core-r1", "device": "router"},
		{"name": "ap-cambium-1", "vendor": "cambium"}
	],
	"topology": [
		{"source": "core-r1", "target": "ap-cambium-1", "link_type": "wireless"}
	]
}
```
