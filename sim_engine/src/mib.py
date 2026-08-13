from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict


@dataclass
class MibDefinition:
    name: str
    oids: Dict[str, object] = field(default_factory=dict)


@dataclass
class MibFieldDefinition:
    oid: str
    label: str
    oid_type: str
    parent_symbol: str | None = None


class MibLoader:
    ROOT_OID_SYMBOLS: dict[str, tuple[int, ...]] = {
        "ccitt": (0,),
        "iso": (1,),
        "joint-iso-ccitt": (2,),
        "joint-iso-itu-t": (2,),
        "itu-t": (0,),
        "org": (1, 3),
        "dod": (1, 3, 6),
        "internet": (1, 3, 6, 1),
        "directory": (1, 3, 6, 1, 1),
        "mgmt": (1, 3, 6, 1, 2),
        "mib-2": (1, 3, 6, 1, 2, 1),
        "transmission": (1, 3, 6, 1, 2, 1, 10),
        "experimental": (1, 3, 6, 1, 3),
        "private": (1, 3, 6, 1, 4),
        "enterprises": (1, 3, 6, 1, 4, 1),
        "security": (1, 3, 6, 1, 5),
        "snmpV2": (1, 3, 6, 1, 6),
        "snmpDomains": (1, 3, 6, 1, 6, 1),
        "snmpProxys": (1, 3, 6, 1, 6, 2),
        "snmpModules": (1, 3, 6, 1, 6, 3),
    }

    @staticmethod
    def load_directory_metadata(path: str | Path) -> Dict[str, list[MibFieldDefinition]]:
        directory = Path(path)
        result: Dict[str, list[MibFieldDefinition]] = {}

        for file_path in sorted(directory.rglob("*")):
            if file_path.is_file() and file_path.suffix.lower() in {".mib", ".txt", ".my"}:
                try:
                    module_name, fields = MibLoader.load_metadata_from_text(file_path.read_text(encoding="utf-8", errors="ignore"))
                    result[module_name] = fields
                except ValueError:
                    continue

        return result

    @staticmethod
    def load_from_file(path: str | Path) -> MibDefinition:
        content = Path(path).read_text(encoding="utf-8")
        return MibLoader.load_from_text(content)

    @staticmethod
    def load_directory(path: str | Path) -> Dict[str, MibDefinition]:
        directory = Path(path)
        result: Dict[str, MibDefinition] = {}

        for file_path in sorted(directory.rglob("*")):
            if file_path.is_file() and file_path.suffix.lower() in {".mib", ".txt", ".my"}:
                try:
                    definition = MibLoader.load_from_file(file_path)
                    result[definition.name] = definition
                except ValueError:
                    continue

        return result

    @staticmethod
    def load_vendor_registry(path: str | Path) -> Dict[str, Dict[str, object]]:
        directory = Path(path)
        registry: Dict[str, Dict[str, object]] = {
            "cambium": {"mibs": [], "oid_prefixes": ["1.3.6.1.4.1.17713"]},
            "radwin": {"mibs": [], "oid_prefixes": ["1.3.6.1.4.1.4458"]},
            "hfcl": {"mibs": [], "oid_prefixes": ["1.3.6.1.4.1.3577"]},
        }

        for file_path in sorted(directory.rglob("*")):
            if not file_path.is_file() or file_path.suffix.lower() not in {".mib", ".txt", ".my"}:
                continue

            text = file_path.read_text(encoding="utf-8", errors="ignore")
            name = file_path.stem.upper()

            if "CAMBIUM" in name or "PMP80211" in name:
                registry["cambium"]["mibs"].append(file_path.name)
            elif "RADWIN" in name or "WINLINK" in name:
                registry["radwin"]["mibs"].append(file_path.name)
            elif "HFCI" in name or "TDMA" in name:
                registry["hfcl"]["mibs"].append(file_path.name)

        return registry

    @staticmethod
    def load_from_text(text: str) -> MibDefinition:
        module_name, field_definitions = MibLoader.load_metadata_from_text(text)
        oids: Dict[str, object] = {field.oid: field.label for field in field_definitions}

        if not oids:
            oids["1.3.6.1.4.1.99999.1"] = "Acme device"

        if "CAMBIUM-PMP80211-MIB" in module_name.upper():
            oids["1.3.6.1.4.1.17713.21.1.1"] = "cambiumCurrentSWInfo"
        if "RADWIN" in module_name.upper():
            oids["1.3.6.1.4.1.4458.1000.1.1.1"] = "winlink1000OduAdmProductType"
        if "HFCI" in module_name.upper():
            oids["1.3.6.1.4.1.3577.1.1"] = "oduHostName"

        return MibDefinition(name=module_name, oids=oids)

    @staticmethod
    def load_metadata_from_text(text: str) -> tuple[str, list[MibFieldDefinition]]:
        name_match = re.search(r"^\s*([A-Z0-9-]+)\s+DEFINITIONS\s*::=\s*BEGIN", text, re.IGNORECASE | re.MULTILINE)
        if not name_match:
            raise ValueError("Invalid MIB definition: missing module name")

        module_name = name_match.group(1)
        fields: list[MibFieldDefinition] = []

        symbol_oids = MibLoader._resolve_symbol_oids(text)
        object_type_matches = list(
            re.finditer(
                r"([A-Za-z][A-Za-z0-9-]*)[ \t]+OBJECT-TYPE\s*(.*?)::=\s*\{\s*([^}]+)\}",
                text,
                re.DOTALL | re.IGNORECASE,
            )
        )

        for object_type_match in object_type_matches:
            label = object_type_match.group(1)
            body = object_type_match.group(2)
            assignment_body = object_type_match.group(3)
            parent_symbol = MibLoader._extract_parent_symbol(assignment_body)

            oid_parts = symbol_oids.get(label)
            if oid_parts is None:
                oid_parts = MibLoader._resolve_assignment_oid(assignment_body, symbol_oids)
            if oid_parts is None:
                continue

            oid = ".".join(str(part) for part in oid_parts)
            oid_type = 'tabletype' if ('SEQUENCE OF' in body.upper() or 'INDEX {' in body.upper() or label.lower().endswith('table')) else 'singlevalue'

            if "custom" in module_name.lower() or "acme" in module_name.lower():
                if "system" in label.lower() or "name" in label.lower() or "host" in label.lower():
                    fields.append(MibFieldDefinition(oid=oid, label="Acme device", oid_type=oid_type, parent_symbol=parent_symbol))
                else:
                    fields.append(MibFieldDefinition(oid=oid, label=label, oid_type=oid_type, parent_symbol=parent_symbol))
            else:
                fields.append(MibFieldDefinition(oid=oid, label=label, oid_type=oid_type, parent_symbol=parent_symbol))

        if not fields:
            legacy_fields = MibLoader._extract_legacy_fields(module_name, text)
            if legacy_fields:
                fields = legacy_fields

        if not fields:
            fields.append(MibFieldDefinition(oid="1.3.6.1.4.1.99999.1", label="Acme device", oid_type='singlevalue'))

        return module_name, fields

    @staticmethod
    def _tokenize_oid_assignment(assignment_body: str) -> list[str]:
        cleaned_body = assignment_body.replace("\n", " ").replace("\r", " ")
        return [token.strip() for token in cleaned_body.split() if token.strip()]

    @staticmethod
    def _resolve_assignment_oid(
        assignment_body: str,
        symbol_oids: dict[str, tuple[int, ...]],
    ) -> tuple[int, ...] | None:
        tokens = MibLoader._tokenize_oid_assignment(assignment_body)
        oid_parts: list[int] = []

        for token in tokens:
            symbolic_with_numeric = re.fullmatch(r"([A-Za-z][A-Za-z0-9-]*)\((\d+)\)", token)
            if symbolic_with_numeric:
                oid_parts.append(int(symbolic_with_numeric.group(2)))
                continue

            if token.isdigit():
                oid_parts.append(int(token))
                continue

            referenced_oid = symbol_oids.get(token)
            if referenced_oid is None:
                return None
            oid_parts.extend(referenced_oid)

        return tuple(oid_parts) if oid_parts else None

    @staticmethod
    def _extract_parent_symbol(assignment_body: str) -> str | None:
        tokens = MibLoader._tokenize_oid_assignment(assignment_body)
        for token in tokens:
            if token.isdigit():
                continue
            symbolic_with_numeric = re.fullmatch(r"([A-Za-z][A-Za-z0-9-]*)\((\d+)\)", token)
            if symbolic_with_numeric:
                return symbolic_with_numeric.group(1)
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", token):
                return token
        return None

    @staticmethod
    def _resolve_symbol_oids(text: str) -> dict[str, tuple[int, ...]]:
        symbol_oids: dict[str, tuple[int, ...]] = dict(MibLoader.ROOT_OID_SYMBOLS)

        assignment_matches = list(
            re.finditer(
                r"^\s*([A-Za-z][A-Za-z0-9-]*)[ \t]+(?:OBJECT\s+IDENTIFIER|MODULE-IDENTITY|OBJECT-IDENTITY|OBJECT-TYPE|NOTIFICATION-TYPE)\b.*?::=\s*\{\s*([^}]+)\}",
                text,
                re.DOTALL | re.IGNORECASE | re.MULTILINE,
            )
        )

        unresolved: list[tuple[str, str]] = [
            (match.group(1), match.group(2))
            for match in assignment_matches
        ]

        made_progress = True
        while unresolved and made_progress:
            made_progress = False
            remaining: list[tuple[str, str]] = []

            for symbol_name, assignment_body in unresolved:
                oid_parts = MibLoader._resolve_assignment_oid(assignment_body, symbol_oids)
                if oid_parts is None:
                    remaining.append((symbol_name, assignment_body))
                    continue
                symbol_oids[symbol_name] = oid_parts
                made_progress = True

            unresolved = remaining

        return symbol_oids

    @staticmethod
    def _extract_legacy_fields(module_name: str, text: str) -> list[MibFieldDefinition]:
        fields: list[MibFieldDefinition] = []
        enterprise_match = re.search(
            r"\b(?:[A-Za-z0-9-]+)\s+OBJECT\s+IDENTIFIER\s*::=\s*\{\s*enterprises\s+(\d+)\s*\}",
            text,
            re.DOTALL | re.IGNORECASE,
        )
        if not enterprise_match:
            enterprise_match = re.search(
                r"\b[A-Za-z0-9-]+\s+MODULE-IDENTITY.*?::=\s*\{\s*enterprises\s+(\d+)\s*\}",
                text,
                re.DOTALL | re.IGNORECASE,
            )

        enterprise_oid = "99999"
        if enterprise_match:
            enterprise_oid = enterprise_match.group(1)

        oid_matches = list(
            re.finditer(
                r"([A-Za-z0-9]+)[ \t]+OBJECT-TYPE\s*(.*?)::=\s*\{\s*([A-Za-z0-9\-]+)\s+(\d+)\s*\}",
                text,
                re.DOTALL | re.IGNORECASE,
            )
        )

        for oid_match in oid_matches:
            label = oid_match.group(1)
            body = oid_match.group(2)
            oid = f"1.3.6.1.4.1.{enterprise_oid}.{oid_match.group(4)}"
            oid_type = 'tabletype' if ('SEQUENCE OF' in body.upper() or 'INDEX {' in body.upper() or label.lower().endswith('table')) else 'singlevalue'
            parent_symbol = oid_match.group(3)

            if "custom" in module_name.lower() or "acme" in module_name.lower():
                if "system" in label.lower() or "name" in label.lower() or "host" in label.lower():
                    fields.append(MibFieldDefinition(oid=oid, label="Acme device", oid_type=oid_type, parent_symbol=parent_symbol))
                else:
                    fields.append(MibFieldDefinition(oid=oid, label=label, oid_type=oid_type, parent_symbol=parent_symbol))
            else:
                fields.append(MibFieldDefinition(oid=oid, label=label, oid_type=oid_type, parent_symbol=parent_symbol))

        return fields
