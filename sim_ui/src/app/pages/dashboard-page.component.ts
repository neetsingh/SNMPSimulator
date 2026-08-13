import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTreeModule } from '@angular/material/tree';

import { ConnectionLineStyle, DbTreeEntry, MibTreeNode, SimulatorStateService } from '../simulator-state.service';

type DbTreeNode = {
  name: string;
  kind: 'database' | 'table';
  dbName: string;
  tableName?: string;
  children?: DbTreeNode[];
};

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTreeModule],
  template: `
    <section class="dashboard-wireframe">
      <header class="wireframe-header">
        <button class="upload-trigger secondary" type="button" (click)="openManageDevicesDialog()">Manage Devices</button>
        <button class="upload-trigger secondary" type="button" (click)="openDbDialog()">DB</button>
      </header>

      <div class="upload-modal-backdrop" *ngIf="showUploadDialog" (click)="closeUploadDialog()">
        <section class="upload-modal" (click)="$event.stopPropagation()">
          <div class="upload-modal-header">
            <div>
              <h2>Upload MIB Files</h2>
              <p>Enter a device name, then upload MIB files to store them on the backend.</p>
            </div>
            <button class="ghost-button" type="button" (click)="closeUploadDialog()">Close</button>
          </div>

          <label class="modal-field" for="uploaded-device-name">
            <span>Device name</span>
            <input id="uploaded-device-name" [(ngModel)]="uploadedDeviceName" placeholder="e.g. core-router" />
          </label>

          <label class="modal-field" for="uploaded-device-type">
            <span>Device type</span>
            <select id="uploaded-device-type" [(ngModel)]="uploadedDeviceType">
              <option *ngFor="let deviceType of store.availableDeviceTypes" [value]="deviceType">{{ deviceType }}</option>
            </select>
          </label>

          <label class="modal-field" for="mib-upload-input">
            <span>MIB files</span>
            <input id="mib-upload-input" #mibUploadDialog type="file" multiple accept=".mib,.txt,.my" (change)="captureUploadFiles(mibUploadDialog.files)" />
          </label>

          <div class="modal-actions">
            <button class="primary-button" type="button" (click)="confirmUpload(mibUploadDialog)">Upload</button>
            <button class="ghost-button" type="button" (click)="closeUploadDialog()">Cancel</button>
          </div>
        </section>
      </div>

      <div class="upload-modal-backdrop" *ngIf="showManageDevicesDialog" (click)="closeManageDevicesDialog()">
        <section class="manage-devices-modal" (click)="$event.stopPropagation()">
          <div class="upload-modal-header">
            <div>
              <h2>Manage Uploaded Devices</h2>
              <p>Review uploaded devices and rename or delete entries.</p>
            </div>
            <button class="ghost-button" type="button" (click)="closeManageDevicesDialog()">Close</button>
          </div>

          <div class="manage-devices-empty" *ngIf="store.uploadedDevices.length === 0">No device</div>

          <div class="manage-devices-grid-wrap" *ngIf="store.uploadedDevices.length > 0">
            <table class="manage-devices-grid">
              <thead>
                <tr>
                  <th>Device Name</th>
                  <th>Type</th>
                  <th>Uploaded At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let device of store.uploadedDevices">
                  <td>
                    <ng-container *ngIf="renamingDeviceName === device.device_name; else viewDeviceName">
                      <input class="manage-rename-input" [(ngModel)]="renamedDeviceName" />
                    </ng-container>
                    <ng-template #viewDeviceName>{{ device.device_name }}</ng-template>
                  </td>
                  <td>{{ device.device_type }}</td>
                  <td>{{ device.uploaded_at }}</td>
                  <td>
                    <div class="manage-actions" *ngIf="renamingDeviceName === device.device_name; else rowDefaultActions">
                      <button class="small-button" type="button" (click)="saveRenamedDevice(device.device_name)">Save</button>
                      <button class="small-button" type="button" (click)="cancelRenameDevice()">Cancel</button>
                    </div>
                    <ng-template #rowDefaultActions>
                      <div class="manage-actions">
                        <button class="small-button" type="button" (click)="startRenameDevice(device.device_name)">Rename</button>
                        <button class="small-button danger" type="button" (click)="deleteManagedDevice(device.device_name)">Delete</button>
                      </div>
                    </ng-template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="modal-actions">
            <button class="primary-button" type="button" (click)="openUploadDialogFromManageDevices()">Upload Mib Files</button>
          </div>
        </section>
      </div>

      <div class="upload-modal-backdrop" *ngIf="showDbDialog" (click)="closeDbDialog()">
        <section class="db-browser-modal" (click)="$event.stopPropagation()">
          <div class="upload-modal-header">
            <div>
              <h2>Database Browser</h2>
              <p>Select a table from the tree and inspect its data in the grid.</p>
            </div>
            <button class="ghost-button" type="button" (click)="closeDbDialog()">Close</button>
          </div>

          <div class="db-browser-layout">
            <aside class="db-tree-panel">
              <div class="db-tree-empty" *ngIf="dbTree.length === 0">No database</div>
              <ng-container *ngIf="dbTree.length > 0">
                <input
                  class="db-tree-search"
                  [(ngModel)]="dbTreeSearch"
                  (ngModelChange)="applyDbTreeSearch($event)"
                  placeholder="Search database or table"
                />
                <div class="db-table-empty" *ngIf="filteredDbTreeNodes.length === 0">No matching table</div>

                <mat-tree [dataSource]="filteredDbTreeNodes" [childrenAccessor]="dbChildrenAccessor" class="db-tree">
                  <mat-tree-node *matTreeNodeDef="let node" matTreeNodePadding>
                    <button
                      class="db-table-item"
                      [class.active]="selectedDbTableName === node.tableName"
                      type="button"
                      (click)="selectDbTable(node.dbName, node.tableName || node.name)"
                    >
                      {{ node.name }}
                    </button>
                  </mat-tree-node>

                  <mat-tree-node *matTreeNodeDef="let node; when: isDatabaseNode" matTreeNodePadding [isExpandable]="true">
                    <button class="db-tree-db" matTreeNodeToggle type="button" [class.active]="selectedDbName === node.name" (click)="selectDb(node.name)">
                      {{ node.name }}
                    </button>
                  </mat-tree-node>
                </mat-tree>
              </ng-container>
            </aside>

            <section class="db-grid-panel">
              <p class="db-grid-hint" *ngIf="!selectedDbTableName">Select a table to view rows.</p>
              <div class="db-grid-toolbar" *ngIf="selectedDbTableName">
                <div class="db-grid-title">{{ selectedDbName }} / {{ selectedDbTableName }}</div>
                <div class="db-grid-count">{{ dbTableRows.length }} rows</div>
              </div>

              <div class="db-grid-wrap" *ngIf="selectedDbTableName && dbTableColumns.length > 0">
                <table class="db-grid-table">
                  <thead>
                    <tr>
                      <th *ngFor="let column of dbTableColumns">{{ column }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngIf="dbTableRows.length === 0">
                      <td class="db-grid-empty-cell" [attr.colspan]="dbTableColumns.length">No rows</td>
                    </tr>
                    <tr *ngFor="let row of dbTableRows">
                      <td *ngFor="let value of row" [title]="value">
                        {{ value }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>

      <div class="upload-modal-backdrop" *ngIf="showOidDetailDialog" (click)="closeOidDetailDialog()">
        <section class="oid-detail-modal" (click)="$event.stopPropagation()">
          <div class="upload-modal-header">
            <div>
              <h2>OID Detail</h2>
              <p>Selected MIB node details.</p>
            </div>
            <button class="ghost-button" type="button" (click)="closeOidDetailDialog()">Close</button>
          </div>

          <div class="mib-oid-detail" *ngIf="store.getSelectedMibField() as field">
            <p><strong>Label:</strong> {{ field.label }}</p>
            <p><strong>OID:</strong> {{ field.oid }}</p>
            <p><strong>Type:</strong> {{ field.oid_type }}</p>
            <p *ngIf="field.parent_symbol"><strong>Parent:</strong> {{ field.parent_symbol }}</p>
          </div>
        </section>
      </div>

      <div class="upload-modal-backdrop" *ngIf="showDeviceConfigDialog" (click)="closeDeviceConfigDialog()">
        <section class="upload-modal" (click)="$event.stopPropagation()">
          <div class="upload-modal-header">
            <div>
              <h2>Configure Device</h2>
              <p>Set IP address and port for the newly placed device.</p>
            </div>
            <button class="ghost-button" type="button" (click)="closeDeviceConfigDialog()">Close</button>
          </div>

          <label class="modal-field" for="device-ip-address">
            <span>IP address</span>
            <input id="device-ip-address" [(ngModel)]="deviceConfigIpAddress" placeholder="e.g. 192.168.1.10" />
          </label>

          <label class="modal-field" for="device-port-number">
            <span>Port number</span>
            <input id="device-port-number" type="number" min="1" max="65535" [(ngModel)]="deviceConfigPortNumber" placeholder="161" />
          </label>

          <div class="modal-actions">
            <button class="primary-button" type="button" (click)="saveDeviceConfigDialog()">Save</button>
            <button class="ghost-button" type="button" (click)="closeDeviceConfigDialog()">Cancel</button>
          </div>
        </section>
      </div>

      <div
        class="context-menu"
        *ngIf="contextMenu"
        [style.left.px]="contextMenu.x"
        [style.top.px]="contextMenu.y"
        (click)="$event.stopPropagation()"
      >
        <button class="context-menu-item danger" type="button" (click)="deleteContextDevice()">Delete</button>
      </div>

      <div
        class="context-menu"
        *ngIf="connectionContextMenu"
        [style.left.px]="connectionContextMenu.x"
        [style.top.px]="connectionContextMenu.y"
        (click)="$event.stopPropagation()"
      >
        <button class="context-menu-item" type="button" (click)="selectConnectionLineStyle('curve')">Curve</button>
        <button class="context-menu-item" type="button" (click)="selectConnectionLineStyle('elbow')">Elbow</button>
        <button class="context-menu-item" type="button" (click)="selectConnectionLineStyle('straight')">Straight</button>
      </div>

      <section class="wireframe-main" (click)="closeOverlayMenus()">
        <aside class="wireframe-left">
          <div class="left-block connectors-block">
            <button class="vertical-label connector-trigger" type="button" (click)="toggleConnectorMenu($event)">Connectors</button>
            <div class="connectors-context-menu" *ngIf="showConnectorMenu" (click)="$event.stopPropagation()">
              <button
                *ngFor="let linkType of store.availableLinkTypes"
                class="square-button"
                [class.active]="store.pendingConnectorLinkType === linkType"
                type="button"
                (click)="selectConnectorType(linkType)"
              >
                {{ linkType }}
              </button>
              <button class="square-button" type="button" (click)="clearConnectorMenuSelection()">Clear</button>
            </div>
          </div>

          <div class="left-block device-list-block">
            <button class="vertical-label device-trigger" type="button" (click)="toggleDeviceMenu($event)">Device Types list</button>
            <button class="square-button" type="button" [class.active]="isMoveBoxesModeEnabled" (click)="toggleMoveBoxesMode()">
              Move Boxes
            </button>
            <div class="device-context-menu" *ngIf="showDeviceMenu" (click)="$event.stopPropagation()">
              <div class="device-menu-list-wrap">
                <p class="device-menu-label">Uploaded Devices</p>
                <div class="device-menu-empty" *ngIf="store.uploadedDevices.length === 0">No device</div>
                <button
                  *ngFor="let device of store.uploadedDevices"
                  class="device-menu-item"
                  type="button"
                  [class.active]="selectedDeviceType === device.device_name"
                  (click)="selectUploadedDeviceFromMenu(device.device_name)"
                >
                  {{ device.device_name }}
                </button>
              </div>

              <div class="device-list-actions">
              </div>
            </div>
          </div>
        </aside>

        <div class="wireframe-canvas">
          <div class="canvas-placeholder">Canvas</div>
          <p class="placement-hint" *ngIf="pendingCanvasDeviceName">Click on canvas to place {{ pendingCanvasDeviceName }}</p>
          <svg
            class="canvas-view"
            [attr.viewBox]="'0 0 ' + store.graphWidth + ' ' + store.graphHeight"
            role="img"
            aria-label="SNMP topology canvas"
            (click)="handleCanvasClick($event)"
            (mousemove)="handleCanvasMouseMove($event)"
            (mouseup)="handleCanvasMouseUp()"
            (mouseleave)="handleCanvasMouseLeave()"
          >
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g *ngIf="draftDeviceCards.length > 0; else renderedTopology">
              <g class="topology-links draft-links">
                <path
                  *ngFor="let link of store.connectionDrafts"
                  class="topology-link"
                  [attr.d]="buildDraftConnectorPath(link)"
                  [attr.stroke]="store.isSelectedConnectionDraft(link.draft_id) ? 'rgba(255,225,138,1)' : null"
                  [attr.stroke-width]="store.isSelectedConnectionDraft(link.draft_id) ? 3.2 : null"
                  style="cursor: pointer;"
                  (click)="store.selectConnectionDraft(link.draft_id)"
                  (contextmenu)="openConnectionContextMenu($event, link.draft_id)"
                ></path>
                <path
                  *ngIf="store.pendingConnectorSourceDraftId && store.pendingConnectorPointer"
                  class="topology-link"
                  stroke="rgba(255,236,145,0.95)"
                  stroke-width="2.8"
                  stroke-dasharray="5 5"
                  [attr.d]="buildPendingConnectorPath()"
                ></path>
              </g>

              <g
                *ngFor="let device of draftDeviceCards"
                class="draft-device"
                [class.selected]="store.isSelectedDeviceDraft(device.draft_id) || store.isRecentlyConnectedDraft(device.draft_id)"
                [class.pending]="store.isPendingConnectorSource(device.draft_id)"
                [attr.transform]="'translate(' + store.getDraftPosition(device.draft_id).x + ' ' + store.getDraftPosition(device.draft_id).y + ')'"
                (mousedown)="handleDraftDeviceMouseDown(device.draft_id, $event)"
                (mouseup)="handleDraftDeviceMouseUp(device.draft_id, $event)"
                (click)="handleDraftDeviceClick(device.draft_id, $event)"
                (contextmenu)="openContextMenu($event, device.draft_id)"
              >
                <circle class="draft-device-card" r="24"></circle>
                <text class="draft-device-type" y="5" text-anchor="middle">{{ (device.selector_value || 'd').slice(0, 1).toUpperCase() }}</text>
                <text class="draft-device-name" y="40" text-anchor="middle">{{ device.name }}</text>
                <text class="draft-device-type" y="54" text-anchor="middle">{{ device.selector_value }}</text>
                <text class="draft-device-type" y="66" text-anchor="middle" style="font-size: 9px; fill: #9cc2ff;">{{ device.ip_address || '0.0.0.0' }}:{{ device.port_number || 161 }}</text>
              </g>
            </g>

            <ng-template #renderedTopology>
              <g *ngIf="topologyNodes.length > 0">
                <g class="topology-links">
                  <path
                    *ngFor="let link of topologyLinks"
                    class="topology-link"
                    [attr.d]="buildNodeConnectorPath(link.source, link.target)"
                  ></path>
                </g>

                <g *ngFor="let node of topologyNodes" class="topology-node" [attr.transform]="'translate(' + store.getNodePosition(node.name).x + ' ' + store.getNodePosition(node.name).y + ')'">
                  <circle class="node-glow" r="28" [attr.fill]="store.getNodeColor(node.vendor)"></circle>
                  <circle class="node-ring" r="23"></circle>
                  <text class="node-badge" y="6">online</text>
                  <text class="node-name" y="44">{{ node.name }}</text>
                  <text class="node-meta" y="60">{{ node.vendor }} • {{ node.device_type }}</text>
                </g>
              </g>
            </ng-template>
          </svg>
        </div>

        <aside class="wireframe-right">
          <div class="device-menu-list-wrap right-panel-device-list">
            <p class="device-menu-label">Uploaded Devices</p>
            <div class="device-menu-empty" *ngIf="store.uploadedDevices.length === 0">No device</div>
            <button
              *ngFor="let device of store.uploadedDevices"
              class="device-menu-item"
              type="button"
              [class.active]="inspectedDeviceName === device.device_name"
              (click)="selectRightPanelDevice(device.device_name)"
            >
              {{ device.device_name }}
            </button>
          </div>

          <p class="mib-hint" *ngIf="!inspectedDeviceName">Select a device from the list to view MIB details.</p>
          <p class="mib-hint" *ngIf="inspectedDeviceName">Device: {{ inspectedDeviceName }}</p>

          <div class="mib-summary-card" *ngIf="inspectedDeviceName">
            <p class="mib-hint" *ngIf="store.mibModules.length === 0">No MIB module loaded for this device.</p>

            <label class="mib-module-picker" *ngIf="store.mibModules.length > 0">
              <span>MIB Module</span>
              <select
                [ngModel]="store.selectedMibModuleName"
                (ngModelChange)="selectMibModule($event)"
              >
                <option *ngFor="let module of store.mibModules" [value]="module.name">
                  {{ module.name }}
                </option>
              </select>
            </label>

            <p class="mib-hint" *ngIf="store.getSelectedMibModule() as module">Fields: {{ module.field_count }}</p>

            <div class="mib-tree-wrap" *ngIf="selectedMibTreeNodes.length > 0">
              <mat-tree [dataSource]="selectedMibTreeNodes" [childrenAccessor]="mibChildrenAccessor" class="db-tree mib-shell-tree">
                <mat-tree-node *matTreeNodeDef="let node" matTreeNodePadding>
                  <button
                    class="mib-tree-item leaf"
                    type="button"
                    [class.active]="store.selectedMibFieldOid === node.oid"
                    (click)="selectMibTreeNode(node)"
                  >
                    {{ node.display_name }}
                  </button>
                </mat-tree-node>

                <mat-tree-node *matTreeNodeDef="let node; when: isMibBranchNode" matTreeNodePadding [isExpandable]="true">
                  <button class="mib-tree-item branch" matTreeNodeToggle type="button" (click)="selectMibBranchNode(node)">
                    {{ node.display_name }}
                  </button>
                </mat-tree-node>
              </mat-tree>
            </div>

            <p class="mib-hint" *ngIf="inspectedDeviceName && store.getSelectedMibModule() && selectedMibTreeNodes.length === 0">No tree nodes available.</p>
          </div>
        </aside>
      </section>

    </section>
  `,
  styleUrls: ['./dashboard-page.component.scss']
})
export class DashboardPageComponent {
  protected readonly store = inject(SimulatorStateService);
  protected selectedDeviceType = '';
  protected uploadedDeviceName = 'uploaded-device';
  protected uploadedDeviceType = 'router';
  protected showUploadDialog = false;
  protected pendingUploadFiles: FileList | null = null;
  protected contextMenu: { x: number; y: number; draftId: string } | null = null;
  protected connectionContextMenu: { x: number; y: number; draftId: string } | null = null;
  protected showConnectorMenu = false;
  protected showDeviceMenu = false;
  protected showManageDevicesDialog = false;
  protected showDbDialog = false;
  protected dbTree: DbTreeEntry[] = [];
  protected dbTreeNodes: DbTreeNode[] = [];
  protected filteredDbTreeNodes: DbTreeNode[] = [];
  protected dbTreeSearch = '';
  protected selectedDbName = '';
  protected selectedDbTableName = '';
  protected dbTableColumns: string[] = [];
  protected dbTableRows: string[][] = [];
  protected renamingDeviceName = '';
  protected renamedDeviceName = '';
  protected inspectedDeviceName = '';
  protected showOidDetailDialog = false;
  protected showDeviceConfigDialog = false;
  protected deviceConfigIpAddress = '';
  protected deviceConfigPortNumber = '161';
  protected pendingCanvasDeviceName = '';
  protected pendingCanvasSelectorValue = '';
  protected pendingCanvasUploadedDeviceName = '';
  protected configuringDraftId = '';
  protected isMoveBoxesModeEnabled = false;

