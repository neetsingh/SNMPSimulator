import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface SimulatedDevice {
  name: string;
  vendor: string;
  device_type: string;
  system_name: string;
}

export interface TopologyLink {
  source: string;
  target: string;
  link_type: string;
}

export interface TopologyModel {
  nodes: Array<{ name: string; vendor: string; device_type: string }>;
  links: TopologyLink[];
  neighbors: Record<string, string[]>;
}

interface SimulationInstanceResponse {
  instance_id: string;
  instance_name: string;
  created_at: string;
  devices: SimulatedDevice[];
  topology: TopologyModel;
  design_layout: Record<string, { x: number; y: number }>;
  design_viewport: { scale: number; pan_x: number; pan_y: number };
}

export interface SimulationInstanceSummary {
  instance_id: string;
  instance_name: string;
  created_at: string;
  device_count: number;
}

interface SnmpOperationResponse {
  instance_id: string;
  operation: string;
  device: string;
  oid: string;
  value: string | number;
}

export interface MibField {
  oid: string;
  label: string;
  oid_type: string;
  parent_symbol?: string | null;
}

export interface MibTreeNode {
  node_key: string;
  display_name: string;
  node_kind: 'branch' | 'field';
  oid: string | null;
  label: string | null;
  oid_type: string | null;
  children: MibTreeNode[];
}

export interface MibModule {
  name: string;
  field_count: number;
  fields: MibField[];
  tree: MibTreeNode[];
}

export interface UploadedDeviceSummary {
  device_name: string;
  device_type: string;
  path: string;
  uploaded_at: string;
  module_names: string[];
}

export interface DbTreeEntry {
  name: string;
  tables: string[];
}

interface DbTreeResponse {
  databases: DbTreeEntry[];
}

export interface DbTableData {
  database: string;
  table: string;
  columns: string[];
  rows: string[][];
  row_count: number;
}

interface MibUploadResponse {
  path: string;
  device_name: string;
  device_type: string;
  modules: MibModule[];
  vendors: Record<string, { mibs: string[]; oid_prefixes: string[] }>;
}

export interface ConsoleEntry {
  timestamp: string;
  level: 'info' | 'error';
  message: string;
}

export type DeviceSelectorKind = 'device' | 'vendor';

export interface DeviceCardConfig {
  draft_id: string;
  name: string;
  selector_kind: DeviceSelectorKind;
  selector_value: string;
  uploaded_device_name?: string;
  ip_address?: string;
  port_number?: number | null;
}

export interface ConnectionDraft {
  draft_id: string;
  source_draft_id: string;
  target_draft_id: string;
  link_type: string;
  line_style: ConnectionLineStyle;
}

export type ConnectionLineStyle = 'curve' | 'elbow' | 'straight';

export interface PaletteItem {
  label: string;
  selector_kind: DeviceSelectorKind;
  selector_value: string;
}

type ConfigValidationResult = {
  valid: boolean;
  errors: string[];
};

export type TopologyTemplate = 'hub-spoke' | 'ring' | 'branch';

type LayoutDocument = {
  width: number;
  height: number;
  positions: Record<string, { x: number; y: number }>;
};

