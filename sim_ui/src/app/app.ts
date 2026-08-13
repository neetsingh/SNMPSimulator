import { Component } from '@angular/core';

import { DashboardPageComponent } from './pages/dashboard-page.component';

@Component({
  selector: 'app-root',
  imports: [DashboardPageComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
}
