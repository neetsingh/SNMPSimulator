# SNMPSimulator Monorepo

This repository now contains two connected applications:

- sim_engine: Python SNMP simulation engine and API
- sim_ui: Angular dashboard to control configuration, topology, SNMP GET, and SNMP SET

## Structure

- [sim_engine](sim_engine): backend logic, CLI, API, tests
- [sim_ui](sim_ui): frontend visual control panel

## Run Backend

```bash
cd sim_engine
.\.venv\Scripts\python.exe -m pip install -e .
cd src
..\.venv\Scripts\python.exe .\api.py
```

The backend listens on:

```text
http://127.0.0.1:8000/api
```

## Run Frontend

```bash
cd sim_ui
npm install
npm start
```

The UI runs on:

```text
http://localhost:4200
```

## Typical Workflow

1. Start sim_engine API.
2. Start sim_ui Angular app.
3. Open the UI and paste device and topology JSON.
4. Run simulation from the UI.
5. Use UI controls for SNMP GET and SNMP SET.
