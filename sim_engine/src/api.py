from __future__ import annotations

import duckdb
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from mib import MibLoader
from simulator import Simulator

UPLOAD_ROOT = Path(__file__).resolve().parent / 'uploaded_mibs'
UPLOAD_DB = Path(__file__).resolve().parent / 'uploaded_devices.duckdb'


def _open_db_connection() -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(str(UPLOAD_DB))
    return connection


def _init_uploaded_device_db() -> None:
    connection = _open_db_connection()
    try:
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS uploaded_devices (
                device_name TEXT NOT NULL,
                device_type TEXT NOT NULL,
                path TEXT NOT NULL PRIMARY KEY,
                uploaded_at TEXT NOT NULL,
                module_names_json TEXT NOT NULL
            )
            '''
        )
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS uploaded_mib_modules (
                path TEXT NOT NULL,
                module_name TEXT NOT NULL,
                field_count INTEGER NOT NULL,
                PRIMARY KEY (path, module_name)
            )
            '''
        )
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS uploaded_mib_fields (
                path TEXT NOT NULL,
                module_name TEXT NOT NULL,
                oid TEXT NOT NULL,
                label TEXT NOT NULL,
                oid_type TEXT NOT NULL,
                PRIMARY KEY (path, module_name, oid)
            )
            '''
        )
        connection.execute(
            '''
            CREATE TABLE IF NOT EXISTS uploaded_mib_nodes (
                path TEXT NOT NULL,
                module_name TEXT NOT NULL,
                node_key TEXT NOT NULL,
                parent_node_key TEXT,
                display_name TEXT NOT NULL,
                node_kind TEXT NOT NULL,
                oid TEXT,
                label TEXT,
                oid_type TEXT,
                depth INTEGER NOT NULL,
                sort_order INTEGER NOT NULL,
                PRIMARY KEY (path, module_name, node_key)
            )
            '''
        )
        connection.execute("ALTER TABLE uploaded_mib_fields ADD COLUMN IF NOT EXISTS oid_type TEXT")
    finally:
        connection.close()


def _get_db_connection() -> duckdb.DuckDBPyConnection:
    _init_uploaded_device_db()
    return _open_db_connection()


def _row_to_uploaded_device(row: tuple[Any, ...]) -> dict[str, Any]:
    module_names: list[str]
    try:
        parsed_module_names = json.loads(row[4])
        module_names = parsed_module_names if isinstance(parsed_module_names, list) else []
    except (TypeError, json.JSONDecodeError):
        module_names = []

    return {
        'device_name': row[0],
        'device_type': row[1],
        'path': row[2],
        'uploaded_at': row[3],
        'module_names': module_names,
    }


def _upsert_uploaded_device(record: dict[str, Any], modules: list[dict[str, Any]]) -> None:
    connection = _get_db_connection()
    try:
        connection.execute('DELETE FROM uploaded_mib_nodes WHERE path = ?', [record['path']])
        connection.execute('DELETE FROM uploaded_mib_fields WHERE path = ?', [record['path']])
        connection.execute('DELETE FROM uploaded_mib_modules WHERE path = ?', [record['path']])
        connection.execute('DELETE FROM uploaded_devices WHERE path = ?', [record['path']])
        connection.execute(
            '''
            INSERT INTO uploaded_devices (device_name, device_type, path, uploaded_at, module_names_json)
            VALUES (?, ?, ?, ?, ?)
            ''',
            (
                record['device_name'],
                record['device_type'],
                record['path'],
                record['uploaded_at'],
                json.dumps(record['module_names']),
            ),
        )
        for module in modules:
            unique_fields: list[dict[str, Any]] = []
            seen_oids: set[str] = set()
            for field in module['fields']:
                oid = str(field['oid'])
                if oid in seen_oids:
                    continue
                seen_oids.add(oid)
                unique_fields.append(field)

            connection.execute(
                '''
                INSERT INTO uploaded_mib_modules (path, module_name, field_count)
                VALUES (?, ?, ?)
                ''',
                (record['path'], module['name'], len(unique_fields))
            )
            for field in unique_fields:
                connection.execute(
                    '''
                    INSERT INTO uploaded_mib_fields (path, module_name, oid, label, oid_type)
                    VALUES (?, ?, ?, ?, ?)
                    ''',
                    (record['path'], module['name'], field['oid'], str(field['label']), str(field.get('oid_type', 'singlevalue')))
                )

            module_tree = module.get('tree')
            if not isinstance(module_tree, list):
                module_tree = _build_module_tree_from_fields(unique_fields)

            for node_row in _flatten_module_tree(module_tree):
                connection.execute(
                    '''
                    INSERT INTO uploaded_mib_nodes (
                        path, module_name, node_key, parent_node_key, display_name, node_kind,
                        oid, label, oid_type, depth, sort_order
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''',
                    (
                        record['path'],
                        module['name'],
                        node_row['node_key'],
                        node_row['parent_node_key'],
                        node_row['display_name'],
                        node_row['node_kind'],
                        node_row['oid'],
                        node_row['label'],
                        node_row['oid_type'],
                        node_row['depth'],
                        node_row['sort_order'],
                    ),
                )
    finally:
        connection.close()


def _build_module_tree_from_fields(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    roots: list[dict[str, Any]] = []
    node_lookup: dict[str, dict[str, Any]] = {}
    parent_by_label: dict[str, str] = {}
    field_by_label: dict[str, dict[str, Any]] = {}

    for field in fields:
        label = str(field.get('label', '')).strip()
        if not label:
            continue
        field_by_label[label] = field
        parent_symbol = str(field.get('parent_symbol', '')).strip()
        if parent_symbol:
            parent_by_label[label] = parent_symbol

    def _build_symbol_chain(label: str) -> list[str]:
        chain: list[str] = [label]
        seen: set[str] = {label}
        parent = parent_by_label.get(label)
        while parent and parent not in seen:
            chain.insert(0, parent)
            seen.add(parent)
            parent = parent_by_label.get(parent)
        return chain

    def _ensure_branch(node_key: str, display_name: str, parent_key: str | None) -> None:
        if node_key in node_lookup:
            return
        node: dict[str, Any] = {
            'node_key': node_key,
            'display_name': display_name,
            'node_kind': 'branch',
            'oid': None,
            'label': None,
            'oid_type': None,
            'children': [],
        }
        node_lookup[node_key] = node
        if parent_key is None:
            roots.append(node)
            return
        parent = node_lookup.get(parent_key)
        if parent is None:
            roots.append(node)
            return
        parent_children = parent.get('children')
        if isinstance(parent_children, list):
            parent_children.append(node)

    has_symbolic_hierarchy = any(str(field.get('parent_symbol', '')).strip() for field in fields)
    if has_symbolic_hierarchy:
        for field in sorted(fields, key=lambda item: str(item.get('label', ''))):
            label = str(field.get('label', '')).strip()
            if not label:
                continue

            oid = str(field.get('oid', '')).strip() or None
            oid_type = str(field.get('oid_type', 'singlevalue'))
            chain = _build_symbol_chain(label)
            parent_key: str | None = None

            for index, segment in enumerate(chain):
                branch_key = f"symbol:{'/'.join(chain[: index + 1])}"
                is_leaf = index == len(chain) - 1
                if is_leaf:
                    leaf_key = f"field:{label}:{oid or 'na'}"
                    if leaf_key not in node_lookup:
                        leaf_node = {
                            'node_key': leaf_key,
                            'display_name': label,
                            'node_kind': 'field',
                            'oid': oid,
                            'label': label,
                            'oid_type': oid_type,
                            'children': [],
                        }
                        node_lookup[leaf_key] = leaf_node
                        if parent_key is None:
                            roots.append(leaf_node)
                        else:
                            parent = node_lookup.get(parent_key)
                            if parent is not None:
                                parent_children = parent.get('children')
                                if isinstance(parent_children, list):
                                    parent_children.append(leaf_node)
                    continue

                _ensure_branch(branch_key, segment, parent_key)
                parent_key = branch_key
    else:
        # Fallback for legacy records lacking parent_symbol metadata.
        grouped: dict[str, list[dict[str, Any]]] = {}
        for field in fields:
            group = str(field.get('oid_type', 'singlevalue'))
            grouped.setdefault(group, []).append(field)

        for group_name in sorted(grouped.keys()):
            branch_key = f"group:{group_name}"
            _ensure_branch(branch_key, group_name, None)
            for field in sorted(grouped[group_name], key=lambda item: str(item.get('label', ''))):
                label = str(field.get('label', '')).strip()
                if not label:
                    continue
                oid = str(field.get('oid', '')).strip() or None
                leaf_key = f"field:{label}:{oid or 'na'}"
                if leaf_key in node_lookup:
                    continue
                leaf_node = {
                    'node_key': leaf_key,
                    'display_name': label,
                    'node_kind': 'field',
                    'oid': oid,
                    'label': label,
                    'oid_type': str(field.get('oid_type', 'singlevalue')),
                    'children': [],
                }
                node_lookup[leaf_key] = leaf_node
                parent = node_lookup.get(branch_key)
                if parent is not None:
                    parent_children = parent.get('children')
                    if isinstance(parent_children, list):
                        parent_children.append(leaf_node)

    return roots


def _flatten_module_tree(tree: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    order = 0

    def _walk(nodes: list[dict[str, Any]], parent_key: str | None, depth: int) -> None:
        nonlocal order
        for node in nodes:
            node_key = str(node.get('node_key', ''))
            if node_key == '':
                continue
            rows.append(
                {
                    'node_key': node_key,
                    'parent_node_key': parent_key,
                    'display_name': str(node.get('display_name', node_key)),
                    'node_kind': str(node.get('node_kind', 'branch')),
                    'oid': None if node.get('oid') is None else str(node.get('oid')),
                    'label': None if node.get('label') is None else str(node.get('label')),
                    'oid_type': None if node.get('oid_type') is None else str(node.get('oid_type')),
                    'depth': depth,
                    'sort_order': order,
                }
            )
            order += 1
            children = node.get('children')
            if isinstance(children, list) and len(children) > 0:
                _walk(children, node_key, depth + 1)

    _walk(tree, None, 0)
    return rows


def _build_module_tree_from_rows(rows: list[tuple[Any, ...]]) -> list[dict[str, Any]]:
    nodes: dict[str, dict[str, Any]] = {}
    roots: list[dict[str, Any]] = []

    for node_key, parent_node_key, display_name, node_kind, oid, label, oid_type in rows:
        nodes[str(node_key)] = {
            'node_key': str(node_key),
            'display_name': str(display_name),
            'node_kind': str(node_kind),
            'oid': None if oid is None else str(oid),
            'label': None if label is None else str(label),
            'oid_type': None if oid_type is None else str(oid_type),
            'children': [],
        }

    for node_key, parent_node_key, *_ in rows:
        current = nodes[str(node_key)]
        if parent_node_key is None:
            roots.append(current)
            continue

        parent = nodes.get(str(parent_node_key))
        if parent is None:
            roots.append(current)
            continue
        parent_children = parent.get('children')
        if isinstance(parent_children, list):
            parent_children.append(current)

    return roots


def _is_legacy_oid_tree_rows(rows: list[tuple[Any, ...]]) -> bool:
    if len(rows) == 0:
        return False
    for node_key, *_ in rows:
        normalized_key = str(node_key).strip()
        if normalized_key == '':
            continue
        if not all(part.isdigit() for part in normalized_key.split('.')):
            return False
    return True


def _infer_device_type(device_name: str) -> str:
    normalized = device_name.lower()
    for device_type in ['firewall', 'printer', 'switch', 'server', 'router', 'ap']:
        if device_type in normalized:
            return device_type
    return 'router'


def _infer_device_name(path: Path, module_names: list[str], vendors: dict[str, dict[str, object]]) -> str:
    vendor_hits = [vendor for vendor, details in vendors.items() if len(details.get('mibs', [])) > 0]
    if vendor_hits:
        return vendor_hits[0]
    if module_names:
        return module_names[0]
    return path.name


def _serialize_modules(path: Path) -> list[dict[str, Any]]:
    modules = MibLoader.load_directory_metadata(path)
    return [
        {
            'name': module_name,
            'field_count': len(fields),
            'fields': [
                {
                    'oid': field.oid,
                    'label': field.label,
                    'oid_type': field.oid_type,
                    'parent_symbol': field.parent_symbol,
                }
                for field in fields
            ],
            'tree': _build_module_tree_from_fields(
                [
                    {
                        'oid': field.oid,
                        'label': field.label,
                        'oid_type': field.oid_type,
                        'parent_symbol': field.parent_symbol,
                    }
                    for field in fields
                ]
            ),
        }
        for module_name, fields in modules.items()
    ]


def _build_uploaded_device_record(path: Path) -> dict[str, Any] | None:
    modules = MibLoader.load_directory(path)
    if not modules:
        return None

    vendors = MibLoader.load_vendor_registry(path)
    module_names = sorted(module.name for module in modules.values())
    device_name = _infer_device_name(path, module_names, vendors)

    return {
        'device_name': device_name,
        'device_type': _infer_device_type(device_name),
        'path': str(path),
        'uploaded_at': datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
        'module_names': module_names,
    }


def _read_uploaded_devices() -> list[dict[str, Any]]:
    connection = _get_db_connection()
    try:
        rows = connection.execute(
            'SELECT device_name, device_type, path, uploaded_at, module_names_json FROM uploaded_devices ORDER BY uploaded_at DESC'
        ).fetchall()
    finally:
        connection.close()

    # Prefer DB as source of truth. If DB already has rows, avoid parsing
    # filesystem MIBs on every request, which can fail for malformed files.
    if rows:
        return [_row_to_uploaded_device(row) for row in rows]

    if not UPLOAD_ROOT.exists():
        return []

    # Bootstrap DB from filesystem only when DB is empty.
    for upload_dir in sorted((path for path in UPLOAD_ROOT.iterdir() if path.is_dir()), reverse=True):
        try:
            serialized_modules = _serialize_modules(upload_dir)
        except Exception:
            continue

        if len(serialized_modules) == 0:
            continue

        metadata_path = upload_dir / 'device.json'
        if metadata_path.exists():
            try:
                _upsert_uploaded_device(json.loads(metadata_path.read_text(encoding='utf-8')), serialized_modules)
                continue
            except (OSError, json.JSONDecodeError):
                pass

        legacy_record = _build_uploaded_device_record(upload_dir)
        if legacy_record is None:
            continue

        try:
            metadata_path.write_text(json.dumps(legacy_record, indent=2), encoding='utf-8')
        except OSError:
            pass

        try:
            _upsert_uploaded_device(legacy_record, serialized_modules)
        except Exception:
            continue

    connection = _get_db_connection()
    try:
        hydrated_rows = connection.execute(
            'SELECT device_name, device_type, path, uploaded_at, module_names_json FROM uploaded_devices ORDER BY uploaded_at DESC'
        ).fetchall()
    finally:
        connection.close()

    return [_row_to_uploaded_device(row) for row in hydrated_rows]


def _delete_uploaded_device(device_name: str) -> bool:
    connection = _get_db_connection()
    try:
        row = connection.execute(
            '''
            SELECT path
            FROM uploaded_devices
            WHERE device_name = ?
            ORDER BY uploaded_at DESC
            LIMIT 1
            ''',
            [device_name],
        ).fetchone()
        if row is None:
            return False

        path = row[0]
        connection.execute('DELETE FROM uploaded_mib_nodes WHERE path = ?', [path])
        connection.execute('DELETE FROM uploaded_mib_fields WHERE path = ?', [path])
        connection.execute('DELETE FROM uploaded_mib_modules WHERE path = ?', [path])
        connection.execute('DELETE FROM uploaded_devices WHERE path = ?', [path])
    finally:
        connection.close()

    upload_dir = Path(path)
    if upload_dir.exists():
        for child in upload_dir.rglob('*'):
            if child.is_file():
                child.unlink(missing_ok=True)
        for directory in sorted((item for item in upload_dir.rglob('*') if item.is_dir()), reverse=True):
            directory.rmdir()
        upload_dir.rmdir()
    return True


def _rename_uploaded_device(device_name: str, next_device_name: str) -> tuple[bool, str]:
    normalized_next_name = next_device_name.strip()
    if not normalized_next_name:
        return False, 'Device name cannot be empty'

    connection = _get_db_connection()
    try:
        row = connection.execute(
            '''
            SELECT path, device_type, uploaded_at, module_names_json
            FROM uploaded_devices
            WHERE device_name = ?
            ORDER BY uploaded_at DESC
            LIMIT 1
            ''',
            [device_name],
        ).fetchone()
        if row is None:
            return False, f'Unknown uploaded device: {device_name}'

        duplicate = connection.execute(
            '''
            SELECT 1
            FROM uploaded_devices
            WHERE device_name = ? AND path <> ?
            LIMIT 1
            ''',
            [normalized_next_name, row[0]],
        ).fetchone()
        if duplicate is not None:
            return False, f'Uploaded device already exists: {normalized_next_name}'

        connection.execute(
            '''
            UPDATE uploaded_devices
            SET device_name = ?
            WHERE path = ?
            ''',
            [normalized_next_name, row[0]],
        )
    finally:
        connection.close()

    metadata_path = Path(row[0]) / 'device.json'
    metadata_payload = {
        'device_name': normalized_next_name,
        'device_type': row[1],
        'path': row[0],
        'uploaded_at': row[2],
        'module_names': json.loads(row[3]),
    }
    try:
        if metadata_path.exists():
            existing_payload = json.loads(metadata_path.read_text(encoding='utf-8'))
            if isinstance(existing_payload, dict):
                metadata_payload.update(existing_payload)
        metadata_payload['device_name'] = normalized_next_name
        metadata_path.write_text(json.dumps(metadata_payload, indent=2), encoding='utf-8')
    except (OSError, json.JSONDecodeError):
        pass

    return True, normalized_next_name


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _list_db_tables(connection: duckdb.DuckDBPyConnection) -> list[str]:
    rows = connection.execute(
        '''
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
        ORDER BY table_name
        '''
    ).fetchall()
    return [str(row[0]) for row in rows]


def _read_db_table_data(table_name: str, limit: int = 200) -> dict[str, Any]:
    safe_limit = max(1, min(limit, 500))
    connection = _get_db_connection()
    try:
        tables = _list_db_tables(connection)
        if table_name not in tables:
            raise KeyError(table_name)

        quoted_table = _quote_identifier(table_name)
        column_rows = connection.execute(f"SELECT * FROM {quoted_table} LIMIT 0").description
        columns = [str(column[0]) for column in column_rows] if column_rows else []
        rows = connection.execute(f"SELECT * FROM {quoted_table} LIMIT ?", [safe_limit]).fetchall()

        serialized_rows = [
            [None if value is None else str(value) for value in row]
            for row in rows
        ]

        return {
            'database': UPLOAD_DB.stem,
            'table': table_name,
            'columns': columns,
            'rows': serialized_rows,
            'row_count': len(serialized_rows),
        }
    finally:
        connection.close()


class DeviceConfig(BaseModel):
    name: str = Field(min_length=1)
    device: str | None = None
    device_type: str | None = None
    vendor: str | None = None

    @model_validator(mode="after")
    def ensure_profile_selector(self) -> "DeviceConfig":
        has_vendor = bool(self.vendor)
        has_device = bool(self.device or self.device_type)
        if has_vendor == has_device:
            raise ValueError("Exactly one of 'vendor' or 'device'/'device_type' must be provided")
        return self


class LinkConfig(BaseModel):
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    link_type: str = "ethernet"


class PositionConfig(BaseModel):
    x: float
    y: float


class ViewportConfig(BaseModel):
    scale: float = 1.0
    pan_x: float = 0.0
    pan_y: float = 0.0


class UploadedDeviceRenameRequest(BaseModel):
    device_name: str = Field(min_length=1)


class SimulationRequest(BaseModel):
    mib_dir: str | None = None
    devices: list[DeviceConfig] = Field(min_length=1)
    topology: list[LinkConfig] = Field(default_factory=list)
    design_layout: dict[str, PositionConfig] = Field(default_factory=dict)
    design_viewport: ViewportConfig = Field(default_factory=ViewportConfig)

    @model_validator(mode="after")
    def ensure_unique_device_names(self) -> "SimulationRequest":
        names = [item.name for item in self.devices]
        unique_names = set(names)
        if len(unique_names) != len(names):
            raise ValueError("Each device name must be unique")
        return self


class CreateInstanceRequest(SimulationRequest):
    instance_name: str = Field(min_length=1, default="default-instance")


class SnmpGetRequest(BaseModel):
    device_name: str
    oid: str


class SnmpSetRequest(BaseModel):
    device_name: str
    oid: str
    value: str | int | float | bool


@dataclass
class SimulationInstance:
    instance_id: str
    instance_name: str
    simulator: Simulator
    topology: dict[str, Any]
    devices: list[dict[str, Any]]
    design_layout: dict[str, dict[str, float]]
    design_viewport: dict[str, float]
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EngineRegistry:
    def __init__(self) -> None:
        self.instances: dict[str, SimulationInstance] = {}

    def create(self, request: CreateInstanceRequest) -> SimulationInstance:
        simulator = Simulator()
        vendor_profiles = simulator.load_vendor_profiles_from_mib_directory(request.mib_dir) if request.mib_dir else {}
        registered = simulator.register_devices_from_config(
            [item.model_dump() for item in request.devices],
            vendor_profiles,
        )
        topology = simulator.build_topology([item.model_dump() for item in request.topology])
        instance = SimulationInstance(
            instance_id=str(uuid4()),
            instance_name=request.instance_name,
            simulator=simulator,
            topology=topology,
            devices=[
                {
                    "name": name,
                    "vendor": profile.vendor,
                    "device_type": profile.device_type,
                    "system_name": profile.system_name,
                }
                for name, profile in registered.items()
            ],
            design_layout={
                name: {"x": point.x, "y": point.y}
                for name, point in request.design_layout.items()
                if name in registered
            },
            design_viewport={
                "scale": request.design_viewport.scale,
                "pan_x": request.design_viewport.pan_x,
                "pan_y": request.design_viewport.pan_y,
            },
        )
        self.instances[instance.instance_id] = instance
        return instance

    def get(self, instance_id: str) -> SimulationInstance:
        instance = self.instances.get(instance_id)
        if instance is None:
            raise KeyError(f"Unknown simulation instance: {instance_id}")
        return instance

    def update(self, instance_id: str, request: CreateInstanceRequest) -> SimulationInstance:
        current = self.get(instance_id)
        simulator = Simulator()
        vendor_profiles = simulator.load_vendor_profiles_from_mib_directory(request.mib_dir) if request.mib_dir else {}
        registered = simulator.register_devices_from_config(
            [item.model_dump() for item in request.devices],
            vendor_profiles,
        )
        topology = simulator.build_topology([item.model_dump() for item in request.topology])
        updated = SimulationInstance(
            instance_id=current.instance_id,
            instance_name=request.instance_name,
            simulator=simulator,
            topology=topology,
            devices=[
                {
                    "name": name,
                    "vendor": profile.vendor,
                    "device_type": profile.device_type,
                    "system_name": profile.system_name,
                }
                for name, profile in registered.items()
            ],
            design_layout={
                name: {"x": point.x, "y": point.y}
                for name, point in request.design_layout.items()
                if name in registered
            },
            design_viewport={
                "scale": request.design_viewport.scale,
                "pan_x": request.design_viewport.pan_x,
                "pan_y": request.design_viewport.pan_y,
            },
            created_at=current.created_at,
        )
        self.instances[instance_id] = updated
        return updated

    def delete(self, instance_id: str) -> None:
        if instance_id not in self.instances:
            raise KeyError(f"Unknown simulation instance: {instance_id}")
        del self.instances[instance_id]


registry = EngineRegistry()
app = FastAPI(title="SNMP Simulator Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_init_uploaded_device_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/mibs/devices")
def list_uploaded_devices() -> list[dict[str, Any]]:
    return _read_uploaded_devices()


@app.delete("/api/mibs/devices/{device_name}")
def delete_uploaded_device(device_name: str) -> dict[str, str]:
    deleted = _delete_uploaded_device(device_name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown uploaded device: {device_name}")
    return {"status": "deleted", "device_name": device_name}


@app.put("/api/mibs/devices/{device_name}")
def rename_uploaded_device(device_name: str, payload: UploadedDeviceRenameRequest) -> dict[str, str]:
    renamed, result = _rename_uploaded_device(device_name, payload.device_name)
    if not renamed:
        if result.startswith('Unknown uploaded device:'):
            raise HTTPException(status_code=404, detail=result)
        if result.startswith('Uploaded device already exists:'):
            raise HTTPException(status_code=409, detail=result)
        raise HTTPException(status_code=400, detail=result)
    return {"status": "renamed", "device_name": result}


@app.get("/api/db/tree")
def get_db_tree() -> dict[str, Any]:
    connection = _get_db_connection()
    try:
        tables = _list_db_tables(connection)
    finally:
        connection.close()

    return {
        'databases': [
            {
                'name': UPLOAD_DB.stem,
                'tables': tables,
            }
        ]
    }


@app.get("/api/db/tables/{table_name}")
def get_db_table_data(table_name: str, limit: int = 200) -> dict[str, Any]:
    try:
        return _read_db_table_data(table_name, limit)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_name}")


@app.get("/api/mibs/devices/{device_name}/tree")
def get_uploaded_device_tree(device_name: str) -> dict[str, Any]:
    connection = _get_db_connection()
    try:
        row = connection.execute(
            '''
            SELECT device_name, device_type, path, uploaded_at, module_names_json
            FROM uploaded_devices
            WHERE device_name = ?
            ORDER BY uploaded_at DESC
            LIMIT 1
            ''',
            [device_name],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Unknown uploaded device: {device_name}")

        modules = connection.execute(
            '''
            SELECT module_name, field_count
            FROM uploaded_mib_modules
            WHERE path = ?
            ORDER BY module_name
            ''',
            [row[2]],
        ).fetchall()

        serialized_modules: list[dict[str, Any]] = []
        for module_name, field_count in modules:
            fields = connection.execute(
                '''
                SELECT oid, label, COALESCE(oid_type, 'singlevalue')
                FROM uploaded_mib_fields
                WHERE path = ? AND module_name = ?
                ORDER BY oid
                ''',
                [row[2], module_name],
            ).fetchall()

            tree_rows = connection.execute(
                '''
                SELECT node_key, parent_node_key, display_name, node_kind, oid, label, oid_type
                FROM uploaded_mib_nodes
                WHERE path = ? AND module_name = ?
                ORDER BY depth, sort_order, node_key
                ''',
                [row[2], module_name],
            ).fetchall()

            if _is_legacy_oid_tree_rows(tree_rows):
                try:
                    regenerated_modules = _serialize_modules(Path(row[2]))
                    regenerated_module = next((module for module in regenerated_modules if module.get('name') == module_name), None)
                except Exception:
                    regenerated_module = None

                if regenerated_module is not None:
                    regenerated_tree = regenerated_module.get('tree')
                    if isinstance(regenerated_tree, list):
                        connection.execute(
                            'DELETE FROM uploaded_mib_nodes WHERE path = ? AND module_name = ?',
                            [row[2], module_name],
                        )
                        for node_row in _flatten_module_tree(regenerated_tree):
                            connection.execute(
                                '''
                                INSERT INTO uploaded_mib_nodes (
                                    path, module_name, node_key, parent_node_key, display_name, node_kind,
                                    oid, label, oid_type, depth, sort_order
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ''',
                                (
                                    row[2],
                                    module_name,
                                    node_row['node_key'],
                                    node_row['parent_node_key'],
                                    node_row['display_name'],
                                    node_row['node_kind'],
                                    node_row['oid'],
                                    node_row['label'],
                                    node_row['oid_type'],
                                    node_row['depth'],
                                    node_row['sort_order'],
                                ),
                            )
                        tree_rows = connection.execute(
                            '''
                            SELECT node_key, parent_node_key, display_name, node_kind, oid, label, oid_type
                            FROM uploaded_mib_nodes
                            WHERE path = ? AND module_name = ?
                            ORDER BY depth, sort_order, node_key
                            ''',
                            [row[2], module_name],
                        ).fetchall()

            if len(tree_rows) > 0:
                tree = _build_module_tree_from_rows(tree_rows)
            else:
                fallback_fields = [
                    {
                        'oid': oid,
                        'label': label,
                        'oid_type': oid_type,
                    }
                    for oid, label, oid_type in fields
                ]
                tree = _build_module_tree_from_fields(fallback_fields)
                for node_row in _flatten_module_tree(tree):
                    connection.execute(
                        '''
                        INSERT OR REPLACE INTO uploaded_mib_nodes (
                            path, module_name, node_key, parent_node_key, display_name, node_kind,
                            oid, label, oid_type, depth, sort_order
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''',
                        (
                            row[2],
                            module_name,
                            node_row['node_key'],
                            node_row['parent_node_key'],
                            node_row['display_name'],
                            node_row['node_kind'],
                            node_row['oid'],
                            node_row['label'],
                            node_row['oid_type'],
                            node_row['depth'],
                            node_row['sort_order'],
                        ),
                    )

            serialized_modules.append(
                {
                    'name': module_name,
                    'field_count': field_count,
                    'fields': [
                        {
                            'oid': oid,
                            'label': label,
                            'oid_type': oid_type,
                        }
                        for oid, label, oid_type in fields
                    ],
                    'tree': tree,
                }
            )

        return {
            'device_name': row[0],
            'device_type': row[1],
            'path': row[2],
            'uploaded_at': row[3],
            'modules': serialized_modules,
        }
    finally:
        connection.close()


@app.post("/api/mibs/upload")
async def upload_mibs(
    device_name: str = Form(...),
    device_type: str | None = Form(None),
    files: list[UploadFile] = File(...)
) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="At least one MIB file must be uploaded")
    if device_name.strip() == '':
        raise HTTPException(status_code=400, detail='Device name is required')

    upload_dir = UPLOAD_ROOT / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_files: list[Path] = []

    for file in files:
        filename = Path(file.filename or "uploaded.mib").name
        target = upload_dir / filename
        content = await file.read()
        if not content:
            continue
        target.write_bytes(content)
        saved_files.append(target)

    if not saved_files:
        raise HTTPException(status_code=400, detail="No readable MIB files were uploaded")

    modules = MibLoader.load_directory(upload_dir)
    if not modules:
        raise HTTPException(status_code=400, detail="No valid MIB definitions were found in the uploaded files")

    normalized_device_type = (device_type or '').strip().lower()

    device_record = {
        'device_name': device_name.strip(),
        'device_type': normalized_device_type if normalized_device_type else _infer_device_type(device_name.strip()),
        'path': str(upload_dir),
        'uploaded_at': datetime.now(timezone.utc).isoformat(),
        'module_names': sorted(module.name for module in modules.values()),
    }
    (upload_dir / 'device.json').write_text(json.dumps(device_record, indent=2), encoding='utf-8')
    serialized_modules = _serialize_modules(upload_dir)
    _upsert_uploaded_device(device_record, serialized_modules)

    return {
        "path": str(upload_dir),
        "device_name": device_record['device_name'],
        "device_type": device_record['device_type'],
        "modules": serialized_modules,
        "vendors": MibLoader.load_vendor_registry(upload_dir),
    }


def _serialize_instance(instance: SimulationInstance) -> dict[str, Any]:
    return {
        "instance_id": instance.instance_id,
        "instance_name": instance.instance_name,
        "created_at": instance.created_at,
        "devices": instance.devices,
        "topology": instance.topology,
        "design_layout": instance.design_layout,
        "design_viewport": instance.design_viewport,
    }


@app.post("/api/instances")
def create_instance(request: CreateInstanceRequest) -> dict[str, Any]:
    try:
        instance = registry.create(request)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _serialize_instance(instance)


@app.get("/api/instances")
def list_instances() -> list[dict[str, Any]]:
    return [
        {
            "instance_id": instance.instance_id,
            "instance_name": instance.instance_name,
            "created_at": instance.created_at,
            "device_count": len(instance.devices),
        }
        for instance in registry.instances.values()
    ]


@app.get("/api/instances/{instance_id}")
def get_instance(instance_id: str) -> dict[str, Any]:
    try:
        instance = registry.get(instance_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip('"')) from exc
    return _serialize_instance(instance)


@app.put("/api/instances/{instance_id}")
def update_instance(instance_id: str, request: CreateInstanceRequest) -> dict[str, Any]:
    try:
        instance = registry.update(instance_id, request)
    except (KeyError, ValueError) as exc:
        status_code = 404 if isinstance(exc, KeyError) else 400
        raise HTTPException(status_code=status_code, detail=str(exc).strip('"')) from exc
    return _serialize_instance(instance)


@app.delete("/api/instances/{instance_id}")
def delete_instance(instance_id: str) -> dict[str, str]:
    try:
        registry.delete(instance_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip('"')) from exc
    return {"status": "deleted", "instance_id": instance_id}


@app.get("/api/instances/{instance_id}/topology")
def get_topology(instance_id: str) -> dict[str, Any]:
    try:
        return registry.get(instance_id).topology
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip('"')) from exc


@app.post("/api/instances/{instance_id}/snmp/get")
def snmp_get(instance_id: str, payload: SnmpGetRequest) -> dict[str, Any]:
    try:
        value = registry.get(instance_id).simulator.get_oid_value(payload.device_name, payload.oid)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("\"")) from exc

    return {
        "instance_id": instance_id,
        "operation": "get",
        "device": payload.device_name,
        "oid": payload.oid,
        "value": value,
    }


@app.post("/api/instances/{instance_id}/snmp/set")
def snmp_set(instance_id: str, payload: SnmpSetRequest) -> dict[str, Any]:
    try:
        value = registry.get(instance_id).simulator.set_oid_value(payload.device_name, payload.oid, payload.value)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("\"")) from exc

    return {
        "instance_id": instance_id,
        "operation": "set",
        "device": payload.device_name,
        "oid": payload.oid,
        "value": value,
    }


def run(host: str = "127.0.0.1", port: int = 8000, log_level: Literal["info", "debug"] = "info") -> None:
    import uvicorn

    uvicorn.run("api:app", host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    run()
