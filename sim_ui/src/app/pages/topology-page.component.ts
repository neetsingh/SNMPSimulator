import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SimulatorStateService } from '../simulator-state.service';

@Component({
  selector: 'app-topology-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="panel topology-page">
      <h1>Topology Workspace</h1>
      <p>Arrange nodes visually, inspect links, and import or export layout coordinates.</p>
      <p class="status" *ngIf="store.activeInstanceName">Active instance: {{ store.activeInstanceName }}</p>

      <div *ngIf="store.topology.nodes.length > 0; else noTopology" class="topology-canvas">
        <svg
          [attr.viewBox]="'0 0 ' + store.graphWidth + ' ' + store.graphHeight"
          role="img"
          aria-label="Network topology graph"
          (mousemove)="store.moveDraggedNode($event)"
          (mouseup)="store.stopNodeDrag()"
          (mouseleave)="store.stopNodeDrag()"
        >
          <g class="links">
            <line
              *ngFor="let link of store.topology.links"
              [attr.x1]="store.getNodePosition(link.source).x"
              [attr.y1]="store.getNodePosition(link.source).y"
              [attr.x2]="store.getNodePosition(link.target).x"
              [attr.y2]="store.getNodePosition(link.target).y"
            />
          </g>
          <g class="nodes">
            <g *ngFor="let node of store.topology.nodes" class="node-point">
              <circle
                [attr.cx]="store.getNodePosition(node.name).x"
                [attr.cy]="store.getNodePosition(node.name).y"
                [attr.fill]="store.getNodeColor(node.vendor)"
                r="18"
                (mousedown)="store.startNodeDrag(node.name, $event)"
              />
              <text
                [attr.x]="store.getNodePosition(node.name).x"
                [attr.y]="store.getNodePosition(node.name).y - 26"
              >
                {{ node.name }}
              </text>
            </g>
          </g>
        </svg>
      </div>
      <ng-template #noTopology>
        <p class="status">Run a simulation from Dashboard to render topology graph.</p>
      </ng-template>

      <div class="actions graph-actions" *ngIf="store.topology.nodes.length > 0">
        <button class="secondary" (click)="store.exportLayoutJson()">Export Layout JSON</button>
        <button class="secondary" (click)="store.importLayoutJson()">Import Layout JSON</button>
      </div>

      <div class="layout-export" *ngIf="store.topology.nodes.length > 0">
        <h2>Layout Coordinates</h2>
        <textarea [(ngModel)]="store.layoutJson" rows="10" placeholder="Paste exported layout JSON here"></textarea>
      </div>

      <div class="nodes-grid">
        <article *ngFor="let node of store.topology.nodes" class="node-card">
          <h3>{{ node.name }}</h3>
          <p>{{ node.vendor }} / {{ node.device_type }}</p>
        </article>
      </div>

      <div class="lists">
        <div>
          <h3>Links</h3>
          <ul>
            <li *ngFor="let link of store.topology.links">
              {{ link.source }} - {{ link.target }} ({{ link.link_type }})
            </li>
          </ul>
        </div>
        <div>
          <h3>Neighbors</h3>
          <ul>
            <li *ngFor="let node of store.topology.nodes">
              {{ node.name }}: {{ store.topology.neighbors[node.name]?.join(', ') || 'none' }}
            </li>
          </ul>
        </div>
      </div>
    </section>
  `,
  styleUrl: './pages.shared.scss'
})
export class TopologyPageComponent {
  protected readonly store = inject(SimulatorStateService);
}
