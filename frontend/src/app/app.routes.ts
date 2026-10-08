import { Routes } from '@angular/router';
import { authGuard, tlGuard } from './core/guards';
import { ROLE_TL, Role } from './core/models';
import { ShellComponent } from './layout/shell.component';
import { CompareComponent } from './pages/compare.component';
import { LaunchComponent } from './pages/launch.component';
import { LoginComponent } from './pages/login.component';
import { ProgressComponent } from './pages/progress.component';
import { ReportComponent } from './pages/report.component';
import { ReportsComponent } from './pages/reports.component';
import { StandComponent } from './pages/stand.component';

export function buildRoutes(role: Role | null): Routes {
  const children: Routes = [
    { path: 'launch', component: LaunchComponent },
    { path: 'progress', component: ProgressComponent },
    { path: 'checks/:checkId', component: ProgressComponent },
    { path: 'stand', component: StandComponent },
    { path: 'checks/:checkId/stand', component: StandComponent },
    { path: 'reports', component: ReportsComponent },
    { path: 'reports/:reportId/compare', component: CompareComponent },
    { path: 'reports/:reportId', component: ReportComponent },
  ];
  if (role === ROLE_TL) {
    children.push(
      {
        path: 'costs',
        canActivate: [tlGuard],
        loadComponent: () => import('./pages/costs.component').then((module) => module.CostsComponent),
      },
      {
        path: 'config',
        canActivate: [tlGuard],
        loadComponent: () => import('./pages/config.component').then((module) => module.ConfigComponent),
      },
      {
        path: 'users',
        canActivate: [tlGuard],
        loadComponent: () => import('./pages/users.component').then((module) => module.UsersComponent),
      },
    );
  }
  const home = role ? 'launch' : 'login';
  return [
    { path: 'login', component: LoginComponent },
    { path: '', pathMatch: 'full', redirectTo: home },
    { path: '', component: ShellComponent, canActivate: [authGuard], children },
    { path: '**', redirectTo: home },
  ];
}

export const routes: Routes = buildRoutes(null);
