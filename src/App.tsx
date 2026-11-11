/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppProvider } from './context/AppContext';
import { HomeView, AppRoute } from './components/HomeView';
import { AuthViews } from './components/AuthViews';
import { UserDashboardView } from './components/UserDashboardView';
import { AdminCamouflageGuard } from './components/AdminCamouflageGuard';

function resolveRouteFromLocation(): AppRoute {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();

  // Support /admin, ?page=admin, ?admin=1, #admin as Admin entry points
  if (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    params.get('page') === 'admin' ||
    params.get('admin') === '1' ||
    hash === '#admin'
  ) {
    return 'admin';
  }
  if (path === '/topup' || hash === '#topup') return 'topup';
  if (path === '/history' || hash === '#history') return 'history';
  if (path === '/login' || hash === '#login') return 'login';
  if (path === '/register' || hash === '#register') return 'register';
  return 'home';
}

function RouterShell() {
  const [route, setRoute] = useState<AppRoute>(() => resolveRouteFromLocation());

  useEffect(() => {
    const onPopState = () => {
      setRoute(resolveRouteFromLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextRoute: AppRoute) => {
    setRoute(nextRoute);
    const urlMap: Record<AppRoute, string> = {
      home: '/',
      topup: '/topup',
      history: '/history',
      login: '/login',
      register: '/register',
      admin: '/admin',
    };
    try {
      window.history.pushState({}, '', urlMap[nextRoute]);
    } catch {
      // ignore in restricted iframe environments
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (route === 'login') {
    return <AuthViews mode="login" onNavigate={navigate} />;
  }
  if (route === 'register') {
    return <AuthViews mode="register" onNavigate={navigate} />;
  }
  if (route === 'topup') {
    return <UserDashboardView key="topup" defaultTab="topup" onNavigate={navigate} />;
  }
  if (route === 'history') {
    return <UserDashboardView key="history" defaultTab="history" onNavigate={navigate} />;
  }
  if (route === 'admin') {
    return <AdminCamouflageGuard onNavigate={navigate} />;
  }
  return <HomeView onNavigate={navigate} />;
}

export default function App() {
  return (
    <AppProvider>
      <RouterShell />
    </AppProvider>
  );
}