  protected readonly dbChildrenAccessor = (node: DbTreeNode): DbTreeNode[] => node.children ?? [];
  protected readonly mibChildrenAccessor = (node: MibTreeNode): MibTreeNode[] => node.children ?? [];

  constructor() {
    this.store.refreshInstances();
    this.store.refreshUploadedDevices(() => {
      this.selectedDeviceType = this.deviceTypeOptions[0]?.device_name ?? (this.store.availableDeviceTypes[0] ?? 'router');
      this.handleDeviceTypeChange(this.selectedDeviceType);
    });
  }

  get topologyNodes(): Array<{ name: string; vendor: string; device_type: string }> {
    return this.store.topology.nodes;
  }

  get topologyLinks(): Array<{ source: string; target: string; link_type: string }> {
    return this.store.topology.links;
  }

  get draftDeviceCards() {
    return this.store.deviceCards;
  }

  get selectedDraftDeviceCard() {
    return this.store.getSelectedDeviceCard();
  }

  get deviceTypeOptions(): Array<{ device_name: string; device_type: string }> {
    if (this.store.uploadedDevices.length > 0) {
      return this.store.uploadedDevices.map((device) => ({
        device_name: device.device_name,
        device_type: device.device_type
      }));
    }

    return this.store.availableDeviceTypes.map((deviceType) => ({
      device_name: deviceType,
      device_type: deviceType
    }));
  }

