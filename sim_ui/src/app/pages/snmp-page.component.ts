import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import { SimulatorStateService } from '../simulator-state.service';

@Component({
  selector: 'app-snmp-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="console-shell">
      <section class="panel console-sidebar">
        <div class="page-title-row">
          <div>
            <h1>Live Console</h1>
            <p class="page-subtitle">Operate SNMP GET and SET against the active instance using MIB-backed selections.</p>
          </div>
        </div>
        <p class="status" *ngIf="store.activeInstanceName">Active instance: {{ store.activeInstanceName }}</p>

        <h2>Devices</h2>
        <div class="chip-grid">
          <button
            *ngFor="let device of store.devices"
            class="chip-button"
            [class.active]="store.selectedConsoleDevice === device.name"
            (click)="store.selectConsoleDevice(device.name)"
          >
            {{ device.name }}
          </button>
        </div>

        <h2>MIB Modules</h2>
        <div class="chip-grid">
          <button
            *ngFor="let module of store.mibModules"
            class="chip-button"
            [class.active]="store.selectedMibModuleName === module.name"
            (click)="store.selectMibModule(module.name)"
          >
            {{ module.name }}
          </button>
        </div>

        <h2>Fields</h2>
        <div class="field-list" *ngIf="store.getSelectedMibModule() as module">
          <button
            *ngFor="let field of module.fields"
            class="field-item"
            [class.active]="store.selectedMibFieldOid === field.oid"
            (click)="store.selectMibField(field.oid)"
          >
            <span>{{ field.label }}</span>
            <small>{{ field.oid }}</small>
          </button>
        </div>
      </section>

      <section class="panel console-actions-panel">
        <h2>Operations</h2>
        <p *ngIf="store.getSelectedMibField() as field">
          Selected field: <strong>{{ field.label }}</strong> on <strong>{{ store.selectedConsoleDevice || 'no device selected' }}</strong>
        </p>
        <div class="actions">
          <button (click)="store.runSnmpGet()">Run GET</button>
          <button class="secondary" (click)="store.runSnmpSet()">Run SET</button>
        </div>

        <h3>SET Value Presets</h3>
        <div class="chip-grid">
          <button
            *ngFor="let value of store.getSetValueChoices()"
            class="chip-button"
            [class.active]="store.selectedSetValue === value"
            (click)="store.selectedSetValue = value"
          >
            {{ value }}
          </button>
        </div>

        <div class="result-cards">
          <article class="result-card">
            <h3>Last GET</h3>
            <p>{{ store.getResult || 'No GET executed yet' }}</p>
          </article>
          <article class="result-card">
            <h3>Last SET</h3>
            <p>{{ store.setResult || 'No SET executed yet' }}</p>
          </article>
        </div>
      </section>

      <section class="panel console-panel">
        <div class="section-header">
          <h2>Live Console Window</h2>
        </div>
        <div class="console-window">
          <article *ngFor="let entry of store.consoleEntries" class="console-entry" [class.error]="entry.level === 'error'">
            <span class="console-time">{{ entry.timestamp }}</span>
            <span class="console-level">{{ entry.level }}</span>
            <span class="console-message">{{ entry.message }}</span>
          </article>
          <p *ngIf="store.consoleEntries.length === 0">No console activity yet.</p>
        </div>
      </section>
    </section>
  `,
  styleUrl: './pages.shared.scss'
})
export class SnmpPageComponent {
  protected readonly store = inject(SimulatorStateService);
}