@Injectable({ providedIn: 'root' })
export class SimulatorStateService {
  apiBaseUrl = 'http://127.0.0.1:8000/api';
  uploadedMibDir = '';
  instanceName = 'default-instance';
  activeInstanceId = '';
  activeInstanceName = '';
  selectedTemplate: TopologyTemplate = 'hub-spoke';
  availableDeviceTypes = ['router', 'switch', 'firewall', 'printer', 'ap', 'server'];
  availableVendors = ['cambium', 'radwin', 'hfcl'];
  availableLinkTypes = ['ethernet', 'wireless', 'fiber'];
  paletteItems: PaletteItem[] = [
    { label: 'Router', selector_kind: 'device', selector_value: 'router' },
    { label: 'Switch', selector_kind: 'device', selector_value: 'switch' },
    { label: 'Firewall', selector_kind: 'device', selector_value: 'firewall' },
    { label: 'Printer', selector_kind: 'device', selector_value: 'printer' },
    { label: 'Access Point', selector_kind: 'device', selector_value: 'ap' },
    { label: 'Server', selector_kind: 'device', selector_value: 'server' },
    { label: 'Cambium', selector_kind: 'vendor', selector_value: 'cambium' },
    { label: 'Radwin', selector_kind: 'vendor', selector_value: 'radwin' },
    { label: 'HFCL', selector_kind: 'vendor', selector_value: 'hfcl' }
  ];
  graphWidth = 860;
  graphHeight = 420;
  draftCanvasWidth = 860;
  draftCanvasHeight = 420;
  draftViewport = { scale: 1, panX: 0, panY: 0 };
  isCanvasPanning = false;
  canvasPanOrigin = { x: 0, y: 0, panX: 0, panY: 0 };
  selectedConsoleDevice = '';
  selectedMibModuleName = '';
  selectedMibFieldOid = '';
  selectedSetValue = 'updated';
  status = 'Waiting for simulation input';
  validationErrors: string[] = [];
  inspectorTab: 'node' | 'link' = 'node';
  getResult = '';
  setResult = '';
  layoutJson = '';
  deviceCards: DeviceCardConfig[] = [];
  connectionDrafts: ConnectionDraft[] = [];
  devices: SimulatedDevice[] = [];
  instances: SimulationInstanceSummary[] = [];
  uploadedDevices: UploadedDeviceSummary[] = [];
  mibModules: MibModule[] = [];
  consoleEntries: ConsoleEntry[] = [];
  topology: TopologyModel = { nodes: [], links: [], neighbors: {} };
  nodePositions: Record<string, { x: number; y: number }> = {};
  draggingNodeName: string | null = null;
  draftPositions: Record<string, { x: number; y: number }> = {};
  draggingDraftId = '';
  suppressNextConnectorSelection = false;
  pendingConnectorSourceDraftId = '';
  pendingConnectorLinkType = '';
  pendingConnectorPointer: { x: number; y: number } | null = null;
  recentlyConnectedDraftIds: string[] = [];
  selectedDraftDeviceId = '';
  selectedConnectionDraftId = '';
  private draftSequence = 0;
  private connectionHighlightTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly http: HttpClient) {}

  refreshUploadedDevices(onSuccess?: () => void): void {
    this.http.get<UploadedDeviceSummary[]>(`${this.apiBaseUrl}/mibs/devices`).subscribe({
      next: (response) => {
        this.uploadedDevices = response;
        onSuccess?.();
      },
      error: () => {
        this.status = 'Failed to refresh uploaded devices';
      }
    });
  }

  deleteUploadedDevice(deviceName: string, onSuccess?: () => void): void {
    this.http.delete<{ status: string; device_name: string }>(`${this.apiBaseUrl}/mibs/devices/${encodeURIComponent(deviceName)}`).subscribe({
      next: () => {
        if (this.uploadedMibDir.includes(deviceName)) {
          this.uploadedMibDir = '';
        }
        this.refreshUploadedDevices(onSuccess);
        this.status = `Deleted uploaded device ${deviceName}`;
      },
      error: () => {
        this.status = `Failed to delete uploaded device ${deviceName}`;
      }
    });
  }

  renameUploadedDevice(deviceName: string, nextDeviceName: string, onSuccess?: () => void): void {
    const trimmedName = nextDeviceName.trim();
    if (!trimmedName) {
      this.status = 'Device name cannot be empty';
      return;
    }

    this.http.put<{ status: string; device_name: string }>(
      `${this.apiBaseUrl}/mibs/devices/${encodeURIComponent(deviceName)}`,
      { device_name: trimmedName }
    ).subscribe({
      next: (response) => {
        this.refreshUploadedDevices(onSuccess);
        this.status = `Renamed uploaded device ${deviceName} to ${response.device_name}`;
      },
      error: () => {
        this.status = `Failed to rename uploaded device ${deviceName}`;
      }
    });
  }

  fetchDbTree(onSuccess?: (response: DbTreeResponse) => void): void {
    this.http.get<DbTreeResponse>(`${this.apiBaseUrl}/db/tree`).subscribe({
      next: (response) => {
        onSuccess?.(response);
      },
      error: () => {
        this.status = 'Failed to load database tree';
      }
    });
  }

  fetchDbTableData(tableName: string, onSuccess?: (response: DbTableData) => void): void {
    this.http.get<DbTableData>(`${this.apiBaseUrl}/db/tables/${encodeURIComponent(tableName)}`).subscribe({
      next: (response) => {
        onSuccess?.(response);
      },
      error: () => {
        this.status = `Failed to load table data for ${tableName}`;
      }
    });
  }

  loadUploadedDeviceMibTree(deviceName: string): void {
    this.http.get<{ device_name: string; modules: MibModule[] }>(`${this.apiBaseUrl}/mibs/devices/${encodeURIComponent(deviceName)}/tree`).subscribe({
      next: (response) => {
        this.mibModules = response.modules;
        this.selectedMibModuleName = response.modules[0]?.name ?? '';
        this.selectedMibFieldOid = this.findFirstModuleFieldOid(response.modules[0]);
      },
      error: () => {
        this.clearLoadedMibTree();
        this.status = 'Failed to load selected device MIB tree';
      }
    });
  }

  clearLoadedMibTree(): void {
    this.mibModules = [];
    this.selectedMibModuleName = '';
    this.selectedMibFieldOid = '';
  }

  runSimulation(): void {
    const validation = this.validateConfiguration();
    if (!validation.valid) {
      this.validationErrors = validation.errors;
      this.status = 'Configuration validation failed';
      return;
    }

    const payload = {
      instance_name: this.buildInstanceName(),
      mib_dir: this.resolveMibDir(),
      devices: this.buildDevicePayload(),
      topology: this.buildTopologyPayload(),
      design_layout: this.buildDesignLayoutPayload(),
      design_viewport: this.buildDesignViewportPayload()
    };

    this.http.post<SimulationInstanceResponse>(`${this.apiBaseUrl}/instances`, payload).subscribe({
      next: (response) => {
        this.activeInstanceId = response.instance_id;
        this.activeInstanceName = response.instance_name;
        this.instanceName = response.instance_name;
        this.devices = response.devices;
        this.selectedConsoleDevice = response.devices[0]?.name ?? '';
        this.topology = response.topology;
        this.nodePositions = this.computeNodePositions(response.topology.nodes);
        this.applyPersistedDraftViewport(response.design_viewport);
        this.applyPersistedDraftPositions(response.design_layout);
        if (this.layoutJson.trim().length > 0) {
          try {
            this.applyLayoutToNodes(this.layoutJson, response.topology.nodes.map((node) => node.name));
          } catch (error) {
            this.status =
              error instanceof Error
                ? `Simulation complete, but layout was not applied: ${error.message}`
                : 'Simulation complete, but layout was not applied';
            this.validationErrors = [];
            this.getResult = '';
            this.setResult = '';
            return;
          }
        }
        this.refreshInstances();
        this.appendConsole('info', `Instance ${response.instance_name} created with ${response.devices.length} devices`);
        this.status = `Created instance ${response.instance_name} with ${response.devices.length} devices`;
        this.validationErrors = [];
        this.getResult = '';
        this.setResult = '';
      },
      error: (error) => {
        this.validationErrors = this.extractValidationErrors(error);
        this.status = this.extractError(error, 'Simulation failed');
      }
    });
  }

  refreshInstances(): void {
    this.http.get<SimulationInstanceSummary[]>(`${this.apiBaseUrl}/instances`).subscribe({
      next: (response) => {
        this.instances = response;
      },
      error: () => {
        this.status = 'Failed to refresh simulation instances';
      }
    });
  }

  loadInstance(instanceId: string): void {
    this.http.get<SimulationInstanceResponse>(`${this.apiBaseUrl}/instances/${instanceId}`).subscribe({
      next: (response) => {
        this.activeInstanceId = response.instance_id;
        this.activeInstanceName = response.instance_name;
        this.instanceName = response.instance_name;
        this.devices = response.devices;
        this.selectedConsoleDevice = response.devices[0]?.name ?? '';
        this.topology = response.topology;
        this.hydrateConfigurationCards(response.devices, response.topology.links);
        this.applyPersistedDraftViewport(response.design_viewport);
        this.applyPersistedDraftPositions(response.design_layout);
        this.nodePositions = this.computeNodePositions(response.topology.nodes);
        this.appendConsole('info', `Loaded instance ${response.instance_name}`);
        this.status = `Loaded instance ${response.instance_name}`;
      },
      error: (error) => {
        this.status = this.extractError(error, 'Failed to load simulation instance');
      }
    });
  }

  saveActiveInstance(): void {
    if (!this.ensureActiveInstance()) {
      return;
    }

    const validation = this.validateConfiguration();
    if (!validation.valid) {
      this.validationErrors = validation.errors;
      this.status = 'Configuration validation failed';
      return;
    }

    const payload = {
      instance_name: this.buildInstanceName(),
      mib_dir: this.resolveMibDir(),
      devices: this.buildDevicePayload(),
      topology: this.buildTopologyPayload(),
      design_layout: this.buildDesignLayoutPayload(),
      design_viewport: this.buildDesignViewportPayload()
    };

    this.http.put<SimulationInstanceResponse>(`${this.apiBaseUrl}/instances/${this.activeInstanceId}`, payload).subscribe({
      next: (response) => {
        this.activeInstanceName = response.instance_name;
        this.instanceName = response.instance_name;
        this.devices = response.devices;
        this.topology = response.topology;
        this.applyPersistedDraftViewport(response.design_viewport);
        this.applyPersistedDraftPositions(response.design_layout);
        this.nodePositions = this.computeNodePositions(response.topology.nodes);
        this.refreshInstances();
        this.appendConsole('info', `Saved instance ${response.instance_name}`);
        this.status = `Saved instance ${response.instance_name}`;
      },
      error: (error) => {
        this.validationErrors = this.extractValidationErrors(error);
        this.status = this.extractError(error, 'Failed to save simulation instance');
      }
    });
  }

  deleteInstance(instanceId: string): void {
    this.http.delete<{ status: string; instance_id: string }>(`${this.apiBaseUrl}/instances/${instanceId}`).subscribe({
      next: () => {
        if (this.activeInstanceId === instanceId) {
          this.activeInstanceId = '';
          this.activeInstanceName = '';
          this.devices = [];
          this.selectedConsoleDevice = '';
          this.topology = { nodes: [], links: [], neighbors: {} };
          this.nodePositions = {};
          this.draftViewport = { scale: 1, panX: 0, panY: 0 };
        }
        this.refreshInstances();
        this.appendConsole('info', 'Deleted simulation instance');
        this.status = 'Deleted simulation instance';
      },
      error: (error) => {
        this.status = this.extractError(error, 'Failed to delete simulation instance');
      }
    });
  }

  validateSimulationConfig(): void {
    const validation = this.validateConfiguration();
    this.validationErrors = validation.errors;
    this.status = validation.valid ? 'Configuration is valid' : 'Configuration validation failed';
  }

  applyTopologyTemplate(): void {
    const template = this.getTemplateData(this.selectedTemplate);
    this.hydrateConfigurationCards(template.devices, template.topology);
    this.nodePositions = {};
    this.draftPositions = {};
    this.draftViewport = { scale: 1, panX: 0, panY: 0 };
    this.layoutJson = '';
    this.validationErrors = [];
    this.status = `Applied ${this.selectedTemplate} template`;
  }

  uploadMibFiles(
    files: FileList | File[],
    deviceName: string,
    deviceType: string,
    onSuccess?: (response: MibUploadResponse) => void
  ): void {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) {
      this.status = 'Select one or more MIB files before uploading';
      return;
    }

    const formData = new FormData();
    formData.append('device_name', deviceName);
    formData.append('device_type', deviceType);
    selectedFiles.forEach((file) => formData.append('files', file));

    this.http.post<MibUploadResponse>(`${this.apiBaseUrl}/mibs/upload`, formData).subscribe({
      next: (response) => {
        this.uploadedMibDir = response.path;
        this.mibModules = response.modules;
        this.selectedMibModuleName = response.modules[0]?.name ?? '';
        this.selectedMibFieldOid = this.findFirstModuleFieldOid(response.modules[0]);
        this.appendConsole('info', `Uploaded ${selectedFiles.length} MIB files`);
        this.status = `Uploaded ${selectedFiles.length} MIB files`;
        this.refreshUploadedDevices(() => onSuccess?.(response));
      },
      error: (error) => {
        this.status = this.extractError(error, 'Failed to upload MIB files');
      }
    });
  }

  useDefaultDevices(): void {
    this.uploadedMibDir = '';
    this.status = 'Using default devices without MIB files';
  }

  addDeviceCard(): void {
    this.addPaletteDevice('device', 'router');
  }

  addPaletteDevice(selectorKind: DeviceSelectorKind, selectorValue: string, customName?: string, uploadedDeviceName?: string): void {
    const draftId = this.createDraftId('device');
    const autoIpAddress = this.getNextAvailableDraftIpAddress();
    const nextCard: DeviceCardConfig = {
      draft_id: draftId,
      name: this.generateDeviceName(selectorKind, selectorValue, draftId, customName),
      selector_kind: selectorKind,
      selector_value: selectorValue,
      uploaded_device_name: uploadedDeviceName,
      ip_address: autoIpAddress,
      port_number: 161
    };
    this.deviceCards = [...this.deviceCards, nextCard];
    this.draftPositions[draftId] = this.computeDraftPositionForIndex(this.deviceCards.length - 1);
    this.selectedDraftDeviceId = draftId;
    this.inspectorTab = 'node';
  }

  updateDraftDeviceNetworkConfig(draftId: string, ipAddress: string, portNumber: number | null): void {
    const nextIpAddress = ipAddress.trim();
    this.deviceCards = this.deviceCards.map((card) => {
      if (card.draft_id !== draftId) {
        return card;
      }

      return {
        ...card,
        ip_address: nextIpAddress,
        port_number: portNumber
      };
    });
  }

  removeDeviceCard(draftId: string): void {
    this.deviceCards = this.deviceCards.filter((card) => card.draft_id !== draftId);
    this.connectionDrafts = this.connectionDrafts.filter(
      (link) => link.source_draft_id !== draftId && link.target_draft_id !== draftId
    );
    this.recentlyConnectedDraftIds = this.recentlyConnectedDraftIds.filter((id) => id !== draftId);
    if (this.pendingConnectorSourceDraftId === draftId) {
      this.pendingConnectorSourceDraftId = '';
    }
    delete this.draftPositions[draftId];
    if (this.selectedDraftDeviceId === draftId) {
      this.selectedDraftDeviceId = this.deviceCards[0]?.draft_id ?? '';
    }
  }

  addConnectionDraft(): void {
    if (this.deviceCards.length < 2) {
      this.status = 'Add at least two device cards before creating a connector';
      return;
    }

    this.connectionDrafts = [
      ...this.connectionDrafts,
      {
        draft_id: this.createDraftId('link'),
        source_draft_id: this.deviceCards[0].draft_id,
        target_draft_id: this.deviceCards[1].draft_id,
        link_type: 'ethernet',
        line_style: 'curve'
      }
    ];
  }

  removeConnectionDraft(draftId: string): void {
    this.connectionDrafts = this.connectionDrafts.filter((link) => link.draft_id !== draftId);
    if (this.selectedConnectionDraftId === draftId) {
      this.selectedConnectionDraftId = this.connectionDrafts[0]?.draft_id ?? '';
    }
  }

  toggleConnectorSelection(draftId: string): void {
    if (this.suppressNextConnectorSelection) {
      this.suppressNextConnectorSelection = false;
      return;
    }

    if (!this.pendingConnectorLinkType) {
      this.selectDeviceDraft(draftId);
      this.status = 'Select a connector type first, then click source and target boxes';
      return;
    }

    this.selectDeviceDraft(draftId);
    if (this.pendingConnectorSourceDraftId.length === 0) {
      this.pendingConnectorSourceDraftId = draftId;
      this.pendingConnectorPointer = this.getDraftPosition(draftId);
      this.status = `Selected ${this.getDeviceCardName(draftId)} as connector source`;
      return;
    }

    if (this.pendingConnectorSourceDraftId === draftId) {
      this.pendingConnectorSourceDraftId = '';
      this.pendingConnectorPointer = null;
      this.status = 'Connector source selection cleared';
      return;
    }

    this.createConnectionBetween(
      this.pendingConnectorSourceDraftId,
      draftId,
      this.pendingConnectorLinkType
    );
  }

  startConnectorDraft(draftId: string): void {
    if (!this.pendingConnectorLinkType) {
      this.selectDeviceDraft(draftId);
      this.status = 'Select a connector type first, then drag from source to target box';
      return;
    }

    this.selectDeviceDraft(draftId);
    this.pendingConnectorSourceDraftId = draftId;
    this.pendingConnectorPointer = this.getDraftPosition(draftId);
    this.status = `Drawing ${this.pendingConnectorLinkType} connector from ${this.getDeviceCardName(draftId)}`;
  }

  completeConnectorDraft(draftId: string): void {
    if (!this.pendingConnectorLinkType || !this.pendingConnectorSourceDraftId) {
      return;
    }

    if (this.pendingConnectorSourceDraftId === draftId) {
      this.pendingConnectorSourceDraftId = '';
      this.pendingConnectorPointer = null;
      this.status = 'Connector source selection cleared';
      return;
    }

    this.createConnectionBetween(
      this.pendingConnectorSourceDraftId,
      draftId,
      this.pendingConnectorLinkType
    );
  }

  cancelConnectorDraft(): void {
    if (!this.pendingConnectorSourceDraftId) {
      this.pendingConnectorPointer = null;
      return;
    }

    this.pendingConnectorSourceDraftId = '';
    this.pendingConnectorPointer = null;
    this.status = 'Connector drawing cancelled';
  }

  clearConnectorSelection(): void {
    this.pendingConnectorSourceDraftId = '';
    this.pendingConnectorLinkType = '';
    this.pendingConnectorPointer = null;
    this.status = 'Connector drawing mode cleared';
  }

  updateConnectorDraftPointer(event: MouseEvent): void {
    if (!this.pendingConnectorSourceDraftId || !this.pendingConnectorLinkType) {
      return;
    }

    const svg = event.currentTarget as SVGElement | null;
    if (!svg) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const rawX = ((event.clientX - rect.left) / rect.width) * this.draftCanvasWidth;
    const rawY = ((event.clientY - rect.top) / rect.height) * this.draftCanvasHeight;
    const x = Math.min(this.draftCanvasWidth - 4, Math.max(4, rawX));
    const y = Math.min(this.draftCanvasHeight - 4, Math.max(4, rawY));
    this.pendingConnectorPointer = { x, y };
  }

  clearConnectorDraftPointer(): void {
    this.pendingConnectorPointer = null;
  }

  startDraftDrag(draftId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.draggingDraftId = draftId;
  }

  moveDraftDrag(event: MouseEvent): void {
    if (!this.draggingDraftId) {
      return;
    }

    const svg = event.currentTarget as SVGElement | null;
    if (!svg) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const rawX = ((event.clientX - rect.left) / rect.width) * this.draftCanvasWidth;
    const rawY = ((event.clientY - rect.top) / rect.height) * this.draftCanvasHeight;
    const x = Math.min(this.draftCanvasWidth - 96, Math.max(96, rawX));
    const y = Math.min(this.draftCanvasHeight - 48, Math.max(48, rawY));
    this.draftPositions[this.draggingDraftId] = { x, y };
    this.suppressNextConnectorSelection = true;
  }

  stopDraftDrag(): void {
    this.draggingDraftId = '';
  }

  startCanvasPan(event: MouseEvent): void {
    if ((event.target as Element | null)?.closest('.drag-handle')) {
      return;
    }

    this.isCanvasPanning = true;
    this.canvasPanOrigin = {
      x: event.clientX,
      y: event.clientY,
      panX: this.draftViewport.panX,
      panY: this.draftViewport.panY,
    };
  }

  moveCanvasPan(event: MouseEvent): void {
    if (!this.isCanvasPanning) {
      return;
    }

    const deltaX = event.clientX - this.canvasPanOrigin.x;
    const deltaY = event.clientY - this.canvasPanOrigin.y;
    this.draftViewport = {
      ...this.draftViewport,
      panX: this.canvasPanOrigin.panX + deltaX,
      panY: this.canvasPanOrigin.panY + deltaY,
    };
  }

  stopCanvasPan(): void {
    this.isCanvasPanning = false;
  }

  zoomCanvas(delta: number): void {
    const nextScale = Math.min(2.5, Math.max(0.5, this.draftViewport.scale + delta));
    this.draftViewport = {
      ...this.draftViewport,
      scale: Number(nextScale.toFixed(2)),
    };
  }

  resetCanvasViewport(): void {
    this.draftViewport = { scale: 1, panX: 0, panY: 0 };
  }

  getDraftViewportTransform(): string {
    return `translate(${this.draftViewport.panX} ${this.draftViewport.panY}) scale(${this.draftViewport.scale})`;
  }

  selectConsoleDevice(deviceName: string): void {
    this.selectedConsoleDevice = deviceName;
  }

  selectMibModule(moduleName: string): void {
    this.selectedMibModuleName = moduleName;
    this.selectedMibFieldOid = this.findFirstModuleFieldOid(this.getSelectedMibModule());
  }

  selectMibField(oid: string): void {
    this.selectedMibFieldOid = oid;
    this.selectedSetValue = this.getSetValueChoices()[0] ?? 'updated';
  }

  getSelectedMibModule(): MibModule | undefined {
    return this.mibModules.find((module) => module.name === this.selectedMibModuleName);
  }

  getSelectedMibField(): MibField | undefined {
    const module = this.getSelectedMibModule();
    if (!module) {
      return undefined;
    }

    const fields = module.fields.length > 0 ? module.fields : this.flattenModuleTreeFields(module.tree);
    return fields.find((field) => field.oid === this.selectedMibFieldOid);
  }

  private findFirstModuleFieldOid(module: MibModule | undefined): string {
    if (!module) {
      return '';
    }

    if (module.fields.length > 0) {
      return module.fields[0]?.oid ?? '';
    }

    return this.flattenModuleTreeFields(module.tree)[0]?.oid ?? '';
  }

  private flattenModuleTreeFields(treeNodes: MibTreeNode[]): MibField[] {
    const fields: MibField[] = [];

    const walk = (nodes: MibTreeNode[]): void => {
      for (const node of nodes) {
        if (node.node_kind === 'field' && node.oid && node.label) {
          fields.push({
            oid: node.oid,
            label: node.label,
            oid_type: node.oid_type ?? 'singlevalue'
          });
        }
        if (node.children.length > 0) {
          walk(node.children);
        }
      }
    };

    walk(treeNodes);
    return fields;
  }

  getSetValueChoices(): string[] {
    const label = this.getSelectedMibField()?.label;
    const values = [label, `${label}-updated`, 'enabled', 'disabled', '1', '0', 'up', 'down']
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return [...new Set(values)];
  }

  selectDeviceDraft(draftId: string): void {
    this.selectedDraftDeviceId = draftId;
    this.inspectorTab = 'node';
  }

  toggleDeviceDraftSelection(draftId: string): void {
    if (this.selectedDraftDeviceId === draftId) {
      this.selectedDraftDeviceId = '';
      return;
    }

    this.selectDeviceDraft(draftId);
  }

  clearDraftSelections(): void {
    this.selectedDraftDeviceId = '';
    this.selectedConnectionDraftId = '';
    this.inspectorTab = 'node';
  }

  selectConnectionDraft(draftId: string): void {
    this.selectedConnectionDraftId = draftId;
    this.inspectorTab = 'link';
  }

  getSelectedDeviceCard(): DeviceCardConfig | undefined {
    return this.deviceCards.find((card) => card.draft_id === this.selectedDraftDeviceId);
  }

  getSelectedConnectionDraft(): ConnectionDraft | undefined {
    return this.connectionDrafts.find((link) => link.draft_id === this.selectedConnectionDraftId);
  }

  updateSelectedDeviceSelector(selectorKind: DeviceSelectorKind, selectorValue: string): void {
    const selected = this.getSelectedDeviceCard();
    if (!selected) {
      return;
    }

    selected.selector_kind = selectorKind;
    selected.selector_value = selectorValue;
    selected.name = this.generateDeviceName(selectorKind, selectorValue, selected.draft_id);
  }

  updateSelectedConnectionType(linkType: string): void {
    const selected = this.getSelectedConnectionDraft();
    if (!selected) {
      return;
    }

    selected.link_type = linkType;
  }

  updateConnectionLineStyle(draftId: string, lineStyle: ConnectionLineStyle): void {
    this.connectionDrafts = this.connectionDrafts.map((link) => {
      if (link.draft_id !== draftId) {
        return link;
      }

      return {
        ...link,
        line_style: lineStyle
      };
    });
    this.status = `Connection style updated to ${lineStyle}`;
  }

  removeSelectedElement(): void {
    if (this.inspectorTab === 'link' && this.selectedConnectionDraftId) {
      this.removeConnectionDraft(this.selectedConnectionDraftId);
      return;
    }

    if (this.selectedDraftDeviceId) {
      this.removeDeviceCard(this.selectedDraftDeviceId);
    }
  }

  getDraftPosition(draftId: string): { x: number; y: number } {
    const positioned = this.draftPositions[draftId];
    if (positioned) {
      return positioned;
    }

    const index = this.deviceCards.findIndex((card) => card.draft_id === draftId);
    if (index === -1) {
      return { x: 80, y: 80 };
    }

    return this.computeDraftPositionForIndex(index);
  }

  isPendingConnectorSource(draftId: string): boolean {
    return this.pendingConnectorSourceDraftId === draftId;
  }

  isRecentlyConnectedDraft(draftId: string): boolean {
    return this.recentlyConnectedDraftIds.includes(draftId);
  }

  isSelectedDeviceDraft(draftId: string): boolean {
    return this.selectedDraftDeviceId === draftId;
  }

  isSelectedConnectionDraft(draftId: string): boolean {
    return this.selectedConnectionDraftId === draftId;
  }

  getDeviceCardName(draftId: string): string {
    return this.deviceCards.find((card) => card.draft_id === draftId)?.name ?? 'Unknown device';
  }

  private createConnectionBetween(sourceDraftId: string, targetDraftId: string, linkType: string): void {
    const exists = this.connectionDrafts.some(
      (link) =>
        (link.source_draft_id === sourceDraftId && link.target_draft_id === targetDraftId) ||
        (link.source_draft_id === targetDraftId && link.target_draft_id === sourceDraftId)
    );

    if (exists) {
      this.pendingConnectorSourceDraftId = sourceDraftId;
      this.pendingConnectorPointer = this.getDraftPosition(sourceDraftId);
      this.status = 'Connector already exists between these device boxes. Select another target.';
      return;
    }

    this.connectionDrafts = [
      ...this.connectionDrafts,
      {
        draft_id: this.createDraftId('link'),
        source_draft_id: sourceDraftId,
        target_draft_id: targetDraftId,
        link_type: linkType,
        line_style: 'curve'
      }
    ];
    this.recentlyConnectedDraftIds = [sourceDraftId, targetDraftId];
    if (this.connectionHighlightTimeout) {
      clearTimeout(this.connectionHighlightTimeout);
    }
    this.connectionHighlightTimeout = setTimeout(() => {
      this.recentlyConnectedDraftIds = [];
      this.connectionHighlightTimeout = null;
    }, 1200);
    this.selectedConnectionDraftId = this.connectionDrafts[this.connectionDrafts.length - 1]?.draft_id ?? '';
    this.inspectorTab = 'link';
    this.pendingConnectorSourceDraftId = sourceDraftId;
    this.pendingConnectorPointer = this.getDraftPosition(sourceDraftId);
    this.status = `Created ${linkType} connector. Continue dragging to connect more boxes from ${this.getDeviceCardName(sourceDraftId)}.`;
  }

  private getNextAvailableDraftIpAddress(): string {
    const usedHostOctets = new Set<number>();

    for (const card of this.deviceCards) {
      const ipAddress = card.ip_address?.trim();
      if (!ipAddress) {
        continue;
      }

      const match = /^192\.168\.0\.(\d{1,3})$/.exec(ipAddress);
      if (!match) {
        continue;
      }

      const host = Number.parseInt(match[1], 10);
      if (host >= 1 && host <= 254) {
        usedHostOctets.add(host);
      }
    }

    for (let host = 10; host <= 254; host += 1) {
      if (!usedHostOctets.has(host)) {
        return `192.168.0.${host}`;
      }
    }

    return '192.168.0.1';
  }

  startNodeDrag(nodeName: string, event: MouseEvent): void {
    event.preventDefault();
    this.draggingNodeName = nodeName;
  }

  moveDraggedNode(event: MouseEvent): void {
    if (!this.draggingNodeName) {
      return;
    }

    const svg = event.currentTarget as SVGElement | null;
    if (!svg) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const rawX = ((event.clientX - rect.left) / rect.width) * this.graphWidth;
    const rawY = ((event.clientY - rect.top) / rect.height) * this.graphHeight;
    const margin = 20;
    const x = Math.min(this.graphWidth - margin, Math.max(margin, rawX));
    const y = Math.min(this.graphHeight - margin, Math.max(margin, rawY));
    this.nodePositions[this.draggingNodeName] = { x, y };
  }

  stopNodeDrag(): void {
    this.draggingNodeName = null;
  }

  exportLayoutJson(): void {
    this.layoutJson = JSON.stringify(
      {
        width: this.graphWidth,
        height: this.graphHeight,
        positions: this.nodePositions
      },
      null,
      2
    );
    this.status = 'Exported current node layout';
  }

  importLayoutJson(): void {
    if (this.layoutJson.trim().length === 0) {
      this.status = 'Paste layout JSON before importing';
      return;
    }

    if (this.topology.nodes.length === 0) {
      this.status = 'Run simulation before importing layout';
      return;
    }

    try {
      this.applyLayoutToNodes(this.layoutJson, this.topology.nodes.map((node) => node.name));
      this.status = 'Imported node layout';
    } catch (error) {
      this.status = error instanceof Error ? error.message : 'Failed to import layout';
    }
  }

  runSnmpGet(): void {
    if (!this.ensureActiveInstance()) {
      return;
    }
    if (!this.selectedConsoleDevice || !this.selectedMibFieldOid) {
      this.status = 'Select a device and MIB field first';
      return;
    }
    const payload = { device_name: this.selectedConsoleDevice, oid: this.selectedMibFieldOid };
    this.http.post<SnmpOperationResponse>(`${this.apiBaseUrl}/instances/${this.activeInstanceId}/snmp/get`, payload).subscribe({
      next: (response) => {
        this.getResult = String(response.value);
        this.appendConsole('info', `GET ${response.device} ${response.oid} -> ${response.value}`);
      },
      error: (error) => {
        this.getResult = this.extractError(error, 'SNMP GET failed');
        this.appendConsole('error', this.getResult);
      }
    });
  }

  runSnmpSet(): void {
    if (!this.ensureActiveInstance()) {
      return;
    }
    if (!this.selectedConsoleDevice || !this.selectedMibFieldOid) {
      this.status = 'Select a device and MIB field first';
      return;
    }
    const parsedValue = this.parseSetValue(this.selectedSetValue);
    const payload = { device_name: this.selectedConsoleDevice, oid: this.selectedMibFieldOid, value: parsedValue };

    this.http.post<SnmpOperationResponse>(`${this.apiBaseUrl}/instances/${this.activeInstanceId}/snmp/set`, payload).subscribe({
      next: (response) => {
        this.setResult = String(response.value);
        this.appendConsole('info', `SET ${response.device} ${response.oid} -> ${response.value}`);
      },
      error: (error) => {
        this.setResult = this.extractError(error, 'SNMP SET failed');
        this.appendConsole('error', this.setResult);
      }
    });
  }

  getNodePosition(name: string): { x: number; y: number } {
    return this.nodePositions[name] ?? { x: this.graphWidth / 2, y: this.graphHeight / 2 };
  }

  getNodeColor(vendor: string): string {
    const palette: Record<string, string> = {
      cambium: '#f08c00',
      radwin: '#087f5b',
      hfcl: '#1971c2',
      generic: '#5f3dc4'
    };

    return palette[vendor] ?? '#5f3dc4';
  }

  private ensureActiveInstance(): boolean {
    if (this.activeInstanceId.length > 0) {
      return true;
    }

    this.status = 'Create or load a simulation instance first';
    return false;
  }

  private parseSetValue(value: string): string | number | boolean {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }

    const asNumber = Number(value);
    return Number.isNaN(asNumber) ? value : asNumber;
  }

  private extractError(error: unknown, fallback: string): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'error' in error &&
      typeof (error as { error?: unknown }).error === 'object'
    ) {
      const detail = (error as { error?: { detail?: unknown } }).error?.detail;
      if (typeof detail === 'string') {
        return detail;
      }
    }

    return fallback;
  }

  private extractValidationErrors(error: unknown): string[] {
    if (
      typeof error === 'object' &&
      error !== null &&
      'error' in error &&
      typeof (error as { error?: unknown }).error === 'object'
    ) {
      const detail = (error as { error?: { detail?: unknown } }).error?.detail;
      if (Array.isArray(detail)) {
        return detail
          .map((item) => {
            if (typeof item === 'object' && item !== null) {
              const location = Array.isArray((item as { loc?: unknown }).loc)
                ? (item as { loc: unknown[] }).loc.join('.')
                : 'payload';
              const message = (item as { msg?: unknown }).msg;
              if (typeof message === 'string') {
                return `${location}: ${message}`;
              }
            }
            return '';
          })
          .filter((value) => value.length > 0);
      }
    }

    return [];
  }

  private validateConfiguration(): ConfigValidationResult {
    const errors: string[] = [];

    if (this.deviceCards.length === 0) {
      errors.push('Add at least one device card');
    } else {
      const seenNames = new Set<string>();
      this.deviceCards.forEach((card, index) => {
        const trimmedName = card.name.trim();

        if (trimmedName.length === 0) {
          errors.push(`deviceCards.${index}.name is required`);
        } else {
          if (seenNames.has(trimmedName)) {
            errors.push(`deviceCards.${index}.name must be unique: ${trimmedName}`);
          }
          seenNames.add(trimmedName);
        }

        if (card.selector_value.trim().length === 0) {
          errors.push(`deviceCards.${index}.selector_value is required`);
        }
      });
    }

    const availableDraftIds = new Set(this.deviceCards.map((card) => card.draft_id));
    this.connectionDrafts.forEach((link, index) => {
      if (!availableDraftIds.has(link.source_draft_id)) {
        errors.push(`connectionDrafts.${index}.source refers to an unknown device card`);
      }

      if (!availableDraftIds.has(link.target_draft_id)) {
        errors.push(`connectionDrafts.${index}.target refers to an unknown device card`);
      }

      if (link.source_draft_id === link.target_draft_id) {
        errors.push(`connectionDrafts.${index} cannot connect a device to itself`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private buildDevicePayload(): Array<{ name: string; device?: string; vendor?: string }> {
    return this.deviceCards.map((card) => {
      if (card.selector_kind === 'vendor') {
        return {
          name: card.name.trim(),
          vendor: card.selector_value
        };
      }

      return {
        name: card.name.trim(),
        device: card.selector_value
      };
    });
  }

  private buildTopologyPayload(): TopologyLink[] {
    const namesByDraftId = new Map(this.deviceCards.map((card) => [card.draft_id, card.name.trim()]));

    return this.connectionDrafts.flatMap((link) => {
      const source = namesByDraftId.get(link.source_draft_id);
      const target = namesByDraftId.get(link.target_draft_id);
      if (!source || !target) {
        return [];
      }

      return [
        {
          source,
          target,
          link_type: link.link_type
        }
      ];
    });
  }

  private buildDesignLayoutPayload(): Record<string, { x: number; y: number }> {
    const payload: Record<string, { x: number; y: number }> = {};

    this.deviceCards.forEach((card) => {
      const position = this.getDraftPosition(card.draft_id);
      payload[card.name.trim()] = { x: position.x, y: position.y };
    });

    return payload;
  }

  private buildDesignViewportPayload(): { scale: number; pan_x: number; pan_y: number } {
    return {
      scale: this.draftViewport.scale,
      pan_x: this.draftViewport.panX,
      pan_y: this.draftViewport.panY,
    };
  }

  private computeNodePositions(
    nodes: Array<{ name: string; vendor: string; device_type: string }>
  ): Record<string, { x: number; y: number }> {
    if (nodes.length === 0) {
      return {};
    }

    const centerX = this.graphWidth / 2;
    const centerY = this.graphHeight / 2;
    const radius = Math.min(this.graphWidth, this.graphHeight) * 0.34;

    return nodes.reduce<Record<string, { x: number; y: number }>>((acc, node, index) => {
      const angle = (2 * Math.PI * index) / nodes.length;
      acc[node.name] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
      return acc;
    }, {});
  }

  private applyLayoutToNodes(layoutJson: string, allowedNodeNames: string[]): void {
    const parsed = this.parseLayoutJson(layoutJson);
    const allowed = new Set(allowedNodeNames);

    Object.entries(parsed.positions).forEach(([name, point]) => {
      if (!allowed.has(name)) {
        return;
      }

      const margin = 20;
      const x = Math.min(this.graphWidth - margin, Math.max(margin, point.x));
      const y = Math.min(this.graphHeight - margin, Math.max(margin, point.y));
      this.nodePositions[name] = { x, y };
    });
  }

  private parseLayoutJson(layoutJson: string): LayoutDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(layoutJson);
    } catch {
      throw new Error('Layout JSON is not valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Layout JSON must be an object');
    }

    const doc = parsed as {
      width?: unknown;
      height?: unknown;
      positions?: unknown;
    };

    if (typeof doc.width !== 'number' || typeof doc.height !== 'number') {
      throw new Error('Layout JSON must include numeric width and height');
    }

    if (typeof doc.positions !== 'object' || doc.positions === null) {
      throw new Error('Layout JSON must include a positions object');
    }

    const normalizedPositions: Record<string, { x: number; y: number }> = {};
    Object.entries(doc.positions as Record<string, unknown>).forEach(([name, value]) => {
      if (typeof value !== 'object' || value === null) {
        throw new Error(`Layout position for ${name} must be an object`);
      }

      const coords = value as { x?: unknown; y?: unknown };
      if (typeof coords.x !== 'number' || typeof coords.y !== 'number') {
        throw new Error(`Layout position for ${name} must include numeric x and y`);
      }

      normalizedPositions[name] = { x: coords.x, y: coords.y };
    });

    return {
      width: doc.width,
      height: doc.height,
      positions: normalizedPositions
    };
  }

  private getTemplateData(template: TopologyTemplate): {
    devices: Array<{ name: string; vendor?: string; device?: string; device_type?: string }>;
    topology: Array<{ source: string; target: string; link_type: string }>;
  } {
    if (template === 'ring') {
      return {
        devices: [
          { name: 'ring-r1', device: 'router' },
          { name: 'ring-sw1', device: 'switch' },
          { name: 'ring-sw2', device: 'switch' },
          { name: 'ring-ap1', vendor: 'cambium' }
        ],
        topology: [
          { source: 'ring-r1', target: 'ring-sw1', link_type: 'ethernet' },
          { source: 'ring-sw1', target: 'ring-sw2', link_type: 'ethernet' },
          { source: 'ring-sw2', target: 'ring-ap1', link_type: 'wireless' },
          { source: 'ring-ap1', target: 'ring-r1', link_type: 'wireless' }
        ]
      };
    }

    if (template === 'branch') {
      return {
        devices: [
          { name: 'core-r1', device: 'router' },
          { name: 'branch-radwin-1', vendor: 'radwin' },
          { name: 'branch-hfcl-1', vendor: 'hfcl' },
          { name: 'branch-sw1', device: 'switch' }
        ],
        topology: [
          { source: 'core-r1', target: 'branch-radwin-1', link_type: 'wireless' },
          { source: 'branch-radwin-1', target: 'branch-hfcl-1', link_type: 'wireless' },
          { source: 'branch-hfcl-1', target: 'branch-sw1', link_type: 'ethernet' }
        ]
      };
    }

    return {
      devices: [
        { name: 'core-r1', device: 'router' },
        { name: 'edge-sw1', device: 'switch' },
        { name: 'ap-cambium-1', vendor: 'cambium' },
        { name: 'ptp-radwin-1', vendor: 'radwin' }
      ],
      topology: [
        { source: 'core-r1', target: 'edge-sw1', link_type: 'ethernet' },
        { source: 'edge-sw1', target: 'ap-cambium-1', link_type: 'wireless' },
        { source: 'edge-sw1', target: 'ptp-radwin-1', link_type: 'wireless' }
      ]
    };
  }

  private hydrateConfigurationCards(
    devices: Array<{ name: string; vendor?: string; device?: string; device_type?: string }>,
    topology: Array<{ source: string; target: string; link_type: string }>
  ): void {
    const deviceCards: DeviceCardConfig[] = devices.map((device) => {
      const draftId = this.createDraftId('device');
      const isVendor = Boolean(device.vendor && device.vendor !== 'generic');
      return {
        draft_id: draftId,
        name: device.name,
        selector_kind: isVendor ? 'vendor' : 'device',
        selector_value: isVendor ? String(device.vendor) : String(device.device ?? device.device_type ?? 'router'),
        uploaded_device_name: undefined
      };
    });

    const draftIdByName = new Map(deviceCards.map((card) => [card.name, card.draft_id]));
    const connectionDrafts: ConnectionDraft[] = topology.flatMap((link) => {
      const sourceDraftId = draftIdByName.get(link.source);
      const targetDraftId = draftIdByName.get(link.target);
      if (!sourceDraftId || !targetDraftId) {
        return [];
      }

      return [
        {
          draft_id: this.createDraftId('link'),
          source_draft_id: sourceDraftId,
          target_draft_id: targetDraftId,
          link_type: link.link_type,
          line_style: 'curve'
        }
      ];
    });

    this.deviceCards = deviceCards;
    this.connectionDrafts = connectionDrafts;
    this.draftPositions = {};
    this.selectedDraftDeviceId = this.deviceCards[0]?.draft_id ?? '';
    this.selectedConnectionDraftId = this.connectionDrafts[0]?.draft_id ?? '';
    this.inspectorTab = this.connectionDrafts.length > 0 ? 'link' : 'node';
  }

  private applyPersistedDraftPositions(layout: Record<string, { x: number; y: number }>): void {
    this.draftPositions = {};
    this.deviceCards.forEach((card, index) => {
      const persisted = layout[card.name];
      this.draftPositions[card.draft_id] = persisted ?? this.computeDraftPositionForIndex(index);
    });
  }

  private applyPersistedDraftViewport(viewport: { scale: number; pan_x: number; pan_y: number }): void {
    this.draftViewport = {
      scale: viewport.scale ?? 1,
      panX: viewport.pan_x ?? 0,
      panY: viewport.pan_y ?? 0,
    };
  }

  private createDraftId(prefix: 'device' | 'link'): string {
    this.draftSequence += 1;
    return `${prefix}-${this.draftSequence}`;
  }

  private computeDraftPositionForIndex(index: number): { x: number; y: number } {
    const columns = Math.max(1, Math.min(3, this.deviceCards.length + 1));
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: 110 + col * 250,
      y: 90 + row * 150
    };
  }

  private appendConsole(level: 'info' | 'error', message: string): void {
    this.consoleEntries = [
      {
        timestamp: new Date().toLocaleTimeString(),
        level,
        message
      },
      ...this.consoleEntries
    ].slice(0, 100);
  }

  private buildInstanceName(): string {
    if (this.instanceName.trim().length > 0) {
      return this.instanceName.trim();
    }

    return `instance-${Date.now()}`;
  }

  private resolveMibDir(): string | null {
    if (this.uploadedMibDir.length > 0) {
      return this.uploadedMibDir;
    }

    return null;
  }

  private generateDeviceName(
    selectorKind: DeviceSelectorKind,
    selectorValue: string,
    preserveDraftId?: string,
    customName?: string
  ): string {
    const prefixMap: Record<string, string> = {
      router: 'rtr',
      switch: 'sw',
      firewall: 'fw',
      printer: 'prt',
      ap: 'ap',
      server: 'srv',
      cambium: 'cambium',
      radwin: 'radwin',
      hfcl: 'hfcl'
    };
    const customPrefix = customName?.trim() ?? '';
    const prefix = customPrefix.length > 0 ? customPrefix : prefixMap[selectorValue] ?? (selectorKind === 'vendor' ? 'vendor' : 'device');
    const taken = new Set(
      this.deviceCards
        .filter((card) => card.draft_id !== preserveDraftId)
        .map((card) => card.name)
    );

    let index = 1;
    while (taken.has(`${prefix}-${index}`)) {
      index += 1;
    }
    return `${prefix}-${index}`;
  }
}