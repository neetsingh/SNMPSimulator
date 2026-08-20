## POC Capacity Planning

This workbook contains the recalibrated POC capacity table for the GIS/SNMP Simulator stack.

### Assumptions
- Raw table size: ~300 GB
- Aggregate table size: ~100 GB
- PostgreSQL is sized with headroom for indexes, WAL, vacuum overhead, and future growth
- The CSV sheet can be opened directly in Excel

### Files
- `recalibrated-poc-capacity-table-postgres-updated.csv`