  get canDeleteSelectedDevice(): boolean {
    return this.store.uploadedDevices.some((device) => device.device_name === this.selectedDeviceType);
  }

  get selectedMibTreeNodes(): MibTreeNode[] {
    return this.store.getSelectedMibModule()?.tree ?? [];
  }

  addConfiguredDevice(): void {
    const selectedDevice = this.deviceTypeOptions.find((device) => device.device_name === this.selectedDeviceType);
    const selectorValue = selectedDevice?.device_type ?? this.selectedDeviceType;
    const customName = selectedDevice?.device_name ?? this.selectedDeviceType;
    const uploadedDeviceName = this.store.uploadedDevices.some((device) => device.device_name === customName) ? customName : undefined;
    this.store.addPaletteDevice('device', selectorValue, customName, uploadedDeviceName);
  }

  openContextMenu(event: MouseEvent, draftId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.showConnectorMenu = false;
    this.showDeviceMenu = false;
    this.connectionContextMenu = null;
    this.contextMenu = { x: event.clientX, y: event.clientY, draftId };
  }

  openConnectionContextMenu(event: MouseEvent, draftId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.showConnectorMenu = false;
    this.showDeviceMenu = false;
    this.contextMenu = null;
    this.store.selectConnectionDraft(draftId);
    this.connectionContextMenu = { x: event.clientX, y: event.clientY, draftId };
  }

  toggleConnectorMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = null;
    this.showDeviceMenu = false;
    this.showConnectorMenu = !this.showConnectorMenu;
  }

  toggleDeviceMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu = null;
    this.showConnectorMenu = false;
    this.showDeviceMenu = !this.showDeviceMenu;
  }

  selectConnectorType(linkType: string): void {
    this.store.pendingConnectorSourceDraftId = '';
    this.store.pendingConnectorPointer = null;
    this.store.pendingConnectorLinkType = linkType;
    this.store.status = `Connector mode: ${linkType}. Drag from one source box to target boxes to create multiple connections.`;
    this.showConnectorMenu = false;
  }

  clearConnectorMenuSelection(): void {
    this.store.clearConnectorSelection();
    this.showConnectorMenu = false;
  }

  toggleMoveBoxesMode(): void {
    this.isMoveBoxesModeEnabled = !this.isMoveBoxesModeEnabled;
    if (this.isMoveBoxesModeEnabled) {
      this.store.clearDraftSelections();
      this.store.clearConnectorSelection();
      this.store.stopDraftDrag();
    }
    this.store.status = this.isMoveBoxesModeEnabled
      ? 'Move mode enabled. Drag boxes to reposition them.'
      : 'Move mode disabled.';
  }

  selectUploadedDeviceFromMenu(deviceName: string): void {
    const uploadedDevice = this.store.uploadedDevices.find((device) => device.device_name === deviceName);
    if (!uploadedDevice) {
      return;
    }

    this.selectedDeviceType = deviceName;
    this.pendingCanvasDeviceName = uploadedDevice.device_name;
    this.pendingCanvasSelectorValue = uploadedDevice.device_type;
    this.pendingCanvasUploadedDeviceName = uploadedDevice.device_name;
    this.showDeviceMenu = false;
    this.store.status = `Placement mode enabled for ${uploadedDevice.device_name}. Click on canvas to add the box.`;
  }

  closeOverlayMenus(): void {
    this.closeContextMenu();
    this.closeConnectionContextMenu();
    this.showConnectorMenu = false;
    this.showDeviceMenu = false;
  }

  closeContextMenu(): void {
    this.contextMenu = null;
  }

  closeConnectionContextMenu(): void {
    this.connectionContextMenu = null;
  }

  selectConnectionLineStyle(lineStyle: ConnectionLineStyle): void {
    if (!this.connectionContextMenu) {
      return;
    }

    this.store.updateConnectionLineStyle(this.connectionContextMenu.draftId, lineStyle);
    this.closeConnectionContextMenu();
  }

  deleteContextDevice(): void {
    if (!this.contextMenu) {
      return;
    }

    this.store.removeDeviceCard(this.contextMenu.draftId);
    this.closeContextMenu();
  }

  openUploadDialog(): void {
    this.pendingUploadFiles = null;
    this.showUploadDialog = true;
  }

  openUploadDialogFromManageDevices(): void {
    this.closeManageDevicesDialog();
    this.openUploadDialog();
  }

  openManageDevicesDialog(): void {
    this.store.refreshUploadedDevices();
    this.renamingDeviceName = '';
    this.renamedDeviceName = '';
    this.showManageDevicesDialog = true;
  }

  openDbDialog(): void {
    this.showDbDialog = true;
    this.dbTree = [];
    this.dbTreeNodes = [];
    this.filteredDbTreeNodes = [];
    this.dbTreeSearch = '';
    this.selectedDbName = '';
    this.selectedDbTableName = '';
    this.dbTableColumns = [];
    this.dbTableRows = [];
    this.store.fetchDbTree((response) => {
      this.dbTree = response.databases;
      this.dbTreeNodes = this.buildDbTreeNodes(response.databases);
      this.filteredDbTreeNodes = this.dbTreeNodes;
      const firstDb = response.databases[0];
      if (!firstDb) {
        return;
      }
      this.selectDb(firstDb.name);
      const firstTable = firstDb.tables[0];
      if (firstTable) {
        this.selectDbTable(firstDb.name, firstTable);
      }
    });
  }

  isDatabaseNode = (_: number, node: DbTreeNode): boolean => node.kind === 'database';

  isMibBranchNode = (_: number, node: MibTreeNode): boolean => node.node_kind === 'branch';

  closeManageDevicesDialog(): void {
    this.renamingDeviceName = '';
    this.renamedDeviceName = '';
    this.showManageDevicesDialog = false;
  }

  selectMibModule(moduleName: string): void {
    this.store.selectMibModule(moduleName);
    this.store.selectedMibFieldOid = '';
  }

  selectMibTreeNode(node: MibTreeNode): void {
    if (node.node_kind !== 'field' || !node.oid) {
      return;
    }
    this.openOidDetailByOid(node.oid);
  }

  selectMibBranchNode(node: MibTreeNode): void {
    const resolvedOid = this.resolveTreeNodeOid(node);
    if (!resolvedOid) {
      return;
    }
    this.openOidDetailByOid(resolvedOid);
  }

  closeOidDetailDialog(): void {
    this.showOidDetailDialog = false;
  }

  closeDeviceConfigDialog(): void {
    this.showDeviceConfigDialog = false;
    this.configuringDraftId = '';
  }

  saveDeviceConfigDialog(): void {
    if (!this.configuringDraftId) {
      this.closeDeviceConfigDialog();
      return;
    }

    const trimmedIpAddress = this.deviceConfigIpAddress.trim();
    const parsedPort = Number.parseInt(this.deviceConfigPortNumber, 10);
    const portNumber = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : null;

    this.store.updateDraftDeviceNetworkConfig(this.configuringDraftId, trimmedIpAddress, portNumber);
    this.store.status = `Configured ${this.store.getDeviceCardName(this.configuringDraftId)} network settings`;
    this.closeDeviceConfigDialog();
  }

  closeDbDialog(): void {
    this.showDbDialog = false;
  }

  selectDb(dbName: string): void {
    this.selectedDbName = dbName;
    this.selectedDbTableName = '';
    this.dbTableColumns = [];
    this.dbTableRows = [];
  }

  applyDbTreeSearch(searchText: string): void {
    const normalized = searchText.trim().toLowerCase();
    if (!normalized) {
      this.filteredDbTreeNodes = this.dbTreeNodes;
      return;
    }

    this.filteredDbTreeNodes = this.dbTreeNodes
      .map((dbNode) => {
        const dbMatches = dbNode.name.toLowerCase().includes(normalized);
        const tableChildren = dbNode.children ?? [];
        if (dbMatches) {
          return dbNode;
        }

        const matchingTables = tableChildren.filter((tableNode) => tableNode.name.toLowerCase().includes(normalized));
        if (matchingTables.length === 0) {
          return null;
        }

        return {
          ...dbNode,
          children: matchingTables,
        };
      })
      .filter((node): node is DbTreeNode => node !== null);
  }

  selectDbTable(dbName: string, tableName: string): void {
    this.selectedDbName = dbName;
    this.selectedDbTableName = tableName;
    this.dbTableColumns = [];
    this.dbTableRows = [];
    this.store.fetchDbTableData(tableName, (response) => {
      this.dbTableColumns = response.columns;
      this.dbTableRows = response.rows;
    });
  }

  closeUploadDialog(): void {
    this.showUploadDialog = false;
    this.pendingUploadFiles = null;
  }

  startRenameDevice(deviceName: string): void {
    this.renamingDeviceName = deviceName;
    this.renamedDeviceName = deviceName;
  }

  cancelRenameDevice(): void {
    this.renamingDeviceName = '';
    this.renamedDeviceName = '';
  }

  saveRenamedDevice(deviceName: string): void {
    const nextDeviceName = this.renamedDeviceName.trim();
    if (!nextDeviceName) {
      return;
    }
    if (nextDeviceName === deviceName) {
      this.cancelRenameDevice();
      return;
    }

    this.store.renameUploadedDevice(deviceName, nextDeviceName, () => {
      if (this.selectedDeviceType === deviceName) {
        this.selectedDeviceType = nextDeviceName;
      }
      if (this.inspectedDeviceName === deviceName) {
        this.handleDeviceTypeChange(nextDeviceName);
      }
      this.cancelRenameDevice();
    });
  }

  deleteManagedDevice(deviceName: string): void {
    this.store.deleteUploadedDevice(deviceName, () => {
      if (this.selectedDeviceType === deviceName) {
        const fallbackDeviceName = this.deviceTypeOptions[0]?.device_name ?? '';
        this.selectedDeviceType = fallbackDeviceName;
        if (fallbackDeviceName) {
          this.handleDeviceTypeChange(fallbackDeviceName);
        } else {
          this.inspectedDeviceName = '';
          this.store.clearLoadedMibTree();
        }
      }
      this.cancelRenameDevice();
    });
  }

  captureUploadFiles(files: FileList | null): void {
    this.pendingUploadFiles = files;
  }

  confirmUpload(input: HTMLInputElement): void {
    if (!this.pendingUploadFiles || this.pendingUploadFiles.length === 0) {
      return;
    }

    const nextDeviceName = this.uploadedDeviceName.trim();
    this.store.uploadMibFiles(this.pendingUploadFiles, nextDeviceName, this.uploadedDeviceType, (response) => {
      this.handleDeviceTypeChange(response.device_name);
      this.closeUploadDialog();
      input.value = '';
    });
  }

  handleDraftDeviceClick(draftId: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.store.pendingConnectorLinkType || this.store.pendingConnectorSourceDraftId) {
      this.store.selectDeviceDraft(draftId);
      return;
    }

    this.store.toggleDeviceDraftSelection(draftId);
  }

  handleDraftDeviceMouseDown(draftId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.store.pendingConnectorLinkType) {
      this.store.startConnectorDraft(draftId);
      return;
    }
    if (!this.isMoveBoxesModeEnabled) {
      this.store.selectDeviceDraft(draftId);
      this.store.status = 'Enable Move Boxes to reposition devices';
      return;
    }

    if (this.store.draggingDraftId === draftId) {
      this.store.stopDraftDrag();
      this.store.status = `Released ${this.store.getDeviceCardName(draftId)}`;
      return;
    }

    this.store.startDraftDrag(draftId, event);
    this.store.status = `Moving ${this.store.getDeviceCardName(draftId)}. Click it again to release.`;
  }

  handleDraftDeviceMouseUp(draftId: string, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.store.pendingConnectorLinkType) {
      return;
    }
    this.store.completeConnectorDraft(draftId);
  }

  handleCanvasClick(event: MouseEvent): void {
    if (!this.pendingCanvasDeviceName || !this.pendingCanvasSelectorValue) {
      if (this.store.pendingConnectorSourceDraftId) {
        this.store.cancelConnectorDraft();
        return;
      }
      this.store.clearDraftSelections();
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

    const rawX = ((event.clientX - rect.left) / rect.width) * this.store.draftCanvasWidth;
    const rawY = ((event.clientY - rect.top) / rect.height) * this.store.draftCanvasHeight;
    const x = Math.min(this.store.draftCanvasWidth - 96, Math.max(96, rawX));
    const y = Math.min(this.store.draftCanvasHeight - 48, Math.max(48, rawY));

    this.store.addPaletteDevice('device', this.pendingCanvasSelectorValue, this.pendingCanvasDeviceName, this.pendingCanvasUploadedDeviceName || undefined);
    const createdDeviceCard = this.store.getSelectedDeviceCard();
    if (!createdDeviceCard) {
      return;
    }

    this.store.draftPositions[createdDeviceCard.draft_id] = { x, y };
    this.configuringDraftId = createdDeviceCard.draft_id;
    this.deviceConfigIpAddress = createdDeviceCard.ip_address ?? '';
    this.deviceConfigPortNumber = String(createdDeviceCard.port_number ?? 161);
    this.showDeviceConfigDialog = true;

    this.pendingCanvasDeviceName = '';
    this.pendingCanvasSelectorValue = '';
    this.pendingCanvasUploadedDeviceName = '';
  }

  handleCanvasMouseMove(event: MouseEvent): void {
    this.store.moveDraftDrag(event);
    this.store.updateConnectorDraftPointer(event);
  }

  handleCanvasMouseUp(): void {
    if (this.store.pendingConnectorLinkType) {
      this.store.stopDraftDrag();
      this.store.cancelConnectorDraft();
      return;
    }

    if (!this.isMoveBoxesModeEnabled) {
      this.store.stopDraftDrag();
    }
  }

  handleCanvasMouseLeave(): void {
    this.store.stopDraftDrag();
    this.store.clearConnectorDraftPointer();
  }

  buildDraftConnectorPath(link: { source_draft_id: string; target_draft_id: string; line_style?: ConnectionLineStyle }): string {
    const source = this.store.getDraftPosition(link.source_draft_id);
    const target = this.store.getDraftPosition(link.target_draft_id);
    const lineStyle = link.line_style ?? 'curve';
    return this.buildConnectorPathByStyle(source.x, source.y, target.x, target.y, lineStyle);
  }

  buildNodeConnectorPath(sourceNodeName: string, targetNodeName: string): string {
    const source = this.store.getNodePosition(sourceNodeName);
    const target = this.store.getNodePosition(targetNodeName);
    return this.buildConnectorPathByStyle(source.x, source.y, target.x, target.y, 'curve');
  }

  buildPendingConnectorPath(): string {
    if (!this.store.pendingConnectorSourceDraftId || !this.store.pendingConnectorPointer) {
      return '';
    }

    const source = this.store.getDraftPosition(this.store.pendingConnectorSourceDraftId);
    const target = this.store.pendingConnectorPointer;
    return this.buildConnectorPathByStyle(source.x, source.y, target.x, target.y, 'curve');
  }

  private buildConnectorPathByStyle(x1: number, y1: number, x2: number, y2: number, lineStyle: ConnectionLineStyle): string {
    if (lineStyle === 'straight') {
      const anchored = this.getAnchoredEndpoints(x1, y1, x2, y2);
      return `M ${anchored.source.x} ${anchored.source.y} L ${anchored.target.x} ${anchored.target.y}`;
    }

    if (lineStyle === 'elbow') {
      const anchored = this.getAnchoredEndpoints(x1, y1, x2, y2);
      const midX = (anchored.source.x + anchored.target.x) / 2;
      return `M ${anchored.source.x} ${anchored.source.y} L ${midX} ${anchored.source.y} L ${midX} ${anchored.target.y} L ${anchored.target.x} ${anchored.target.y}`;
    }

    return this.buildCurvedConnectorPath(x1, y1, x2, y2);
  }

  private getAnchoredEndpoints(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): { source: { x: number; y: number }; target: { x: number; y: number } } {
    const halfWidth = 24;
    const halfHeight = 24;
    return {
      source: this.getBoxEdgeAnchorPoint(x1, y1, x2, y2, halfWidth, halfHeight),
      target: this.getBoxEdgeAnchorPoint(x2, y2, x1, y1, halfWidth, halfHeight)
    };
  }

  private buildCurvedConnectorPath(x1: number, y1: number, x2: number, y2: number): string {
    const anchored = this.getAnchoredEndpoints(x1, y1, x2, y2);
    const source = anchored.source;
    const target = anchored.target;

    const horizontalDistance = Math.abs(target.x - source.x);
    const curveOffset = Math.max(34, horizontalDistance * 0.4);
    const c1x = source.x + curveOffset;
    const c2x = target.x - curveOffset;
    return `M ${source.x} ${source.y} C ${c1x} ${source.y}, ${c2x} ${target.y}, ${target.x} ${target.y}`;
  }

  private getBoxEdgeAnchorPoint(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    halfWidth: number,
    halfHeight: number,
  ): { x: number; y: number } {
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (dx === 0 && dy === 0) {
      return { x: fromX, y: fromY };
    }

    const scaledX = Math.abs(dx) / halfWidth;
    const scaledY = Math.abs(dy) / halfHeight;

    if (scaledX >= scaledY) {
      const edgeX = fromX + Math.sign(dx || 1) * halfWidth;
      const slope = dx === 0 ? 0 : dy / dx;
      const edgeY = fromY + slope * (edgeX - fromX);
      return { x: edgeX, y: edgeY };
    }

    const edgeY = fromY + Math.sign(dy || 1) * halfHeight;
    const invSlope = dy === 0 ? 0 : dx / dy;
    const edgeX = fromX + invSlope * (edgeY - fromY);
    return { x: edgeX, y: edgeY };
  }

  selectRightPanelDevice(deviceName: string): void {
    this.handleDeviceTypeChange(deviceName);
  }

  handleDeviceTypeChange(deviceName: string): void {
    this.selectedDeviceType = deviceName;
    this.inspectedDeviceName = deviceName;
    const uploadedDevice = this.store.uploadedDevices.find((device) => device.device_name === deviceName);
    if (!uploadedDevice) {
      this.store.clearLoadedMibTree();
      return;
    }

    this.store.loadUploadedDeviceMibTree(uploadedDevice.device_name);
  }

  deleteSelectedUploadedDevice(): void {
    if (!this.canDeleteSelectedDevice) {
      return;
    }

    const deletedDeviceName = this.selectedDeviceType;
    this.store.deleteUploadedDevice(deletedDeviceName, () => {
      const nextDevice = this.deviceTypeOptions[0]?.device_name ?? (this.store.availableDeviceTypes[0] ?? 'router');
      this.selectedDeviceType = nextDevice;
      this.inspectedDeviceName = '';
      this.store.clearLoadedMibTree();
      if (nextDevice) {
        this.handleDeviceTypeChange(nextDevice);
      }
    });
  }

  private buildDbTreeNodes(treeEntries: DbTreeEntry[]): DbTreeNode[] {
    return treeEntries.map((entry) => ({
      name: entry.name,
      kind: 'database',
      dbName: entry.name,
      children: entry.tables.map((tableName) => ({
        name: tableName,
        kind: 'table',
        dbName: entry.name,
        tableName,
      })),
    }));
  }

  private resolveTreeNodeOid(node: MibTreeNode): string | null {
    if (node.oid) {
      return node.oid;
    }

    const stack = [...(node.children ?? [])];
    while (stack.length > 0) {
      const next = stack.shift();
      if (!next) {
        continue;
      }
      if (next.oid) {
        return next.oid;
      }
      if (next.children?.length) {
        stack.push(...next.children);
      }
    }

    return null;
  }

  private openOidDetailByOid(oid: string): void {
    this.store.selectMibField(oid);
    this.showOidDetailDialog = true;
  }

}
