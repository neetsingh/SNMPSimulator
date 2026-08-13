import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import { SimulatorStateService } from '../simulator-state.service';

@Component({
  selector: 'app-mib-tree-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="mib-shell">
      <section class="panel mib-sidebar">
        <div class="section-header page-title-row">
          <div>
            <h1>MIB Tree</h1>
            <p class="page-subtitle">Module explorer for uploaded vendor and standard object trees.</p>
          </div>
        </div>
        <div class="summary-grid mb-3">
          <div class="summary-card">
            <span class="summary-label">Source</span>
            <strong>Uploaded MIB Files</strong>
          </div>
          <div class="summary-card">
            <span class="summary-label">Modules</span>
            <strong>{{ store.mibModules.length }}</strong>
          </div>
        </div>
        <div class="module-list" *ngIf="store.mibModules.length > 0; else noModules">
          <button
            *ngFor="let module of store.mibModules"
            class="module-item"
            [class.active]="store.selectedMibModuleName === module.name"
            (click)="store.selectMibModule(module.name)"
          >
            <strong>{{ module.name }}</strong>
            <span>{{ module.field_count }} fields</span>
          </button>
        </div>
        <ng-template #noModules>
          <p>No MIB modules loaded yet.</p>
        </ng-template>
      </section>

      <section class="panel mib-content">
        <ng-container *ngIf="store.getSelectedMibModule() as module; else noSelection">
          <h2>{{ module.name }}</h2>
          <p>{{ module.field_count }} fields discovered</p>
          <div class="mib-field-grid">
            <button
              *ngFor="let field of module.fields"
              class="mib-field-card"
              [class.active]="store.selectedMibFieldOid === field.oid"
              (click)="store.selectMibField(field.oid)"
            >
              <span class="oid">{{ field.oid }}</span>
              <strong>{{ field.label }}</strong>
            </button>
          </div>
        </ng-container>
        <ng-template #noSelection>
          <p>Select a MIB module to inspect its fields.</p>
        </ng-template>
      </section>
    </section>
  `,
  styleUrl: './pages.shared.scss'
})
export class MibTreePageComponent {
  protected readonly store = inject(SimulatorStateService);
}
