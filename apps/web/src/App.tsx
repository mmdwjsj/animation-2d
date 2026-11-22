import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import AssetsPage from './pages/AssetsPage';
import NotFoundPage from './pages/NotFoundPage';
import ProjectHomePage from './pages/ProjectHomePage';
import ScriptPage from './pages/ScriptPage';
import SettingsPage from './pages/SettingsPage';
import WorkbenchPage from './pages/WorkbenchPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<ProjectHomePage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="projects/:projectId/script" element={<ScriptPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* 工作台按 PRD 7.1 为全屏工作模式，使用自己的顶部工具栏，不套用全局侧栏 */}
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>
  );
}
